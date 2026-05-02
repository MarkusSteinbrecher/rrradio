/**
 * rrradio smoke test (audit #63 — at least one Playwright smoke).
 *
 * The unit suite covers pure logic; this exercises the real cold-boot
 * UI path — Vite-built bundle, real DOM event wiring, real catalog
 * loaded from `dist/stations.json`. We mock NO network here: the
 * preview server serves `dist/`, which already includes the
 * 771-station catalog. Anything that hits an external host (Worker,
 * stream URLs, Radio Browser) is best-effort and not asserted on —
 * tests assert only on what the static catalog guarantees.
 */
import { expect, test } from 'playwright/test';

test.describe('cold-boot UI', () => {
  test('renders the catalog with multiple station rows', async ({ page }) => {
    await page.goto('/');
    // The catalog is loaded asynchronously after boot; wait until at
    // least one row materialises. Cap at 10s — a green test should
    // resolve in well under that.
    await expect(page.locator('#content .row').first()).toBeVisible({ timeout: 10_000 });
    const count = await page.locator('#content .row').count();
    expect(count).toBeGreaterThan(20);
  });

  test('search surfaces a known station', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#content .row').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('#search').fill('fm4');
    // Search debounces 300ms; rendering may take additional frames.
    // Wait until an FM4-named row appears rather than asserting a
    // before/after count diff (the home view layout — "Most played"
    // + "Curated" — makes a row-delta brittle).
    const fm4 = page.locator('#content .row .row-name', { hasText: /fm4/i });
    await expect(fm4.first()).toBeVisible({ timeout: 5_000 });
  });

  test('whitespace-insensitive search ("WDR5" finds "WDR 5")', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#content .row').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('#search').fill('WDR5');
    await page.waitForTimeout(500);
    const wdr5 = page.locator('#content .row .row-name', { hasText: /WDR\s*5/i });
    await expect(wdr5.first()).toBeVisible();
  });

  test('the topbar wordmark is present and labelled', async ({ page }) => {
    await page.goto('/');
    const wordmark = page.locator('#wordmark');
    await expect(wordmark).toBeVisible();
    await expect(wordmark).toHaveAttribute('aria-label', /home/i);
  });

  test('about sheet opens and closes', async ({ page }) => {
    await page.goto('/');
    await page.locator('#about-btn').click();
    const sheet = page.locator('#about-sheet');
    await expect(sheet).toHaveClass(/open/);
    await expect(page.locator('.about-title')).toBeVisible();
    await page.locator('#about-close').click();
    await expect(sheet).not.toHaveClass(/open/);
  });

  test('add-station sheet rejects http:// stream URLs (audit #71)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#add-btn').click();
    const sheet = page.locator('#add-sheet');
    await expect(sheet).toHaveClass(/open/);

    await page.locator('input[name="name"]').fill('Test FM');
    await page.locator('input[name="streamUrl"]').fill('http://example.com/stream');
    await page.locator('#add-submit').click();

    const err = page.locator('#add-error');
    await expect(err).toBeVisible();
    await expect(err).toHaveText(/https/i);
  });

  test('CSP meta tag ships with the page (audit #75)', async ({ page }) => {
    await page.goto('/');
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://gc.zgo.at');
    expect(csp).not.toContain('unsafe-eval');
  });

  test('clicking a row triggers a play attempt without crashing', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#content .row').first()).toBeVisible({ timeout: 10_000 });

    // Capture page errors — clicking a row should never throw, even
    // when the audio engine can't actually play the stream.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Block audio + HLS playlist fetches so we don't actually stream.
    await page.route('**/*.{mp3,aac,m3u8,mp4}', (route) => route.abort());

    const firstRow = page.locator('#content .row').first();
    const stationId = await firstRow.getAttribute('data-id');
    expect(stationId).toBeTruthy();
    await firstRow.click();

    // Give the click handler a tick to wire the player. We're not
    // asserting on mini-player visibility — that depends on the audio
    // element reaching `loading` state, which in turn depends on the
    // browser starting the network fetch before our `route.abort()`
    // completes (a race). What we *do* assert: no thrown errors.
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});
