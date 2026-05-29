/**
 * Shared URL normalizers for duplicate detection. One definition so the
 * dedupe tools (dedupe-raw, check-duplicates, import-playable-candidates,
 * curation-db) agree on what "the same stream / homepage" means.
 *
 * The name signature lives in ./station-name-signature.mjs (also shared).
 */

/**
 * Canonical key for a stream URL.
 *
 * - **Protocol-insensitive.** `http://h/p` and `https://h/p` are the same
 *   physical stream; the catalog is HTTPS-only so the scheme carries no
 *   identity. (Recovered ~794 unmerged http/https sibling clusters in the
 *   raw RB DB.) The leading `//` keeps the key URL-ish for readability.
 * - **Host lowercased, leading `www.` dropped.**
 * - **Trailing slash stripped** from the path.
 * - **Query string:** `dropQuery: true` (default — cross-country raw dedupe)
 *   removes it. Query is overwhelmingly cache-buster / tracking / session
 *   noise (`?ref=`, `?_=1`, `?listening-from-radio-garden=`) that should not
 *   keep two feeds of one stream apart. `dropQuery: false` (the curated
 *   catalog gate) keeps it, because our hand-picked URLs occasionally use it
 *   as a channel selector (`?i=`, `?ch=`) and rarely carry session noise.
 *
 * @param {string} u
 * @param {{dropQuery?: boolean}} [opts]
 * @returns {string}
 */
export function normalizeStreamUrl(u, { dropQuery = true } = {}) {
  if (!u) return '';
  try {
    const x = new URL(String(u));
    const host = x.host.toLowerCase().replace(/^www\./, '');
    const path = x.pathname.replace(/\/+$/, '') || '/';
    const query = dropQuery ? '' : x.search;
    return `//${host}${path}${query}`;
  } catch {
    return String(u).trim().toLowerCase();
  }
}

/** Host of a stream URL (lowercased, `www.` dropped); '' when unparseable. */
export function streamHost(u) {
  try {
    return new URL(String(u)).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Canonical key for a homepage URL. `''` when there's no host (callers using
 * this as a grouping key skip empty keys, so missing homepages don't pile
 * into a false-positive bucket).
 *
 * - Host lowercased, leading `www.` dropped.
 * - `includePath: false` (default) → host only (broadcaster-home grouping).
 * - `includePath: true` → host + path, with a trailing `/index.{html,htm,php}`
 *   and trailing slash stripped (distinguishes sub-pages under one host).
 *
 * @param {string} u
 * @param {{includePath?: boolean}} [opts]
 * @returns {string}
 */
export function normalizeHomepage(u, { includePath = false } = {}) {
  try {
    const x = new URL(String(u));
    const host = x.host.toLowerCase().replace(/^www\./, '');
    if (!host) return '';
    if (!includePath) return host;
    const path = x.pathname.replace(/\/index\.(html?|php)$/i, '').replace(/\/$/, '');
    return `${host}${path}`;
  } catch {
    return '';
  }
}
