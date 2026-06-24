// Cache-busting for rrradio-hosted favicons (rrradio#577).
//
// We publish self-hosted station logos at *stable* paths (`stations/grrif.png`).
// When we replace a logo's image bytes without changing its URL, installed
// clients keep serving the old cached image — iOS `RemoteImageCache` keys its
// cache purely on the URL and never revalidates, and long-lived browser caches
// behave the same. So a logo update doesn't reach users until eviction or
// reinstall, even though `stations.json` itself refreshes live.
//
// The fix is to make a favicon's URL change whenever its bytes change: append a
// short content hash as a `?v=<hash8>` query at catalog-build time. The path on
// disk stays one file (no per-change renames → no committed-binary churn / git
// bloat, unlike hashed filenames), while every client's URL-keyed cache busts
// because the query is part of the cache key. GitHub Pages ignores the query
// and serves the underlying file.
//
// Scope: only `stations/*` favicons — the ones we host and whose bytes we
// control. Remote third-party favicons (orf.at, wikimedia, …) carry their own
// URLs (and sometimes their own query strings) and are left untouched.

import { createHash } from 'node:crypto';

/** A favicon we host under `public/stations/` — the only kind we cache-bust. */
export function isLocalFavicon(favicon) {
  return typeof favicon === 'string' && /^stations\//.test(favicon);
}

/** First 8 hex chars of the SHA-256 of the image bytes — the cache-bust token. */
export function contentHash8(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}

/**
 * Drop a `?v=<hash>` cache-bust query we previously appended, returning the
 * bare path. Idempotent and safe on un-versioned input. Used both to re-derive
 * the on-disk filename from a published favicon and to keep versioning itself
 * idempotent (strip before re-appending). Only the `v` parameter is removed;
 * any other query a path might carry is preserved.
 */
export function stripFaviconVersion(favicon) {
  if (typeof favicon !== 'string') return favicon;
  const q = favicon.indexOf('?');
  if (q < 0) return favicon;
  const path = favicon.slice(0, q);
  const kept = favicon
    .slice(q + 1)
    .split('&')
    .filter((p) => p && !/^v=/.test(p));
  return kept.length ? `${path}?${kept.join('&')}` : path;
}

/**
 * Append a `?v=<hash8>` cache-bust query to a local favicon path. Strips any
 * existing `v` first so re-running the build never stacks `?v=a&v=b`.
 */
export function withFaviconVersion(favicon, hash8) {
  const base = stripFaviconVersion(favicon);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}v=${hash8}`;
}
