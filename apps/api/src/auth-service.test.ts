import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt } from 'jose';
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

const user: AuthUser = {
  id: 42,
  name: 'A Student',
  email: 'student@campus.test',
  role: 'Student',
  departmentId: null,
  contactNumber: null,
  affiliation: null,
  photoUrl: null,
  active: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  authVersion: 3,
};
afterEach(() => {
  vi.useRealTimers();
});
describe('password credentials', () => {
  it('uses independent salts and verifies only the correct password', async () => {
    const first = await hashPassword('Correct-Campus-Password-42');
    const second = await hashPassword('Correct-Campus-Password-42');
    expect(first).not.toBe(second);
    expect(first).not.toContain('Correct-Campus');
    expect(await verifyPassword('Correct-Campus-Password-42', first)).toBe(true);
    expect(await verifyPassword('Wrong-Campus-Password-42', first)).toBe(false);
  });
  it('rejects malformed or unsupported stored hash parameters without derivation', async () => {
    for (const hash of [
      '',
      'scrypt$salt$key',
      'bcrypt$not-valid',
      'scrypt$999999999$8$3$' + '0'.repeat(32) + '$' + '0'.repeat(128),
      'scrypt$32768$8$3$' + '0'.repeat(32) + '$' + '0'.repeat(128) + '$extra',
    ])
      expect(await verifyPassword('Password123!', hash)).toBe(false);
  });
  it('stores reset credentials by irreversible stable hash', () => {
    const token = opaqueToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(opaqueToken()).not.toBe(token);
    expect(tokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(token)).not.toBe(token);
    expect(tokenHash(token)).toBe(tokenHash(token));
  });
});
describe('JWT trust boundaries', () => {
  it('signs a 60-minute access token with minimal revocation claims', async () => {
    const token = await signAuthToken(user, 'access');
    const claims = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(3600);
    expect(claims).not.toHaveProperty('email');
    expect(await readAuthToken(token, 'access')).toEqual({ userId: 42, version: 3 });
  });
  it('never accepts a refresh credential as an access token', async () => {
    const token = await signAuthToken(user, 'refresh');
    await expect(readAuthToken(token, 'access')).rejects.toMatchObject({ status: 401 });
    expect(await readAuthToken(token, 'refresh')).toEqual({ userId: 42, version: 3 });
  });
  it('rejects tampered and expired tokens', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    const token = await signAuthToken(user, 'access');
    const [header, claims] = token.split('.');
    await expect(
      readAuthToken(`${header}.${claims}.not-a-signature`, 'access'),
    ).rejects.toMatchObject({ status: 401 });
    vi.setSystemTime(new Date('2026-10-16T01:00:01Z'));
    await expect(readAuthToken(token, 'access')).rejects.toMatchObject({ status: 401 });
  });
});
describe('user serialization', () => {
  it('normalizes database values and never exposes credentials or auth version publicly', () => {
    const mapped = userFromRow({
      id: '42',
      name: 'Name',
      email: 'n@campus.test',
      role: 'Student',
      department_id: null,
      active: 1,
      photo_key: 'private-key',
      created_at: '2026-10-16 00:00:00.000',
      auth_version: 2,
      password_hash: 'secret',
    });
    expect(mapped).toMatchObject({
      id: 42,
      active: true,
      departmentId: null,
      photoUrl: '/api/v1/profile/photo',
      createdAt: '2026-10-16T00:00:00.000Z',
    });
    expect(publicUser(mapped)).not.toHaveProperty('authVersion');
    expect(publicUser(mapped)).not.toHaveProperty('password_hash');
  });
});
