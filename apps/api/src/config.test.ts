import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
const developmentSecret = 'local-development-only-change-this-secret-before-deployment-2026';
async function loadConfig({
  mode = 'production',
  url = 'https://campus.example.edu',
  secret = 'x'.repeat(64),
  databaseUrl = 'mysql://campus:password@db.example.test:3306/fixmycampus',
}: { mode?: string; url?: string; secret?: string; databaseUrl?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', mode);
  vi.stubEnv('APP_URL', url);
  vi.stubEnv('JWT_SECRET', secret);
  vi.stubEnv('DATABASE_URL', databaseUrl);
  return (await import('./config.js')).config;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('deployment configuration', () => {
  it.each([undefined, '', '   '])(
    'requires an explicit nonempty production database URL',
    async (value) => {
      await loadConfig();
      vi.stubEnv('DATABASE_URL', value);
      vi.resetModules();
      await expect(import('./config.js')).rejects.toThrow('DATABASE_URL');
    },
  );
  it.each([
    '',
    'too-short',
    developmentSecret,
    'replace-this-with-a-real-secret-before-deploying-'.repeat(2),
  ])('refuses missing, short or published example secrets in production', async (secret) => {
    await expect(loadConfig({ secret })).rejects.toThrow('JWT_SECRET');
  });
  it('permits the documented loopback defaults for local development', async () => {
    expect(
      await loadConfig({
        mode: 'development',
        url: 'http://localhost:5173/',
        secret: developmentSecret,
        databaseUrl: '',
      }),
    ).toMatchObject({
      production: false,
      appUrl: 'http://localhost:5173',
      databaseUrl: 'mysql://campus:campus@127.0.0.1:3306/fixmycampus',
    });
  });
  it('normalizes a trailing slash so browser Origin checks still match', async () => {
    expect((await loadConfig({ url: 'https://campus.example.edu/' })).appUrl).toBe(
      'https://campus.example.edu',
    );
  });
  it('refuses plain HTTP in production', async () => {
    await expect(loadConfig({ url: 'http://campus.example.edu' })).rejects.toThrow('HTTPS');
  });
  it.each([
    'ftp://campus.example.edu',
    'javascript:alert(1)',
    'https://campus.example.edu/campus',
    'https://campus.example.edu?view=1',
    'https://campus.example.edu#dashboard',
    'https://user:password@campus.example.edu',
  ])('refuses a non-origin application URL', async (url) => {
    await expect(loadConfig({ url })).rejects.toThrow('APP_URL');
  });
  it('trims and normalizes the configured institutional-domain allowlist', async () => {
    vi.stubEnv('APPROVED_EMAIL_DOMAINS', ' CAMPUS.TEST,Staff.Campus.Test ');
    expect((await loadConfig()).domains).toEqual(['campus.test', 'staff.campus.test']);
  });
  it('accepts the ImageKit driver and normalizes its canonical endpoint', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'imagekit');
    vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/campus_id/');
    expect(await loadConfig()).toMatchObject({
      storage: 'imagekit',
      imagekit: { urlEndpoint: 'https://ik.imagekit.io/campus_id' },
    });
  });
  it.each([
    'http://ik.imagekit.io/campus',
    'https://localhost/campus',
    'https://ik.imagekit.io.evil.test/campus',
    'https://user:password@ik.imagekit.io/campus',
    'https://ik.imagekit.io/campus?redirect=localhost',
    'https://ik.imagekit.io/campus/../other',
  ])('rejects an unsafe ImageKit endpoint', async (endpoint) => {
    vi.stubEnv('IMAGEKIT_URL_ENDPOINT', endpoint);
    await expect(loadConfig()).rejects.toThrow('IMAGEKIT_URL_ENDPOINT');
  });
});
