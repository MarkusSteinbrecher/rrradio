import { titleCase } from './format';
import type { ParsedTitle } from './icyMetadata';

/** Pure request/parse helpers for Triton Digital's public now-playing
 *  endpoint (#233), kept out of src/builtins.ts so they unit-test without
 *  its fetch glue. Triton hosts every `*.streamtheworld.com` stream; the
 *  endpoint is CORS `*`, no auth, and answers XML:
 *
 *    <nowplaying-info-list>
 *      <nowplaying-info mountName="KKMGFM" timestamp="1792222023" type="track">
 *        <property name="cue_title"><![CDATA[Lose Control]]></property>
 *        <property name="track_artist_name"><![CDATA[Teddy Swims]]></property>
 *        <property name="track_cover_url">…</property>   (some customers)
 *      </nowplaying-info> …
 *
 *  Unknown mounts answer 200 with an empty list. */

const TRITON_NP = 'https://np.tritondigital.com/public/nowplaying';

/** A newest cue older than this is treated as stale (feed stopped
 *  updating, or a talk block the playout never re-cued). */
export const TRITON_STALE_MS = 30 * 60_000;

/** Mount name from a stream URL on a Triton host, e.g.
 *  `…/livestream-redirect/HRT_RADIO1AAC.aac` → `HRT_RADIO1AAC`. The
 *  `_SC` suffix marks a Shoutcast-protocol variant of the same mount;
 *  Triton only publishes metadata under the mount without it
 *  (`CONCIERTO_SC` → `CONCIERTO`). Codec suffixes (`AAC`, `AAC48`) must
 *  stay — `BONTONAAC` has data, `BONTON` has none. */
export function tritonMount(streamUrl: string): string | null {
  let url: URL;
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

export function tritonUrl(mount: string): string {
  return `${TRITON_NP}?mountName=${encodeURIComponent(mount)}&numberToFetch=1&eventType=track`;
}

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\.(mp3|wav|m4a)$/i, '').trim();
}

/** Caseless (CJK) and empty text count as caps so they don't veto. */
function isCaps(s: string): boolean {
  return !/\p{Ll}/u.test(s);
}

/** Every value arrives as CDATA. Rewrite it as escaped text first —
 *  same DOM for browsers, and happy-dom (tests) can't parse CDATA. */
function unwrapCdata(xml: string): string {
  return xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  );
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Parse one Triton response. Returns null when there is no current track:
 *  empty list, stale cue, a title that is only a clock time, or a
 *  station-ident cue (title == station name, no artist — HRT emits
 *  "HRVATSKI RADIO" during talk). Split `Artist - Title` cue titles when the
 *  mount carries no separate artist field. */
export function parseTriton(
  xml: string,
  opts: { stationName?: string; now?: number } = {},
): ParsedTitle | null {
  const doc = new DOMParser().parseFromString(unwrapCdata(xml), 'application/xml');
  const info = doc.getElementsByTagName('nowplaying-info')[0];
  if (!info) return null;
  const props: Record<string, string> = {};
  for (const p of Array.from(info.getElementsByTagName('property'))) {
    const name = p.getAttribute('name');
    if (name) props[name] = (p.textContent ?? '').trim();
  }
  const ts = Number(info.getAttribute('timestamp')) * 1000;
  if (ts > 0 && (opts.now ?? Date.now()) - ts > TRITON_STALE_MS) return null;

  let title = props.cue_title ?? '';
  let artist = props.track_artist_name ?? '';
  if (!artist) {
    const idx = title.indexOf(' - ');
    if (idx > 0 && idx < title.length - 3) {
      artist = title.slice(0, idx);
      title = title.slice(idx + 3);
    }
  }
  title = tidy(title);
  artist = tidy(artist);
  // ALL-CAPS feeds (common on US/LatAm playout systems) → Title Case. Only
  // when the whole cue is caps, so "INXS - Good times" keeps its band name.
  if (/\p{Lu}/u.test(artist + title) && isCaps(artist) && isCaps(title)) {
    artist = titleCase(artist);
    title = titleCase(title);
  }
  if (!title || /^\d{1,2}:\d{2}$/.test(title)) return null;
  if (!artist && opts.stationName && squash(title) === squash(opts.stationName)) return null;

  const cover = props.track_cover_url;
  return {
    artist: artist || undefined,
    track: title,
    raw: artist ? `${artist} - ${title}` : title,
    coverUrl: cover && /^https:\/\//i.test(cover) ? cover : undefined,
  };
}
