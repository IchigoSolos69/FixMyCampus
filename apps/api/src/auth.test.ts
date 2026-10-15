import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer, type Server } from 'node:http';
const mocks = vi.hoisted(() => ({
  rows: vi.fn(),
  execute: vi.fn(),
  enqueueMail: vi.fn(),
  audit: vi.fn(),
  db: {},
}));
vi.mock('./db.js', () => ({
  pool: mocks.db,
  rows: mocks.rows,
  execute: mocks.execute,
  transaction: (fn: (db: unknown) => unknown) => fn(mocks.db),
  iso: (value: unknown) =>
    value instanceof Date
      ? value.toISOString()
      : new Date(String(value).replace(' ', 'T') + 'Z').toISOString(),
}));
vi.mock('./notifications.js', () => ({ enqueueMail: mocks.enqueueMail }));
vi.mock('./audit.js', () => ({ audit: mocks.audit }));
import { authRouter, requireAuth, roles } from './auth.js';
import { signAuthToken, hashPassword, type AuthUser } from './auth-service.js';
import { errorHandler } from './errors.js';

let server: Server | undefined;
let base = '';
const row = {
  id: 7,
  name: 'Student',
  email: 'student@campus.test',
  role: 'Student',
  department_id: null,
  contact_number: null,
  affiliation: null,
  photo_key: null,
  active: 1,
  email_verified: 1,
  auth_version: 2,
  failed_logins: 0,
  locked_until: null,
  created_at: '2026-10-16 00:00:00',
};
const user: AuthUser = {
  id: 7,
  name: 'Student',
  email: row.email,
  role: 'Student',
  departmentId: null,
  contactNumber: null,
  affiliation: null,
  photoUrl: null,
  active: true,
  createdAt: '2026-10-16T00:00:00Z',
  authVersion: 2,
};
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.rows.mockReset();
  mocks.execute.mockResolvedValue({ insertId: 1, affectedRows: 1 });
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/auth', authRouter);
  app.get('/protected', requireAuth, (_req, res) => res.json({ ok: true }));
  app.get('/admin', requireAuth, roles('Administrator'), (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
describe('authenticated account checks', () => {
  it('rejects a valid JWT immediately after an account is deactivated', async () => {
    mocks.rows.mockResolvedValue([{ ...row, active: 0 }]);
    const response = await fetch(`${base}/protected`, {
      headers: { Authorization: `Bearer ${await signAuthToken(user, 'access')}` },
    });
    expect(response.status).toBe(401);
  });
  it('rejects a valid JWT after its authentication version changes', async () => {
    mocks.rows.mockResolvedValue([{ ...row, auth_version: 3 }]);
    const response = await fetch(`${base}/protected`, {
      headers: { Authorization: `Bearer ${await signAuthToken(user, 'access')}` },
    });
    expect(response.status).toBe(401);
  });
  it('enforces the current database role rather than a client-selected role', async () => {
    mocks.rows.mockResolvedValue([row]);
    const response = await fetch(`${base}/admin`, {
      headers: { Authorization: `Bearer ${await signAuthToken(user, 'access')}` },
    });
    expect(response.status).toBe(403);
  });
});
describe('cookie-authenticated requests', () => {
  it('rejects cross-origin refresh before touching account data', async () => {
    const response = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'X-CSRF-Token': 'same',
        Cookie: 'fmc_csrf=same; fmc_refresh=anything',
      },
    });
    expect(response.status).toBe(403);
    expect(mocks.rows).not.toHaveBeenCalled();
  });
  it('rejects a missing CSRF header on logout', async () => {
    const response = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', Cookie: 'fmc_csrf=expected' },
    });
    expect(response.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
describe('login lockout', () => {
  it('commits the fifth failure and queues the account warning', async () => {
    const passwordHash = await hashPassword('Correct-Password-2026!');
    mocks.rows.mockResolvedValue([{ ...row, password_hash: passwordHash, failed_logins: 4 }]);
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: row.email, password: 'Wrong-Password-2026!' }),
    });
    expect(response.status).toBe(423);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('failed_logins=?'),
      [5, 5, 7],
      mocks.db,
    );
    expect(mocks.enqueueMail).toHaveBeenCalledWith(
      mocks.db,
      7,
      'account_locked',
      expect.any(Object),
    );
  });
  it('never verifies credentials while an existing lock is active', async () => {
    mocks.rows.mockResolvedValue([
      { ...row, password_hash: 'invalid', locked_until: new Date(Date.now() + 10 * 60 * 1000) },
    ]);
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: row.email, password: 'anything' }),
    });
    expect(response.status).toBe(423);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
