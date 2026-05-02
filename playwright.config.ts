/**
 * Playwright config for the rrradio web app smoke suite (audit #63
 * follow-up). The suite is deliberately small — the unit tests in
 * `src/*.test.ts` cover the pure logic; what Playwright adds is the
 * cold-boot UI path that nothing else exercises:
 *   - real browser engine
 *   - real Vite-built bundle (vite preview)
 *   - real DOM event wiring
 *
 * Each test starts from a fresh page navigation, no shared state.
 */
import { defineConfig, devices } from 'playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const HOST = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts$/,
  // CI runs the suite serially against a single preview server. Local
  // devs can override with `--workers=4` when iterating.
  workers: process.env.CI ? 1 : undefined,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: HOST,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  // Spin up `vite preview` against the production-shape `dist/` build.
  // `npm run build` runs upstream (in CI it's the `web` job; locally
  // run `npm run build` before `npm run test:e2e`).
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: HOST,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
