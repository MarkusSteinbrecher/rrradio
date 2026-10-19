import { expect, test } from 'playwright/test';

/**
 * Public catalog-health page (docs/station-health.md, "Public dashboard").
 *
 * The data behind the page lives on the health-data branch and is fetched at
 * runtime, so this smoke deliberately asserts only what the built bundle
 * controls: the shell renders, the strict CSP holds (no inline script /
 * style violations), and the boot module runs far enough to either draw the
 * score and station lookup or report a load error — never a blank page.
 */
test.describe('catalog-health page', () => {
  test('renders the shell and boots under its CSP', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    await page.goto('/catalog-health.html');
    await expect(page).toHaveTitle(/Catalog health/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Catalog quality/);
    await expect(page.locator('#theme-toggle svg')).toBeVisible();

    // Either the data loaded (score + lookup rows) or the page said it couldn't.
    const loaded = page.locator('#f-q');
    const failed = page.locator('#load-status.is-error');
    await expect(loaded.or(failed)).toBeVisible({ timeout: 20_000 });
    if (await loaded.isVisible()) {
      await expect(page.locator('#table-body tr').first()).toBeVisible();
      await expect(page.locator('#result-line')).toContainText(/stations/);
      await expect(page.locator('#score-value')).toHaveText(/^\d+$/);
      await expect(page.locator('#dims li')).toHaveCount(4);
    }
    expect(violations).toEqual([]);
  });

  test('filters round-trip through the URL', async ({ page }) => {
    await page.goto('/catalog-health.html?view=attention&sort=score');
    const loaded = page.locator('#f-view-attention');
    const failed = page.locator('#load-status.is-error');
    await expect(loaded.or(failed)).toBeVisible({ timeout: 20_000 });
    test.skip(await failed.isVisible(), 'no dashboard data available in this build');
    await expect(loaded).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#f-sort')).toHaveValue('score');
    await page.locator('#f-view-curated').click();
    await expect.poll(() => page.url()).toContain('view=curated');
  });

  test('a breakdown count opens the matching station list', async ({ page }) => {
    await page.goto('/catalog-health.html');
    const key = page.locator('#dims button.key:not([disabled])').first();
    const failed = page.locator('#load-status.is-error');
    await expect(key.or(failed)).toBeVisible({ timeout: 20_000 });
    test.skip(await failed.isVisible(), 'no dashboard data available in this build');
    await key.click();
    await expect.poll(() => page.url()).toMatch(/facet=\w+&level=(weak|bad)/);
    await expect(page.locator('.chip')).toBeVisible();
  });
});
