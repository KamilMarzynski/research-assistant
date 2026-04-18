import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
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
    include: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { branches: 90, functions: 90, lines: 90, statements: 90 },
      include: ['src/main/**'],
      exclude: ['**/*.d.ts', 'src/main/index.ts'],
    },
  },
});
