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
        'src/main/index.ts',
        // Electron-wiring: require app/ipcMain at runtime, tested E2E in later runs
        'src/main/bootstrap.ts',
        'src/main/ipc-handlers.ts',
        // DB infra: schema declarations and connection factory; exercised by integration tests
        'src/main/db/client.ts',
        'src/main/db/schema.ts',
        'src/main/db/migrate.ts',
      ],
    },
  },
});
