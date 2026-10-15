import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { User } from '@fixmycampus/shared';
import { config } from './config.js';
import { iso } from './db.js';
import { HttpError } from './errors.js';

function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
const signingKey = new TextEncoder().encode(config.jwtSecret);
export interface AuthUser extends User {
  authVersion: number;
}
export function userFromRow(row: Record<string, any>): AuthUser {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    departmentId:
      row.department_id === null || row.department_id === undefined
        ? null
        : Number(row.department_id),
    departmentName: row.department_name ?? null,
    contactNumber: row.contact_number ?? null,
    affiliation: row.affiliation ?? null,
    photoUrl: row.photo_key ? '/api/v1/profile/photo' : null,
    active: Boolean(row.active),
    createdAt: iso(row.created_at),
    authVersion: Number(row.auth_version),
  };
}
export function publicUser(user: AuthUser): User {
  const { authVersion: _, ...visible } = user;
  return visible;
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, encoded, ...rest] = hash.split('$');
  if (
    algorithm !== 'scrypt' ||
    n !== '32768' ||
    r !== '8' ||
    p !== '3' ||
    !/^[a-f0-9]{32}$/.test(salt ?? '') ||
    !/^[a-f0-9]{128}$/.test(encoded ?? '') ||
    rest.length
  )
    return false;
  const key = await deriveKey(password, salt);
  return timingSafeEqual(key, Buffer.from(encoded, 'hex'));
}
export function opaqueToken(): string {
  return randomBytes(32).toString('hex');
}
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export async function signAuthToken(user: AuthUser, kind: 'access' | 'refresh'): Promise<string> {
  return new SignJWT({ kind, version: user.authVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('fixmycampus')
    .setAudience(kind === 'access' ? 'fixmycampus-api' : 'fixmycampus-refresh')
    .setSubject(String(user.id))
    .setJti(opaqueToken())
    .setIssuedAt()
    .setExpirationTime('60m')
    .sign(signingKey);
}
export async function readAuthToken(
  token: string,
  kind: 'access' | 'refresh',
): Promise<{ userId: number; version: number }> {
  try {
    const { payload } = await jwtVerify(token, signingKey, {
      algorithms: ['HS256'],
      issuer: 'fixmycampus',
      audience: kind === 'access' ? 'fixmycampus-api' : 'fixmycampus-refresh',
    });
    const userId = Number(payload.sub);
    if (
      payload.kind !== kind ||
      !Number.isSafeInteger(userId) ||
      userId < 1 ||
      !Number.isSafeInteger(payload.version)
    )
      throw new Error('Invalid claims');
    return { userId, version: Number(payload.version) };
  } catch {
    throw new HttpError(401, 'Your sign-in has expired. Please sign in again.', 'UNAUTHENTICATED');
  }
}
