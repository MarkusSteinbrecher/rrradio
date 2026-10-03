/**
 * Logo probe (ADR 002 phase 3 — catalog quality loop).
 *
 * The daily station probe fetches each targeted station's favicon and
 * records what actually happened — did it load, is it an image, how big —
 * as an `f: "logo"` observation row. derive-health turns those rows into
 * the health record's `logo` facet; health-policy clears a favicon whose
 * URL has been hard-dead for HARD_DAYS distinct days.
 *
 * Verdict vocabulary (the `d` detail is shared with the record and the
 * observation log — stable words only, never a URL or a size):
 *
 *   ok    good | acceptable | vector          loads, decodes, big enough
 *   warn  poor | unknown                      loads, but too small / undecodable size
 *         generic | third-party | non-free-wiki
 *                                             loads, but the URL heuristics
 *                                             (logo-quality) say it is not a
 *                                             logo we want to keep as-is
 *   bad   missing                             no favicon at all
 *         http                                plain-http URL whose https twin
 *                                             loads and decodes — the app's CSP
 *                                             (img-src https:) never shows the
 *                                             http URL; rule 8b upgrades it
 *         unsupported-scheme | not-image      not fetchable / not an image
 *         HTTP <n> | timeout | dns | refused | reset | tls | network
 *                                             the shared probe error tokens
 *
 * Hard (will not fix itself) vs soft (retry, wait for a streak) follows the
 * stream probe's split, plus the two deterministic logo-only failures.
 *
 * A plain-http favicon is probed through its https twin (issue #701): when
 * the twin fails, the row records *that* failure (so a dead http logo
 * reaches rule 8's hard/soft logic like any other); when it loads, the row
 * says `http` — "fix available", which rule 8b's upgrade-logo applies.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseImageHeader, bucketForNp } from './image-header.mjs';
import { stripFaviconVersion } from './favicon-version.mjs';
import { classifyError } from './homepage-status.mjs';
import { classifyLogoUrl } from '../logo-quality.mjs';

/** Bad logo details that mean "this will not fix itself". `missing` is
 *  hard too — but the policy has nothing to clear for it. Plain `http` is
 *  deliberately soft: 1,500 catalog favicons are http listings that mostly
 *  answer over https, so the right action is an upgrade (rule 8b,
 *  upgrade-logo, #701), not a clear. */
export const LOGO_HARD_DETAILS = Object.freeze(
  new Set(['HTTP 404', 'HTTP 410', 'dns', 'refused', 'missing', 'unsupported-scheme', 'not-image']),
);

/** URL-heuristic tiers that downgrade a loading logo to warn, with the tier as detail. */
const HEURISTIC_WARN_TIERS = new Set(['generic', 'third-party', 'non-free-wiki']);

const PROBE_BYTES = 64 * 1024;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

/** @typedef {{status: number|'failed'|'local', contentType?: string|null, errorToken?: string,
 *             header?: {format: string, width?: number, height?: number}|null, bytes?: number|null, ms: number,
 *             via?: 'https'}} LogoProbe  `via` = an http favicon probed through its https twin */

/**
 * Fetch and decode a favicon far enough to know what it is.
 *
 * - `stations/…` (curated local asset, published with a `?v=` cache-bust)
 *   is read from `publicDir` on disk.
 * - `https://…` is fetched with a 64 KB range and a browser UA (Wikimedia
 *   403s the default one).
 * - `http://…` is never fetched as-is (the app's CSP could not show it
 *   anyway); its https twin (`httpsVariant`) is, and the result carries
 *   `via: 'https'` so classifyLogo knows the listing itself is still http.
 *
 * Never throws; every failure is a `{status: 'failed', errorToken}`.
 *
 * @param {string|null|undefined} favicon
 * @param {{timeout?: number, publicDir?: string, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<LogoProbe|null>} null when there is no favicon
 */
