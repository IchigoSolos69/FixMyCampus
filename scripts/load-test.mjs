/** Read-only load probe against an explicitly supplied local/test deployment. */
import { performance } from 'node:perf_hooks';

const base = process.env.BENCH_URL;
if (!base) throw new Error('Set BENCH_URL explicitly, for example http://localhost:3001');
const url = new URL(base);
if (!['http:', 'https:'].includes(url.protocol)) throw new Error('BENCH_URL must be HTTP(S)');
const concurrency = Number(process.env.BENCH_USERS || 500);
const iterations = Number(process.env.BENCH_REQUESTS || 1000);
if (
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 500 ||
  !Number.isInteger(iterations) ||
  iterations < concurrency
)
  throw new Error('BENCH_USERS must be 1-500; BENCH_REQUESTS must be at least BENCH_USERS');
const email = process.env.BENCH_EMAIL || 'incharge@campus.test';
const password = process.env.BENCH_PASSWORD;
if (!password) throw new Error('Set BENCH_PASSWORD for a dedicated benchmark account');
const login = await fetch(new URL('/api/v1/auth/login', url), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw new Error(`Login failed (${login.status}); benchmark was not started`);
const { accessToken } = await login.json();
if (!accessToken) throw new Error('Login returned no accessToken');
const durations = [];
let failures = 0;
let next = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next++ < iterations) {
      const start = performance.now();
      try {
        const response = await fetch(new URL('/api/v1/complaints?page=1&pageSize=20', url), {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        });
        await response.arrayBuffer();
        if (!response.ok) failures++;
      } catch {
        failures++;
      }
      durations.push(performance.now() - start);
    }
  }),
);
durations.sort((a, b) => a - b);
const percentile = (p) =>
  Math.round(durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)]);
const result = {
  timestamp: new Date().toISOString(),
  base: url.origin,
  concurrentWorkers: concurrency,
  requests: durations.length,
  failures,
  elapsedSeconds: +((performance.now() - started) / 1000).toFixed(2),
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  p99Ms: percentile(0.99),
  targetP95Ms: 2000,
};
console.log(JSON.stringify(result, null, 2));
if (failures || result.p95Ms > 2000) process.exitCode = 1;
