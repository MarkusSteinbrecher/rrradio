/**
 * Stream-variant fallback + Best / Data toggle (#95, #623).
 *
 * FM4 ships two variants in the catalog (`fm4-q2a` 192k best, `fm4-q1a`
 * 128k data). We make the best variant fail at the network layer and
 * serve a short silent WAV for the data variant, then assert that the
 * player walks the retry ladder (visible "Reconnecting" state), falls
 * back to the 128k variant and ends up playing — not in `error`.
 */
import { expect, test } from 'playwright/test';

/** 20 s of 8 kHz / 8-bit mono silence — small, and decodable by every
 *  Chromium build (no proprietary codecs needed). */
function silentWav(seconds = 20, rate = 8000): Buffer {
  const data = rate * seconds;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28); // byte rate (8-bit mono)
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(data, 40);
  buf.fill(128, 44); // 8-bit PCM silence is the midpoint
  return buf;
}

test('falls back to the next stream variant before surfacing an error', async ({ page }) => {
  test.setTimeout(60_000);
  const wav = silentWav();
  const requested: string[] = [];
  await page.route('**/fm4-q2a*', (route) => {
    requested.push('q2a');
    return route.abort();
  });
  await page.route('**/fm4-q1a*', (route) => {
    requested.push('q1a');
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
  });

  await page.goto('/');
  await expect(page.locator('.disc-chip').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('#search').fill('fm4');
  const row = page.locator('#content .row[data-id="builtin-fm4"]').first();
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.click();

  // The ladder's retry state is visible in the mini-player meta line.
  await expect(page.locator('#mini-meta')).toHaveText(/RECONNECTING|TRYING BACKUP/, {
    timeout: 10_000,
  });
  // 1 + 2 + 4 s of backoff on the best variant, then the data variant.
  await expect(page.locator('body')).toHaveClass(/is-playing/, { timeout: 20_000 });
  expect(requested).toContain('q2a');
  expect(requested).toContain('q1a');

  // Station info shows the variant actually playing + the quality toggle.
  await page.locator('#mini-open').click();
  await page.locator('#np-station-logo-btn').click();
  await expect(page.locator('#np-bitrate')).toHaveText(/128 kbps/);
  const seg = page.locator('#np-quality-seg');
  await expect(seg).toBeVisible();
  await expect(seg.locator('[data-quality="best"]')).toHaveAttribute('aria-checked', 'true');

  // Choosing Data saver persists the preference and keeps playing.
  await seg.locator('[data-quality="data"]').click();
  await expect(seg.locator('[data-quality="data"]')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('rrradio.qualityPref.v1'))).toBe('data');
  await expect(page.locator('body')).toHaveClass(/is-playing/, { timeout: 10_000 });
});
