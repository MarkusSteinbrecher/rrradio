/**
 * Station facts for the pre-rendered /station/<id>/ pages (#90): stream
 * quality, now-playing + schedule availability, and the official homepage.
 * Pure functions so tools/build-station-pages.mjs stays a thin emitter and
 * the rules are unit-testable.
 *
 * Inputs are one row of public/stations.json plus (optionally) its row in
 * public/station-capabilities.json. Every fact is optional: a missing input
 * drops the row instead of rendering an empty or placeholder value.
 */

/** "MP3 · 192 kbps", "AAC", "128 kbps", or null when neither is known. */
export function streamQualityText(s) {
  const codec = typeof s.codec === 'string' ? s.codec.trim().toUpperCase() : '';
  const bitrate = Number(s.bitrate);
  const parts = [];
  if (codec) parts.push(codec);
  if (Number.isFinite(bitrate) && bitrate > 0) parts.push(`${Math.round(bitrate)} kbps`);
  return parts.length ? parts.join(' · ') : null;
}

/** Human phrase for how now-playing info arrives, from the capabilities
 *  `metadataStrategy` (api | icy | hls | none). Null when unknown. */
export function nowPlayingText(cap) {
  switch (cap?.metadataStrategy) {
    case 'api':
      return 'Live track and artist info from the broadcaster';
    case 'icy':
    case 'hls':
      return 'Live track titles from the stream';
    case 'none':
      return 'Not published by this station';
    default:
      return null;
  }
}

/** Only true schedule support earns a row — "no schedule" is the norm and
 *  adds nothing for a reader or a crawler. */
export function scheduleText(cap) {
  return cap?.hasSchedule ? "Today's programme schedule in the player" : null;
}

/** A safe http(s) homepage URL plus a short display label (host without
 *  "www."), or null. Anything else (javascript:, relative, junk) is dropped. */
export function homepageLink(s) {
  if (typeof s.homepage !== 'string' || !s.homepage.trim()) return null;
  let url;
  try {
    url = new URL(s.homepage.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return { href: url.href, label: url.hostname.replace(/^www\./, '') };
}

/** Absolute logo URL for JSON-LD: catalog favicons are either absolute
 *  https URLs or site-relative paths ("stations/fm4.png?v=…"). */
export function logoUrl(s, site) {
  if (typeof s.favicon !== 'string' || !s.favicon.trim()) return null;
  const f = s.favicon.trim();
  if (/^https:\/\//i.test(f)) return f;
  if (/^[a-z][a-z0-9+.-]*:/i.test(f)) return null; // http:, data:, … — skip
  return `${site}/${f.replace(/^\/+/, '')}`;
}

/** The ordered fact rows: [{ label, text, href? }]. */
export function stationFacts(s, cap, country) {
  const rows = [];
  if (country) rows.push({ label: 'Country', text: country });
  const quality = streamQualityText(s);
  if (quality) rows.push({ label: 'Stream quality', text: quality });
  const np = nowPlayingText(cap);
  if (np) rows.push({ label: 'Now playing', text: np });
  const sched = scheduleText(cap);
  if (sched) rows.push({ label: 'Schedule', text: sched });
  const home = homepageLink(s);
  if (home) rows.push({ label: 'Official website', text: home.label, href: home.href });
  return rows;
}
