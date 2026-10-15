import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authRouter, requireAuth } from './auth.js';
import { profileRouter } from './profile.js';
import { adminRouter } from './admin.js';
import { complaintRouter, attachmentRouter } from './complaints.js';
import { notificationRouter } from './notifications.js';
import { dashboardRouter, reportRouter } from './reports.js';
import { rows } from './db.js';
import { config } from './config.js';
import { HttpError, errorHandler } from './errors.js';
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'blob:', 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      strictTransportSecurity: config.production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 20000, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && origin !== config.appUrl)
        throw new HttpError(403, 'This request origin is not allowed.');
    }
    next();
  });
  app.get('/api/v1/health', async (_req, res) => {
    try {
      await rows('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/profile', profileRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/complaints', complaintRouter);
  app.use('/api/v1/attachments', attachmentRouter);
  app.use('/api/v1/notifications', notificationRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/reports', reportRouter);
  app.get('/api/v1/catalog', requireAuth, async (_req, res) => {
    const departments = await rows<any>(
      'SELECT id,name,active FROM departments WHERE active=1 ORDER BY name',
    );
    const categories = await rows<any>(
      'SELECT c.*,d.name department_name FROM categories c JOIN departments d ON d.id=c.department_id WHERE c.active=1 AND d.active=1 ORDER BY c.name',
    );
    res.json({
      departments: departments.map((d) => ({
        id: Number(d.id),
        name: d.name,
        active: Boolean(d.active),
      })),
      categories: categories.map((c) => ({
        id: Number(c.id),
        code: c.code,
        name: c.name,
        departmentId: Number(c.department_id),
        departmentName: c.department_name,
        confidential: Boolean(c.confidential),
        emergency: Boolean(c.emergency),
        active: Boolean(c.active),
      })),
    });
  });
  app.use('/api', () => {
    throw new HttpError(404, 'API endpoint not found.');
  });
  const candidates = [
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../web/dist'),
  ];
  const web = candidates.find((p) => existsSync(path.join(p, 'index.html')));
  if (web) {
    app.use(express.static(web, { index: false }));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(web, 'index.html'));
    });
  }
  app.use(errorHandler);
  return app;
}