export async function probeLogo(favicon, opts = {}) {
  const t0 = Date.now();
  const timeout = opts.timeout ?? 8000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (typeof favicon !== 'string' || !favicon.trim()) return null;
  const fav = favicon.trim();

  if (/^stations\//.test(fav)) {
    const rel = stripFaviconVersion(fav);
    try {
      const path = join(opts.publicDir ?? 'public', rel);
      const size = statSync(path).size;
      const buf = readFileSync(path).subarray(0, PROBE_BYTES);
      return { status: 'local', contentType: null, header: parseImageHeader(buf), bytes: size, ms: Date.now() - t0 };
    } catch (err) {
      return { status: 'failed', errorToken: err?.code === 'ENOENT' ? 'HTTP 404' : 'network', ms: Date.now() - t0 };
    }
  }
  if (/^http:\/\//i.test(fav)) {
    const twin = httpsVariant(fav);
    if (!twin) return { status: 'failed', errorToken: 'http', ms: 0 };
    return { ...(await fetchLogo(twin, timeout, fetchImpl, t0)), via: 'https' };
  }
  if (!/^https:\/\//i.test(fav)) return { status: 'failed', errorToken: 'unsupported-scheme', ms: 0 };
  return fetchLogo(fav, timeout, fetchImpl, t0);
}

/**
 * The https twin of a plain-http URL: scheme swapped, an explicit `:80`
 * dropped, host / path / query kept — the same rule #689 applies to Radio
 * Browser stream URLs. Null for anything that is not a parseable http URL.
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
export function httpsVariant(url) {
  if (typeof url !== 'string' || !/^http:\/\//i.test(url.trim())) return null;
  try {
    const u = new URL(url.trim());
    u.protocol = 'https:';
    if (u.port === '80') u.port = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** @returns {Promise<LogoProbe>} */
async function fetchLogo(fav, timeout, fetchImpl, t0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    let res = await fetchImpl(fav, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8', Range: `bytes=0-${PROBE_BYTES - 1}` },
    });
    if (res.status === 416) {
      res = await fetchImpl(fav, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' } });
    }
    const ct = (res.headers.get('content-type') ?? '').toLowerCase() || null;
    if (!(res.ok || res.status === 206)) {
      try { await res.body?.cancel(); } catch {}
      return { status: res.status, contentType: ct, header: null, bytes: null, ms: Date.now() - t0 };
    }
    const buf = await readPrefix(res, PROBE_BYTES);
    const range = res.headers.get('content-range');
    const total = range?.match(/\/(\d+)$/)?.[1] ?? (res.status !== 206 ? res.headers.get('content-length') : null);
    return {
      status: res.status,
      contentType: ct,
      header: parseImageHeader(buf),
      bytes: total ? Number(total) : buf.length,
      ms: Date.now() - t0,
    };
  } catch (err) {
    return { status: 'failed', errorToken: classifyError(err), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function readPrefix(res, max) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  try {
    while (n < max) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(Buffer.from(value));
      n += value.length;
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  return Buffer.concat(chunks).subarray(0, max);
}

/**
 * Verdict for a favicon from what the probe saw. Pure.
 * @param {string|null|undefined} favicon
 * @param {LogoProbe|null} probe
 * @returns {{v: 'ok'|'warn'|'bad', d: string}}
 */
export function classifyLogo(favicon, probe) {
  if (typeof favicon !== 'string' || !favicon.trim()) return { v: 'bad', d: 'missing' };
  if (!probe) return { v: 'bad', d: 'missing' };
  if (probe.status === 'failed') return { v: 'bad', d: probe.errorToken ?? 'network' };
  if (typeof probe.status === 'number' && probe.status >= 400) return { v: 'bad', d: `HTTP ${probe.status}` };
  if (!probe.header) return { v: 'bad', d: 'not-image' };
  // An http listing whose https twin loads and decodes: still not showable
  // as published (CSP), but fixable — rule 8b rewrites it to the twin.
  if (/^http:\/\//i.test(favicon.trim())) return { v: 'bad', d: 'http' };

  // It loads and it is an image. Now: is it a logo we want? The URL
  // heuristics know things pixels cannot (a placeholder host, a
  // third-party aggregator, a non-free Wikipedia upload).
  const heuristic = classifyLogoUrl(favicon);
  if (HEURISTIC_WARN_TIERS.has(heuristic.tier)) return { v: 'warn', d: heuristic.tier };

  const bucket = bucketForNp(probe.header);
  if (bucket === 'good' || bucket === 'acceptable' || bucket === 'vector') return { v: 'ok', d: bucket };
  return { v: 'warn', d: bucket === 'poor' ? 'poor' : 'unknown' };
}

/** @param {string|null|{v: string, d?: string}} input @returns {'hard'|'soft'|null} */
export function logoFailureClass(input) {
  if (input && typeof input === 'object') return input.v === 'bad' ? logoFailureClass(input.d ?? null) : null;
  return LOGO_HARD_DETAILS.has(input ?? '') ? 'hard' : 'soft';
}

/**
 * One `f: "logo"` observation row (not yet normalised).
 * @param {{station: {id: string}, verdict: {v: string, d?: string}, probe: LogoProbe|null, at: string}} input
 */
export function toLogoObservation({ station, verdict, probe, at }) {
  return {
    id: station.id,
    at,
    v: 'gha',
    f: 'logo',
    o: verdict.v,
    c: verdict.v === 'bad' ? logoFailureClass(verdict.d ?? null) : null,
    s: typeof probe?.status === 'number' ? probe.status : null,
    ct: probe?.contentType || null,
    ms: typeof probe?.ms === 'number' ? probe.ms : null,
    d: verdict.d ?? null,
    r: false,
  };
}
