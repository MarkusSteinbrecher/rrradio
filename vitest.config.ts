import { defineConfig } from 'vitest/config';

/**
 * Vitest config — Vite-native test runner.
 *
 *   npm test          # one-shot run (CI / pre-commit)
 *   npm run test:watch # interactive, re-runs on change
 *
 * environment: happy-dom gives tests `window`, `document`, and
 * `localStorage` without paying jsdom's start-up cost. Pure-function
 * tests don't care which environment is active.
 *
 * Tests are co-located with their subject (`src/foo.ts` → `src/foo.test.ts`)
 * so a reader sees both at once. The `include` pattern picks up every
 * `*.test.ts` under `src/` and ignores the production code paths.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
