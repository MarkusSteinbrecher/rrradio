/**
 * Shared URL normalizers for duplicate detection. One definition so the
 * dedupe tools (dedupe-raw, check-duplicates, import-playable-candidates,
 * curation-db) agree on what "the same stream / homepage" means.
 *
 * The name signature lives in ./station-name-signature.mjs (also shared).
 */

const MAX_UNWRAP_DEPTH = 3;

/**
 * Unwrap a proxy/redirect wrapper to the real stream URL it carries. Some RB
 * entries route a stream through an open proxy that puts the *actual* URL in a
 * query param, e.g.
 *
 *   http://worldradio.online/proxy/?q=http://wz0liw.scahw.com.au/live/rnb-chill.stream/...
 *
 * Left wrapped, every channel on the proxy normalises to `//worldradio.online/proxy`
 * (the query is dropped) and the exact-stream-url signal fuses them into one giant
 * false group — this is the root of the 177-station "LiSTNR" over-merge, where 66
 * distinct SCA channels collapsed onto the proxy path and union-find then glued in
 * unrelated stations. Unwrapping to the inner URL makes each channel distinct again
 * AND lets a proxied entry dedupe against a direct copy of the same stream.
 *
 * Conservative: only unwraps when a query value is itself an absolute http(s) URL
 * (a strong proxy signal); a normal `?ch=2` selector is untouched. Bounded depth
 * guards against proxy-of-proxy loops.
 *
 * @param {string} u
 * @returns {string}
 */
export function unwrapProxyUrl(u) {
  let cur = String(u ?? '');
  for (let i = 0; i < MAX_UNWRAP_DEPTH; i++) {
    let inner = null;
    try {
      for (const v of new URL(cur).searchParams.values()) {
        if (/^https?:\/\/.+/i.test(v)) { inner = v; break; }
      }
    } catch {
      break;
    }
    if (!inner || inner === cur) break;
    cur = inner;
  }
  return cur;
}

/**
 * Canonical key for a stream URL.
 *
 * - **Proxy-unwrapped.** A stream routed through a `?q=<real-url>` proxy keys on
 *   the real URL, not the proxy (see {@link unwrapProxyUrl}).
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
    const x = new URL(unwrapProxyUrl(u));
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
 * Path-segment sub-tokens that mark delivery/format/bitrate/quality rather
 * than station identity. Deliberately conservative: a stream *fingerprint*
 * is a HIGH-confidence "same feed" signal, so we only strip tokens that are
 * unambiguously codec / packaging / quality / bitrate — never generic path
 * words like `radio`, `stream`, `live`, `listen`, `audio`, which are often a
 * path's only identifying segment and must not be discarded.
 */
const URL_NOISE_TOKENS = new Set([
  // codecs / containers
  'mp3', 'aac', 'aacp', 'aacplus', 'heaac', 'ogg', 'vorbis', 'opus', 'flac', 'wav', 'mpeg', 'mp4',
  // packaging / transport
  'hls', 'dash', 'ts', 'm3u8', 'm3u', 'pls', 'manifest', 'playlist', 'seglist', 'chunklist',
  'segment', 'segments', 'icecast', 'shoutcast',
  // quality words
  'low', 'lo', 'lq', 'mid', 'med', 'medium', 'high', 'hi', 'hq', 'sd', 'hd', 'std', 'standard',
  'normal', 'premium',
  // bitrates (standard set, bare + k-suffixed). Bare numbers are stripped
  // ONLY when they're in this known-bitrate set — arbitrary digits are station
  // IDs (qingting `/live/1278/…`, radioking `/radio/623812/…`) and must survive.
  '32', '48', '56', '64', '80', '96', '112', '128', '160', '192', '224', '256', '320',
  '32k', '48k', '56k', '64k', '80k', '96k', '112k', '128k', '160k', '192k', '224k', '256k', '320k',
  'kbps', 'kbit', 'kbits',
]);

/**
 * Generic structural path words that never identify a station on their own.
 * If the *only* tokens left after noise-stripping are these (e.g. a proxy
 * wrapper `/proxy/?q=…`, or an aggregator `/radio/stream` whose id lives in a
 * dropped query), the path carries no identity and we must NOT fingerprint —
 * otherwise every tenant on that host collapses into one giant false group.
 */
const GENERIC_PATH_WORDS = new Set([
  'live', 'livestream', 'stream', 'streams', 'streaming', 'radio', 'listen',
  'play', 'playing', 'audio', 'sound', 'proxy', 'src', 'source', 'broadcast', 'mount',
]);

/**
 * High-confidence "same physical feed" key: the stream's host + path with
 * bitrate / codec / packaging tokens stripped, so delivery variants of one
 * feed on the same CDN path collapse together even when their exact URLs
 * differ.
 *
 *   .../m/drs4news/mp3_128  ┐
 *   .../m/drs4news/aacp_96  ├─ all → //stream.srg-ssr.ch/m/drs4news
 *   .../m/drs4news/aacp_32  ┘
 *   .../b1obb/hls/96/seglist.m3u8  ┐
 *   .../b1obb/hls/192/seglist.m3u8 ┘ → //br-radio.ard-mcdn.de/br/radio/b1obb
 *
 * Each path segment is split on `._-`; sub-tokens that are noise (above) or
 * a bare/`k`-suffixed number are dropped, the rest rejoined. Returns `''`
 * for unparseable input OR when nothing but the host survives — a host-only
 * fingerprint would sweep every unrelated stream on that host into one
 * group, so callers (which skip empty keys) must not group on it. Host keeps
 * its port: `:8000` vs `:8001` are distinct Shoutcast mounts.
 *
 * @param {string} u
 * @returns {string}
 */
export function streamFingerprint(u) {
  if (!u) return '';
  let host, pathname;
  try {
    const x = new URL(String(u));
    host = x.host.toLowerCase().replace(/^www\./, '');
    pathname = x.pathname;
  } catch {
    return '';
  }
  const kept = [];
  for (const seg of pathname.toLowerCase().split('/').filter(Boolean)) {
    const sub = seg
      .split(/[._-]+/)
      .filter((t) => t && !URL_NOISE_TOKENS.has(t) && !/^\d+k$/.test(t));
    if (sub.length) kept.push(sub.join('-'));
  }
  if (!kept.length) return '';
  // All surviving tokens generic → the path doesn't identify a station.
  if (kept.flatMap((s) => s.split('-')).every((t) => GENERIC_PATH_WORDS.has(t))) return '';
  return `//${host}/${kept.join('/')}`;
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
