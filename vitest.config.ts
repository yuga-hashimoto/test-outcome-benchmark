import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePackage = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const resolvePackageRoot = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@tob\/core\/(.*)$/, replacement: `${resolvePackageRoot('core')}/$1` },
      { find: '@tob/core', replacement: resolvePackage('core') },
      { find: /^@tob\/db\/(.*)$/, replacement: `${resolvePackageRoot('db')}/$1` },
      { find: '@tob/db', replacement: resolvePackage('db') },
      { find: /^@tob\/providers\/(.*)$/, replacement: `${resolvePackageRoot('providers')}/$1` },
      { find: '@tob/providers', replacement: resolvePackage('providers') },
      { find: /^@tob\/runner\/(.*)$/, replacement: `${resolvePackageRoot('runner')}/$1` },
      { find: '@tob/runner', replacement: resolvePackage('runner') },
      { find: /^@tob\/cli\/(.*)$/, replacement: `${resolvePackageRoot('cli')}/$1` },
      { find: '@tob/cli', replacement: resolvePackage('cli') },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    /** The end-to-end suite spawns the real CLI, which needs more than the
     * 5s default — the seed alone reads and freezes the whole dataset. */
    testTimeout: 200_000,
    hookTimeout: 300_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/cli/src/bin.ts', '**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
