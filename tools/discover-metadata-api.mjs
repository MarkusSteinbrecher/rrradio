#!/usr/bin/env node
/**
 * Usage:
 *   node tools/discover-metadata-api.mjs --url <player-url>
 *   node tools/discover-metadata-api.mjs --url <player-url> --label srf-3 --wait 30
 *   npm run discover-metadata -- --url <player-url>
 *
 * Loads a broadcaster's web radio player in a headless Chromium, watches
 * every XHR / fetch request, and scores each response on signals that
 * suggest a now-playing API (track / artist / title / cover / show fields,
 * sane size, JSON content-type, CORS-callable from rrradio.org).
 *
 * BUILD-TIME ONLY. The browser never runs Playwright. The output is a
 * shortlist the curator inspects to pick the right URL, then writes a
 * fetcher in src/builtins.ts.
 *
 * Output: writes JSON to data/metadata-discovery/<label>.json (gitignored).
 *
 * The launcher and the bundled headless shell both stay on this machine.
 * No data leaves the network beyond the broadcaster's own player traffic.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT_DIR = path.join(ROOT, 'data', 'metadata-discovery');

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return args[i + 1];
}
const URL_ARG = flag('url');
const LABEL = String(flag('label', 'unlabeled')).replace(/[^a-z0-9-]/gi, '-');
const WAIT_S = Math.max(5, Math.min(120, Number(flag('wait', 30))));
const SCROLL = !args.includes('--no-scroll');

if (!URL_ARG) {
  console.error('usage: discover-metadata-api.mjs --url <player-url> [--label srf-3] [--wait 30]');
  process.exit(1);
}

const ORIGIN = 'https://rrradio.org';

// Heuristics for "this looks like a now-playing endpoint"
const TRACK_KEYS = /\b(title|artist|track|song|now[_-]?playing|nowAndNext|onair|currentSong|playing|interpret|titel|artistName|songTitle)\b/i;
const COVER_KEYS = /\b(image|cover|artwork|imageUrl|thumbnail)\b/i;
const SHOW_KEYS = /\b(show|programme|program|broadcast|sendung|emission|trasmissione)\b/i;
const PATH_HINTS = /\b(songlog|songlist|playlist|liveplay|onair|now|playing|liveCenter|nowAndNext|programGuide|currentTrack|live\b)\b/i;

function score(req) {
  let s = 0;
  const reasons = [];
  if (req.contentType?.includes('json')) { s += 1; reasons.push('json-ct'); }
  if (PATH_HINTS.test(req.url)) { s += 2; reasons.push('path-hint'); }
  if (TRACK_KEYS.test(req.bodySample || '')) { s += 3; reasons.push('track-keys'); }
  if (COVER_KEYS.test(req.bodySample || '')) { s += 1; reasons.push('cover-keys'); }
  if (SHOW_KEYS.test(req.bodySample || '')) { s += 1; reasons.push('show-keys'); }
  if (req.size && req.size > 80 && req.size < 50_000) { s += 1; reasons.push('sane-size'); }
  if (req.method === 'GET') { s += 0.5; reasons.push('GET'); }
  return { score: s, reasons };
}

async function corsCheck(url) {
  try {
    const res = await fetch(url, { headers: { Origin: ORIGIN } });
    const allow = res.headers.get('access-control-allow-origin') || null;
    return {
      ok: res.ok,
      status: res.status,
      allowOrigin: allow,
      callable: allow === '*' || allow === ORIGIN,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 100) };
  }
}

console.log(`Discovery run: ${URL_ARG}`);
console.log(`Wait: ${WAIT_S}s · label: ${LABEL}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();

const captured = new Map();

page.on('response', async (res) => {
  try {
    const url = res.url();
    if (!/^https?:/i.test(url)) return;
    const req = res.request();
    if (req.resourceType() === 'image' || req.resourceType() === 'font' || req.resourceType() === 'stylesheet') return;
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    // Only inspect JSON-ish or unknown text bodies; skip large media
    const skip = /^(audio|video|image|font|application\/octet-stream)/.test(ct);
    let bodySample = '';
    let size = 0;
    if (!skip) {
      try {
        const buf = await res.body();
        size = buf.length;
        if (size > 0 && size < 200_000) {
          bodySample = buf.toString('utf8').slice(0, 4000);
        }
      } catch {
        /* response not buffered (redirect / preflight) */
      }
    }
    const key = `${req.method()} ${url}`;
    if (!captured.has(key)) {
      captured.set(key, {
        method: req.method(),
        url,
        status: res.status(),
        contentType: ct,
        size,
        bodySample,
        resourceType: req.resourceType(),
      });
    }
  } catch {
    /* ignore one-off response errors */
  }
});

try {
  await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Try to dismiss a consent dialog so the player runs.
  try {
    await page.waitForSelector('button:has-text("Akzeptieren"), button:has-text("Accept"), button:has-text("Tout accepter"), button:has-text("Accetto")', { timeout: 5000 });
    await page.click('button:has-text("Akzeptieren"), button:has-text("Accept"), button:has-text("Tout accepter"), button:has-text("Accetto")', { timeout: 2000 });
    console.log('  · dismissed consent dialog');
  } catch {
    /* no banner or already accepted */
  }
  // Try to start playback (some players defer track-info XHR until play).
  try {
    await page.click('button[aria-label*="Play"], button[aria-label*="play"], button[title*="Play" i], .play-button, [data-testid*="play" i]', { timeout: 2000 });
    console.log('  · attempted play click');
  } catch { /* no obvious play button */ }
  if (SCROLL) {
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight / 2));
  }
  console.log(`  · capturing for ${WAIT_S}s ...`);
  await page.waitForTimeout(WAIT_S * 1000);
} catch (err) {
  console.error('navigation error:', err.message || err);
} finally {
  await browser.close();
}

const all = [...captured.values()];
const scored = all.map((r) => ({ ...r, ...score(r) })).sort((a, b) => b.score - a.score);
const top = scored.filter((r) => r.score >= 2).slice(0, 25);

console.log('');
console.log(`Captured ${all.length} unique requests · ${top.length} above threshold`);
console.log('');
console.log('Top candidates:');
for (const r of top.slice(0, 10)) {
  console.log(`  [${r.score.toFixed(1)}] ${r.method} ${r.url}`);
  console.log(`        ct=${r.contentType} size=${r.size} reasons=${r.reasons.join(',')}`);
  if (r.bodySample) {
    const peek = r.bodySample.replace(/\s+/g, ' ').slice(0, 200);
    console.log(`        body: ${peek}${r.bodySample.length > 200 ? '…' : ''}`);
  }
}

// CORS-check the top 5 to flag whether each is callable from the browser.
console.log('');
console.log('CORS check (top 5):');
for (const r of top.slice(0, 5)) {
  if (r.method !== 'GET') {
    console.log(`  · ${r.url}  (skipped — non-GET)`);
    continue;
  }
  const c = await corsCheck(r.url);
  const verdict = c.callable ? 'callable' : c.allowOrigin ? `restricted (${c.allowOrigin})` : 'no-cors';
  console.log(`  · ${r.url}`);
  console.log(`    → ${verdict}`);
}

await mkdir(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `${LABEL}.json`);
await writeFile(outFile, JSON.stringify({ url: URL_ARG, capturedAt: new Date().toISOString(), top, all: scored }, null, 2));
console.log('');
console.log(`Wrote ${path.relative(ROOT, outFile)}`);
