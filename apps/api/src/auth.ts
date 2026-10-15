import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
  type NextFunction,
} from 'express';
import { timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  registerSchema,
  loginSchema,
  passwordSchema,
  type Role,
  type AuthResponse,
} from '@fixmycampus/shared';
import { config } from './config.js';
import { rows, execute, transaction, pool, iso, type DB } from './db.js';
import { HttpError } from './errors.js';
import { audit } from './audit.js';
import { enqueueMail } from './notifications.js';
import {
  hashPassword,
  verifyPassword,
  opaqueToken,
  tokenHash,
  signAuthToken,
  readAuthToken,
  userFromRow,
  publicUser,
  type AuthUser,
} from './auth-service.js';
export { userFromRow } from './auth-service.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
const cookieOptions = {
  httpOnly: true,
  secure: config.production,
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: 60 * 60 * 1000,
};
const dummyHash = hashPassword('An-Unused-Account-Password-2026!');
const tokenSchema = z.object({ token: z.string().min(32).max(2048) });
export async function findUser(id: number, db: DB = pool): Promise<AuthUser | null> {
  const [row] = await rows(
    'SELECT u.*,d.name AS department_name FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=?',
    [id],
    db,
  );
  return row ? userFromRow(row) : null;
}
async function authenticatedUser(id: number, version: number): Promise<AuthUser> {
  const [row] = await rows(
    'SELECT u.*,d.name AS department_name FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=?',
    [id],
  );
  if (!row || !row.active || !row.email_verified || Number(row.auth_version) !== version)
    throw new HttpError(401, 'Your sign-in has expired. Please sign in again.', 'UNAUTHENTICATED');
  if (
    row.role === 'Department Officer' &&
    (!row.department_id ||
      !(await rows('SELECT id FROM departments WHERE id=? AND active=1', [row.department_id]).then(
        (r) => r.length,
      )))
  )
    throw new HttpError(403, 'Your department is inactive. Contact the Administrator.');
  return userFromRow(row);
}
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authorization = req.get('authorization');
    if (!authorization?.startsWith('Bearer '))
      throw new HttpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED');
    const claims = await readAuthToken(authorization.slice(7), 'access');
    req.user = await authenticatedUser(claims.userId, claims.version);
    next();
  } catch (error) {
    next(error);
  }
}
export function roles(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user)
      return next(new HttpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED'));
    if (!allowed.includes(req.user.role))
      return next(
        new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'),
      );
    next();
  };
}
export function verifyCookieRequest(req: Request): void {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(config.appUrl).origin;
  } catch {
    throw new HttpError(500, 'The application URL is not configured correctly.');
  }
  if (req.get('origin') !== expectedOrigin)
    throw new HttpError(403, 'This request must come from FixMyCampus.', 'CSRF_REJECTED');
  const cookie = Buffer.from(String(req.cookies?.fmc_csrf ?? ''));
  const header = Buffer.from(req.get('X-CSRF-Token') ?? '');
  if (!cookie.length || cookie.length !== header.length || !timingSafeEqual(cookie, header))
    throw new HttpError(403, 'Refresh the page and try again.', 'CSRF_REJECTED');
}
async function authResponse(user: AuthUser, res: Response): Promise<AuthResponse> {
  const csrfToken = opaqueToken();
  res.cookie('fmc_refresh', await signAuthToken(user, 'refresh'), cookieOptions);
  res.cookie('fmc_csrf', csrfToken, cookieOptions);
  res.set('Cache-Control', 'no-store');
  return { user: publicUser(user), accessToken: await signAuthToken(user, 'access'), csrfToken };
}
export const authRouter = Router();
authRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
authRouter.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: {
        code: 'AUTH_RATE_LIMITED',
        message: 'Too many unsuccessful account requests. Try again in 15 minutes.',
      },
    },
  }),
);
authRouter.get('/csrf', (_req, res) => {
  const csrfToken = opaqueToken();
  res.cookie('fmc_csrf', csrfToken, cookieOptions);
  res.json({ csrfToken });
});
authRouter.post('/register', async (req, res) => {
  const input = registerSchema.parse(req.body);
  if (!config.domains.includes(input.email.split('@')[1]))
    throw new HttpError(
      422,
      'Use an approved institutional e-mail address.',
      'INSTITUTIONAL_EMAIL_REQUIRED',
    );
  const passwordHash = await hashPassword(input.password);
  const token = opaqueToken();
  await transaction(async (db) => {
    const result = await execute(
      "INSERT INTO users (name,email,password_hash,role,active,email_verified) VALUES (?,?,?,'Student',1,0)",
      [input.name, input.email, passwordHash],
      db,
    );
    await execute(
      "INSERT INTO auth_tokens (user_id,token_hash,kind,expires_at) VALUES (?,?,'verify',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR))",
      [result.insertId, tokenHash(token)],
      db,
    );
    const url = `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await enqueueMail(db, result.insertId, 'email_verification', {
      name: input.name,
      email: input.email,
      token,
      url,
      link: url,
      minutes: '1440',
    });
    await audit(db, result.insertId, 'account.registered', 'user', result.insertId);
  });
  res.status(201).json({
    message:
      'Registration received. Check your institutional inbox to verify your e-mail before signing in.',
  });
});
authRouter.post('/login', async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await transaction(async (db) => {
    const [row] = await rows('SELECT * FROM users WHERE email=? FOR UPDATE', [input.email], db);
    if (!row) {
      await verifyPassword(input.password, await dummyHash);
      return { error: 401 as number, message: 'The e-mail or password is incorrect.' };
    }
    if (row.locked_until && new Date(iso(row.locked_until)).getTime() > Date.now())
      return { error: 423, message: 'This account is locked. Try again after 15 minutes.' };
    const expiredLock = Boolean(row.locked_until);
    if (!(await verifyPassword(input.password, row.password_hash))) {
      const failures = expiredLock ? 1 : Number(row.failed_logins) + 1;
      await execute(
        'UPDATE users SET failed_logins=?,locked_until=IF(?>=5,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),NULL) WHERE id=?',
        [failures, failures, row.id],
        db,
      );
      if (failures >= 5) {
        await enqueueMail(db, row.id, 'account_locked', {
          name: row.name,
          email: row.email,
          minutes: '15',
        });
        await audit(db, row.id, 'account.locked', 'user', row.id);
      }
      return {
        error: failures >= 5 ? 423 : 401,
        message:
          failures >= 5
            ? 'This account is locked. Try again after 15 minutes.'
            : 'The e-mail or password is incorrect.',
      };
    }
    await execute('UPDATE users SET failed_logins=0,locked_until=NULL WHERE id=?', [row.id], db);
    if (!row.active)
      return { error: 403, message: 'This account is inactive. Contact the Administrator.' };
    if (!row.email_verified)
      return { error: 403, message: 'Verify your e-mail address before signing in.' };
    await audit(db, row.id, 'account.signed_in', 'user', row.id);
    return { user: await findUser(row.id, db) };
  });
  if ('error' in result) throw new HttpError(result.error!, result.message!, 'LOGIN_FAILED');
  res.json(await authResponse(result.user!, res));
});
authRouter.post('/verify-email', async (req, res) => {
  const { token } = tokenSchema.parse(req.body);
  await transaction(async (db) => {
    const [row] = await rows(
      "SELECT * FROM auth_tokens WHERE token_hash=? AND kind='verify' AND used_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE",
      [tokenHash(token)],
      db,
    );
    if (!row)
      throw new HttpError(
        422,
        'This verification link is invalid or has expired.',
        'INVALID_TOKEN',
      );
    await execute('UPDATE users SET email_verified=1 WHERE id=?', [row.user_id], db);
    await execute(
      "UPDATE auth_tokens SET used_at=UTC_TIMESTAMP() WHERE user_id=? AND kind='verify' AND used_at IS NULL",
      [row.user_id],
      db,
    );
    await audit(db, row.user_id, 'account.email_verified', 'user', row.user_id);
  });
  res.json({ message: 'E-mail verified. You can now sign in.' });
});
authRouter.post('/forgot-password', async (req, res) => {
  const { email } = z
    .object({
      email: z
        .string()
        .trim()
        .email()
        .transform((s) => s.toLowerCase()),
    })
    .parse(req.body);
  await transaction(async (db) => {
    const [user] = await rows(
      'SELECT id,name,email FROM users WHERE email=? AND active=1',
      [email],
      db,
    );
    if (!user) return;
    const token = opaqueToken();
    await execute(
      "UPDATE auth_tokens SET used_at=UTC_TIMESTAMP() WHERE user_id=? AND kind='reset' AND used_at IS NULL",
      [user.id],
      db,
    );
    await execute(
      "INSERT INTO auth_tokens (user_id,token_hash,kind,expires_at) VALUES (?,?,'reset',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))",
      [user.id, tokenHash(token)],
      db,
    );
    const url = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await enqueueMail(db, user.id, 'password_reset', {
      name: user.name,
      email: user.email,
      token,
      url,
      link: url,
      minutes: '30',
    });
  });
  res.json({
    message: 'If an active account matches that address, a password reset link has been sent.',
  });
});
authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = tokenSchema.extend({ password: passwordSchema }).parse(req.body);
  const hash = await hashPassword(password);
  await transaction(async (db) => {
    const [record] = await rows(
      "SELECT * FROM auth_tokens WHERE token_hash=? AND kind='reset' AND used_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE",
      [tokenHash(token)],
      db,
    );
    if (!record)
      throw new HttpError(
        422,
        'This password reset link is invalid or has expired.',
        'INVALID_TOKEN',
      );
    await execute(
      'UPDATE users SET password_hash=?,auth_version=auth_version+1,failed_logins=0,locked_until=NULL WHERE id=?',
      [hash, record.user_id],
      db,
    );
    await execute(
      "UPDATE auth_tokens SET used_at=UTC_TIMESTAMP() WHERE user_id=? AND kind='reset' AND used_at IS NULL",
      [record.user_id],
      db,
    );
    await audit(db, record.user_id, 'account.password_reset', 'user', record.user_id);
  });
  res.json({ message: 'Password reset. Sign in with your new password.' });
});
authRouter.post('/refresh', async (req, res) => {
  verifyCookieRequest(req);
  const token = req.cookies?.fmc_refresh;
  if (typeof token !== 'string')
    throw new HttpError(401, 'Please sign in again.', 'UNAUTHENTICATED');
  const claims = await readAuthToken(token, 'refresh');
  res.json(await authResponse(await authenticatedUser(claims.userId, claims.version), res));
});
authRouter.post('/logout', async (req, res) => {
  verifyCookieRequest(req);
  const token = req.cookies?.fmc_refresh;
  if (typeof token === 'string') {
    try {
      const claims = await readAuthToken(token, 'refresh');
      await execute('UPDATE users SET auth_version=auth_version+1 WHERE id=? AND auth_version=?', [
        claims.userId,
        claims.version,
      ]);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
    }
  }
  res.clearCookie('fmc_refresh', cookieOptions);
  res.clearCookie('fmc_csrf', cookieOptions);
  res.json({ message: 'Signed out on all devices.' });
});
authRouter.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user!));
});
