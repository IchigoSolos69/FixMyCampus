import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('benchmark tooling refuses ordinary application databases', () => {
  function run(file: string, values: Record<string, string | undefined> = {}) {
    return spawnSync(process.execPath, [file], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BENCH_DATABASE_URL: undefined,
        ALLOW_BENCHMARK_SEED: undefined,
        BENCH_URL: undefined,
        ...values,
      },
    });
  }
  it('requires explicit opt-in before opening a database connection', () => {
    const result = run('scripts/benchmark-data.mjs');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ALLOW_BENCHMARK_SEED=1');
  });
  it('rejects a normal application database even with opt-in', () => {
    const result = run('scripts/benchmark-data.mjs', {
      BENCH_DATABASE_URL: 'mysql://campus:campus@127.0.0.1:1/fixmycampus',
      ALLOW_BENCHMARK_SEED: '1',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('name must start fixmycampus_benchmark');
    expect(result.stderr).not.toContain('ECONNREFUSED');
  });
  it('requires an explicit read-probe target', () => {
    const result = run('scripts/load-test.mjs');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Set BENCH_URL explicitly');
  });
});
