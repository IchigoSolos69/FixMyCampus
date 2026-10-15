import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/api/src/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      include: [
        'apps/api/src/services/**/*.ts',
        'apps/api/src/*service.ts',
        'apps/api/src/workflow.ts',
        'apps/api/src/notifications.ts',
      ],
      exclude: ['**/*.test.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 70 },
    },
  },
});
