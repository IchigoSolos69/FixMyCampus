import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { startJobs } from './notifications.js';
const app = createApp();
const server = app.listen(config.port, () =>
  console.log(`FixMyCampus API listening on http://localhost:${config.port}`),
);
const stopJobs = startJobs();
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    stopJobs();
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
