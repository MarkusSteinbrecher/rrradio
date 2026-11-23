/**
 * I/O half of the logo-fill rule (ADR 002, rule 9): fetch a station's
 * homepage, try the icons it declares, and return the first one that
 * survives every deterministic guard. The pure half is logo-fill.mjs.
 *
 * Guards, in order — each is something a wrong logo did in the June sweeps:
 *   - the image loads cross-origin with a foreign Referer (hotlink 403s),
 *   - it decodes, is big enough and (for og:image) square,
 *   - it is visible on the app's dark theme (black-on-transparent marks),
 *   - the site does not swap in a placeholder for foreign Referers,
 *   - the probe itself would grade it `ok` (so a fill moves the metric).
 * Platform defaults are dropped afterwards, across the batch, by hash.
 */

import sharp from 'sharp';
import { classifyLogo, probeLogo } from './logo-probe.mjs';
import { dhashHex, extractLogoCandidates, hamming, manifestIcons, orderCandidates, rejectDimensions, siteOf } from './logo-fill.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
/** The origin a logo is hotlinked from in production. */
const APP_REFERER = 'https://rrradio.org/';
/** The app frames logos over this colour by default (dark theme `--bg-2`). */
export const DARK_BG = '#1e1d19';
const DARK_LUMA = 29;
/** A mark whose brightest pixel is this close to the background is invisible. */
const MIN_CONTRAST = 48;
export const TILE = 200;
const MAX_CANDIDATES = 5;
/** Two fetches of one logo hash alike; a swapped-in placeholder does not. */
const HOTLINK_HASH_GAP = 10;

/**
 * GET with one deadline covering headers and body, and a byte cap. A
 * "homepage" that is really the stream never ends — the cap and the
 * content-type check keep it from hanging the run.
 * @returns {Promise<{status: number, url: string, contentType: string, buf: Buffer}>}
 */
