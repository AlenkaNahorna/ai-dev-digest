import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Single-sourced contracts live in the server's vendored shared (same
      // approach as reviewer-core; see tsconfig paths).
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
      // One zod instance for this package and the vendored contracts.
      zod: path.resolve(__dirname, 'node_modules/zod'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
