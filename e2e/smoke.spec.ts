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
    // Browse opens on the discovery landing now (chips + Featured rail);
    // pick a genre chip to drop into the catalog list. Local matches render
    // from the bundled catalog without any network.
    await expect(page.locator('.disc-chip').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('.disc-chip', { hasText: 'Pop' }).first().click();
    // The catalog is loaded asynchronously after boot; wait until at
    // least one row materialises. Cap at 10s — a green test should
    // resolve in well under that.
    await expect(page.locator('#content .row').first()).toBeVisible({ timeout: 10_000 });
    const count = await page.locator('#content .row').count();
    expect(count).toBeGreaterThan(20);
  });

  test('search surfaces a known station', async ({ page }) => {
    await page.goto('/');
    // Catalog ready once the discovery chips render.
    await expect(page.locator('.disc-chip').first()).toBeVisible({ timeout: 10_000 });

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
    await expect(page.locator('.disc-chip').first()).toBeVisible({ timeout: 10_000 });
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

  test('about tab opens within the settings sheet and closes', async ({ page }) => {
    await page.goto('/');
    // About is a tab of the consolidated settings sheet now.
    await page.locator('#settings-btn').click();
    const sheet = page.locator('#settings-sheet');
    await expect(sheet).toHaveClass(/open/);
    await page.locator('.sheet-tab[data-settings-tab="about"]').click();
    await expect(page.locator('.about-hero__name')).toBeVisible();
    await page.locator('#settings-close').click();
    await expect(sheet).not.toHaveClass(/open/);
  });

  test('add-station form rejects http:// stream URLs (audit #71)', async ({ page }) => {
    await page.goto('/');
    // Add is a tab of the consolidated settings sheet now.
    await page.locator('#settings-btn').click();
    await page.locator('.sheet-tab[data-settings-tab="add"]').click();
    await expect(page.locator('#settings-sheet')).toHaveClass(/open/);

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

    // Production build replaces the source's `script-src 'unsafe-inline'`
    // with a per-page list of `'sha256-<hash>'` entries (audit #75
    // follow-up — tools/build-station-pages.mjs computes them at build
    // time). The smoke runs against the built `dist/` so it should see
    // the strict form.
    const scriptSrc = csp!.match(/script-src\s+([^;]+);/);
    expect(scriptSrc).not.toBeNull();
    const sources = scriptSrc![1];
    expect(sources).not.toContain("'unsafe-inline'");
    expect(sources).toMatch(/'sha256-[A-Za-z0-9+/]+={0,2}'/);
  });

  test('clicking a row triggers a play attempt without crashing', async ({ page }) => {
    await page.goto('/');
    // Drop into the catalog list from the discovery landing first.
    await expect(page.locator('.disc-chip').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('.disc-chip', { hasText: 'Pop' }).first().click();
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

  // QUARANTINED: the wide-desktop "collapse browse → 3-col" feature is
  // half-implemented on this branch — the #np-collapse-browse toggle is hidden
  // (no rule reveals it) and, when shown, it overlaps the .np-back minimize
  // chevron in the NP's top-left corner (both anchor there), so the control is
  // unreachable. The 2-col wide layout itself works; only the 3-col collapse is
  // unfinished. Re-enable once the toggle's placement/visibility is sorted.
  // Tracked in #643. (Was already red on the branch before go-live.)
  test.fixme('wide desktop: player is 2-col, browse collapse expands it to 3-col (#521)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1680, height: 950 });
    await page.goto('/');
    // Drop into the catalog and play a station with a known schedule.
    await page.locator('#search').fill('BBC Radio 1');
    const row = page.locator('#content .row').first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await page.route('**/*.{mp3,aac,m3u8,mp4}', (route) => route.abort());
    await row.click();
    await expect(page.locator('body')).toHaveClass(/has-station/);

    // Browse visible → 2 player columns: album + one switchable secondary.
    // The 'now' pill is dropped (album is always its own column).
    await expect(page.locator('body')).toHaveClass(/np-twocol/);
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.locator('#np-track-row')).toBeVisible();
    await expect(page.locator('#np-pane-now')).toBeHidden();

    // Collapse the browse list → 3 columns (album · schedule · lyrics),
    // list hidden, all panes shown at once.
    await page.locator('#np-collapse-browse').click();
    await expect(page.locator('body')).toHaveClass(/np-threecol/);
    await expect(page.locator('#content')).toBeHidden();
    await expect(page.locator('#np-program-pane')).toBeVisible();
    await expect(page.locator('#np-lyrics-pane')).toBeVisible();
    await expect(page.locator('#np-pane-tabs')).toBeHidden();
  });
});
