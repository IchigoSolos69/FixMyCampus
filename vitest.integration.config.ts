import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.integration.test.ts', 'apps/api/src/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
