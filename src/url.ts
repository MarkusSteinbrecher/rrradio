/**
 * URL safety + display helpers.
 *
 * Anything from the catalog (favicons, homepages, stream URLs,
 * metadataUrls), from Radio Browser merge data, or from the user's
 * own custom-station list can in principle carry an arbitrary
 * scheme. To keep the UI from constructing `<a href="javascript:…">`
 * or `<a href="data:…">` we route all link rendering through
 * {@link safeUrl} / {@link urlDisplay} which reject anything that
 * isn't `http:` or `https:`.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Validate + canonicalize a URL string for use in an `<a href>`.
 *  Returns the parsed `URL.toString()` value when the input is a
 *  well-formed http(s) URL, `null` otherwise. Use this anywhere
 *  user-clickable links are constructed from catalog / RB / custom-
 *  station data. */
export function safeUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Render a URL as `{ host, href }` for display in a list cell.
 *  Strips a leading `www.` from the host and trims the trailing
 *  slash on root-only paths. Returns null for empty / non-http(s)
 *  inputs so the caller can skip the link entirely. */
export function urlDisplay(
  url: string | undefined | null,
): { host: string; href: string } | null {
  const safe = safeUrl(url);
  if (!safe) return null;
  const u = new URL(safe);
  const host = u.host.replace(/^www\./, '');
  const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
  return { host: path ? `${host}${path}` : host, href: safe };
}