export async function fetchCapped(url, { timeout = 12_000, maxBytes = 1_500_000, accept = '*/*', referer, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = { 'User-Agent': UA, Accept: accept };
    if (referer) headers.Referer = referer;
    const res = await fetchImpl(url, { signal: ctrl.signal, headers, redirect: 'follow' });
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (/^(audio|video)\/|mpegurl|application\/ogg/.test(contentType)) {
      ctrl.abort();
      throw new Error('stream');
    }
    const chunks = [];
    let n = 0;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        while (n < maxBytes) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
          n += value.length;
        }
      } finally {
        try { await reader.cancel(); } catch { /* already closed */ }
      }
    }
    return { status: res.status, url: res.url || url, contentType, buf: Buffer.concat(chunks).subarray(0, maxBytes) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decode an image far enough to judge it: size, a tile on the dark theme
 * for the judge, the hash for the platform-default check, and whether
 * anything in it stands out from the dark background.
 * @param {Buffer} buf
 * @returns {Promise<{width: number, height: number, format: string, hash: string, contrast: number, tile: Buffer}>}
 */
export async function inspectImage(buf) {
  const img = sharp(buf, { limitInputPixels: 40_000_000, density: 192 });
  const meta = await img.metadata();
  const flat = (size, fit) => sharp(buf, { limitInputPixels: 40_000_000, density: 192 }).resize(size[0], size[1], { fit, background: DARK_BG }).flatten({ background: DARK_BG });
  const gray = await flat([9, 8], 'fill').grayscale().raw().toBuffer();
  const sample = await flat([48, 48], 'contain').grayscale().raw().toBuffer();
  let contrast = 0;
  for (const v of sample) contrast = Math.max(contrast, Math.abs(v - DARK_LUMA));
  const tile = await flat([TILE, TILE], 'contain').png().toBuffer();
  return { width: meta.width ?? 0, height: meta.height ?? 0, format: meta.format ?? '', hash: dhashHex(gray), contrast, tile };
}

/**
 * @typedef {{id: string, site: string, homepage: string, url: string, kind: string,
 *            width: number, height: number, format: string, hash: string, tile: Buffer}} LogoFind
 */

/**
 * Look for one station's logo on its homepage.
 * @param {{id: string, homepage: string}} station
 * @param {{fetchImpl?: typeof fetch, probe?: typeof probeLogo, timeout?: number}} [opts]
 * @returns {Promise<{id: string, outcome: 'found'|'none'|'rejected'|'fetch-failed', detail?: string, find?: LogoFind}>}
 */
export async function findLogo(station, opts = {}) {
  const { fetchImpl = fetch, probe = probeLogo, timeout = 12_000 } = opts;
  const { id, homepage } = station;
  let page;
  try {
    page = await fetchCapped(homepage, { timeout, maxBytes: 700_000, accept: 'text/html,application/xhtml+xml', fetchImpl });
  } catch (err) {
    return { id, outcome: 'fetch-failed', detail: err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? 'network').slice(0, 40) };
  }
  if (page.status >= 400) return { id, outcome: 'fetch-failed', detail: `HTTP ${page.status}` };

  const { candidates, manifestUrl } = extractLogoCandidates(page.buf.toString('utf8'), page.url);
  let all = candidates;
  if (manifestUrl) {
    try {
      const m = await fetchCapped(manifestUrl, { timeout, maxBytes: 200_000, fetchImpl });
      if (m.status < 400) all = orderCandidates([...candidates, ...manifestIcons(JSON.parse(m.buf.toString('utf8')), m.url)]);
    } catch { /* a broken manifest is not a broken homepage */ }
  }
  if (all.length === 0) return { id, outcome: 'none' };

  let lastReason = 'none';
  for (const c of all.slice(0, MAX_CANDIDATES)) {
    try {
      const res = await fetchCapped(c.url, { timeout, maxBytes: 3_000_000, accept: 'image/*,*/*;q=0.8', referer: APP_REFERER, fetchImpl });
      if (res.status >= 400) { lastReason = `HTTP ${res.status}`; continue; }
      if (!/^https:\/\//i.test(res.url)) { lastReason = 'redirects-to-http'; continue; }
      const info = await inspectImage(res.buf);
      const bad = rejectDimensions(c.kind, info.width, info.height, info.format);
      if (bad) { lastReason = bad; continue; }
      if (info.contrast < MIN_CONTRAST) { lastReason = 'invisible-on-dark'; continue; }
      // Hotlink protection answers 200 with a "stop" picture when the Referer
      // is foreign (ort.com.mx, dry run 2026-11-23): the app would show that,
      // so compare against what the site's own page gets.
      const own = await fetchCapped(c.url, { timeout, maxBytes: 3_000_000, accept: 'image/*,*/*;q=0.8', referer: page.url, fetchImpl });
      if (own.status < 400 && hamming((await inspectImage(own.buf)).hash, info.hash) > HOTLINK_HASH_GAP) { lastReason = 'hotlink-protected'; continue; }
      // The metric is the probe's verdict, so the probe has the last word.
      const verdict = classifyLogo(c.url, await probe(c.url, { timeout: 8000, fetchImpl }));
      if (verdict.v !== 'ok') { lastReason = `probe ${verdict.d}`; continue; }
      return {
        id,
        outcome: 'found',
        find: { id, site: siteOf(page.url), homepage: page.url, url: c.url, kind: c.kind, width: info.width, height: info.height, format: info.format, hash: info.hash, tile: info.tile },
      };
    } catch (err) {
      lastReason = err?.name === 'AbortError' ? 'timeout' : 'undecodable';
    }
  }
  return { id, outcome: 'rejected', detail: lastReason };
}

/** Run `findLogo` over a batch with bounded concurrency and a hard per-station deadline. */
export async function findLogos(stations, { concurrency = 8, deadline = 45_000, ...opts } = {}) {
  const results = new Array(stations.length);
  let next = 0;
  const worker = async () => {
    while (next < stations.length) {
      const i = next++;
      const s = stations[i];
      let timer;
      results[i] = await Promise.race([
        findLogo(s, opts).catch((err) => ({ id: s.id, outcome: 'fetch-failed', detail: String(err?.message ?? 'error').slice(0, 40) })),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ id: s.id, outcome: 'fetch-failed', detail: 'deadline' }), deadline); }),
      ]);
      clearTimeout(timer);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, stations.length) || 1 }, worker));
  return results;
}
