import { defineConfig } from 'vitest/config';

/**
 * Worker-local Vitest config. Without this, vitest walks the
 * directory tree and picks up the parent project's vitest.config.ts
 * — which then fails in CI because the worker's `npm ci` doesn't
 * install the parent's deps. Keep this minimal: same node-env shape
 * the worker already uses for its `globalThis.fetch` stubbing.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
