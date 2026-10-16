import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createPool, on } = vi.hoisted(() => ({ createPool: vi.fn(), on: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: { createPool } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_URL', 'http://localhost:5173');
  vi.stubEnv('DATABASE_URL', 'mysql://campus:password@db.example.test:3306/campus');
  createPool.mockReturnValue({ pool: { on } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('managed MySQL TLS', () => {
  it('keeps local/private database connections unchanged when no CA is configured', async () => {
    vi.stubEnv('DATABASE_SSL_CA', '');
    await import('../../apps/api/src/db.js');
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: undefined, timezone: 'Z', multipleStatements: false }),
    );
  });

  it.each([
    '-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n',
    '-----BEGIN CERTIFICATE-----\\nexample\\n-----END CERTIFICATE-----\\n',
  ])('verifies the certificate and hostname with a dashboard CA value', async (ca) => {
    vi.stubEnv('DATABASE_SSL_CA', ca);
    await import('../../apps/api/src/db.js');
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: 'mysql://campus:password@db.example.test:3306/campus',
        ssl: {
          ca: '-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n',
          rejectUnauthorized: true,
          verifyIdentity: true,
        },
      }),
    );
  });
});
