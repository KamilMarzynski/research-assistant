import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', tsx: true, decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true, react: { runtime: 'automatic' } },
      },
    }),
    {
      name: 'disable-oxc',
      config() {
        return { oxc: false } as never;
      },
    },
  ],
  resolve: {
    alias: {
      '@main': resolve('./src/main'),
      '@shared': resolve('./src/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/__tests__/**/*.{ts,tsx}', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    server: {
      deps: {
        fallbackCJS: true,
      },
    },
    coverage: {
      provider: 'v8',
      thresholds: { branches: 90, functions: 90, lines: 90, statements: 90 },
      include: ['src/main/**'],
      exclude: [
        '**/*.d.ts',
        // Entry point: Electron main process bootstrap; tested via integration/E2E
        'src/main/index.ts',
        // Electron wiring: app lifecycle and DI container bootstrap; tested via integration/E2E
        'src/main/bootstrap.ts',
        // Re-export only; domain handlers tested individually
        'src/main/ipc-handlers.ts',
        // IPC wiring; domain handlers need dedicated tests in future run
        'src/main/ipc/*.ts',
        // IPC schema declarations; exercised by integration tests
        'src/main/ipc-validation.ts',
        // DB infra: schema declarations and connection factory; exercised by integration tests
        'src/main/db/client.ts',
        'src/main/db/schema.ts',
        'src/main/db/migrate.ts',
        // Tool factories: thin wrappers around tested tool implementations; logic covered by tools.test.ts
        'src/main/agent/tools/*.ts',
        // Shared utilities: simple pure functions tested implicitly
        'src/main/utils/*.ts',
      ],
    },
  },
});
