import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
const prod = process.env.NODE_ENV === 'production';
const appUrl = new URL(process.env.APP_URL || 'http://localhost:5173');
if (
  !['http:', 'https:'].includes(appUrl.protocol) ||
  appUrl.username ||
  appUrl.password ||
  appUrl.pathname !== '/' ||
  appUrl.search ||
  appUrl.hash
)
  throw new Error('APP_URL must be the HTTP(S) origin where FixMyCampus is served.');
export const config = {
  production: prod,
  port: Number(process.env.PORT || 3001),
  appUrl: appUrl.origin,
  databaseUrl: process.env.DATABASE_URL || 'mysql://campus:campus@127.0.0.1:3306/fixmycampus',
  jwtSecret:
    process.env.JWT_SECRET || 'local-development-only-change-this-secret-before-deployment-2026',
  domains: (process.env.APPROVED_EMAIL_DOMAINS || 'campus.test')
    .split(',')
    .map((v) => v.trim().toLowerCase()),
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || '../../uploads'),
  storage: process.env.STORAGE_DRIVER || 'local',
  smtp: {
    host: process.env.SMTP_HOST || '127.0.0.1',
    port: Number(process.env.SMTP_PORT || 1025),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM || 'FixMyCampus <noreply@campus.test>',
  },
  cloudinary: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  },
};
if (
  prod &&
  (!process.env.JWT_SECRET ||
    config.jwtSecret.length < 48 ||
    /^(replace|change)|local-development-only/i.test(config.jwtSecret))
)
  throw new Error(
    'Set JWT_SECRET to at least 48 random characters in production; example secrets are not allowed',
  );
if (prod && !config.appUrl.startsWith('https://'))
  throw new Error('APP_URL must use HTTPS in production');
if (!['local', 'cloudinary'].includes(config.storage))
  throw new Error('STORAGE_DRIVER must be local or cloudinary.');
