/**
 * Offline mirror of `URL_PATTERN_RULES` in src/builtins.ts: stations with
 * no `metadata` key that the web app still wires to a fetcher by stream
 * URL. Keep in sync with that list (FM4 is omitted — its catalog rows
 * already carry `metadata: orf`).
 */

/** Same rule as `tritonMount()` in src/triton.ts (#233). */
export function tritonMount(streamUrl) {
  let url;
  try {
    url = new URL(streamUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)streamtheworld\.com$/i.test(url.hostname)) return null;
  const last = url.pathname.split('/').pop() ?? '';
  const mount = last
    .replace(/;.*$/, '')
    .replace(/\.(aac|mp3|m3u8|m3u|pls|flv)$/i, '')
    .replace(/_SC$/i, '');
  return /^[A-Za-z0-9_]+$/.test(mount) ? mount : null;
}

/** Fetcher key the web app resolves for a station: its own `metadata`
 *  key first (as findFetcher does), else a URL-pattern rule, else null. */
export function effectiveMetadataKey(station) {
  const key = typeof station?.metadata === 'string' ? station.metadata.trim() : '';
  if (key) return key;
  const streamUrl = typeof station?.streamUrl === 'string' ? station.streamUrl : '';
  if (tritonMount(streamUrl) !== null) return 'triton';
  return null;
}
