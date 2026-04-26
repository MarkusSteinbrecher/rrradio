/// <reference types="vite/client" />
import type { ParsedTitle } from './icyMetadata';
import type { MetadataFetcher } from './metadata';
import { pseudoFrequency } from './radioBrowser';
import type { Station } from './types';

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s'’\-/])([a-zà-ÿ])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

interface GrrifTrack {
  Title?: string;
  Artist?: string;
  URLCover?: string;
  Hours?: string;
}

/**
 * Grrif's stream sends empty StreamTitle in ICY metadata (they reserve it
 * for ad signalling). Their site reads /live/covers.json instead — a
 * CORS-permissive feed of the last few played tracks. The newest entry
 * is at the end of the array.
 */
async function fetchGrrifMetadata(signal: AbortSignal): Promise<ParsedTitle | null> {
  try {
    const res = await fetch(`https://www.grrif.ch/live/covers.json?_=${Date.now()}`, {
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as GrrifTrack[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const latest = arr[arr.length - 1];
    if (!latest?.Title) return null;
    const artist = latest.Artist ? titleCase(latest.Artist) : undefined;
    const track = titleCase(latest.Title);
    const cover =
      latest.URLCover && !/\/default\.jpg$/i.test(latest.URLCover) ? latest.URLCover : undefined;
    return {
      artist,
      track,
      raw: `${latest.Artist ?? ''} - ${latest.Title ?? ''}`.trim(),
      coverUrl: cover,
    };
  } catch {
    return null;
  }
}

/**
 * ORF FM4 (and other ORF radios) publish a public JSON broadcast schedule
 * at audioapi.orf.at. Each broadcast (e.g. "Morning Show") has an "items"
 * array — news segments and individual songs alike — with start/duration
 * timestamps, song title + interpreter, and a list of cover-art versions
 * at multiple resolutions. CORS is permissive; we just need to find the
 * item where Date.now() falls within [start, start+duration].
 */
interface OrfImage {
  versions?: Array<{ path: string; width: number }>;
}
interface OrfBroadcast {
  start: number;
  end: number;
  href: string;
}
interface OrfItem {
  type?: string;
  start?: number;
  duration?: number;
  title?: string;
  interpreter?: string;
  images?: OrfImage[];
}

function bestImage(images: OrfImage[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined;
  const versions = images[0].versions ?? [];
  let best: { path: string; width: number } | undefined;
  for (const v of versions) {
    if (!best || v.width > best.width) best = v;
  }
  return best?.path;
}

function makeOrfFetcher(stationKey: string): MetadataFetcher {
  return async (signal) => {
    try {
      const liveUrl = `https://audioapi.orf.at/${stationKey}/api/json/4.0/live`;
      const liveRes = await fetch(liveUrl, { signal, cache: 'no-store' });
      if (!liveRes.ok) return null;
      const live = (await liveRes.json()) as OrfBroadcast[];
      const now = Date.now();
      const current = live.find((b) => b.start <= now && now < b.end);
      if (!current) return null;

      const bcRes = await fetch(current.href, { signal, cache: 'no-store' });
      if (!bcRes.ok) return null;
      const bc = (await bcRes.json()) as { items?: OrfItem[] };
      const items = bc.items ?? [];
      const item = items.find((it) => {
        const start = it.start ?? 0;
        const dur = it.duration ?? 0;
        return start <= now && now < start + dur;
      });
      // Only surface music items — type "M". News/talk items would
      // otherwise show up as "title — News" with no artist or cover.
      if (!item || item.type !== 'M' || !item.title) return null;

      return {
        artist: item.interpreter,
        track: item.title,
        raw: `${item.interpreter ?? ''} - ${item.title}`.trim(),
        coverUrl: bestImage(item.images),
      };
    } catch {
      return null;
    }
  };
}

const fetchFm4Metadata = makeOrfFetcher('fm4');

const BASE = import.meta.env.BASE_URL;

/**
 * Stations bundled with the app — used for quick-access tiles and as a
 * fallback for entries Radio Browser has wrong. Each one ships with its
 * own logo committed under public/stations/.
 */
export const BUILTIN_STATIONS: Station[] = [
  {
    id: 'builtin-grrif',
    name: 'Grrif',
    streamUrl: 'https://grrif.ice.infomaniak.ch/grrif-128.aac',
    homepage: 'https://www.grrif.ch/',
    country: 'CH',
    tags: ['rock', 'indie', 'alternative', 'swiss'],
    favicon: `${BASE}stations/grrif.png`,
    bitrate: 128,
    codec: 'AAC',
    frequency: pseudoFrequency('builtin-grrif'),
  },
];

const BUILTIN_IDS = new Set(BUILTIN_STATIONS.map((s) => s.id));

export function isBuiltin(id: string): boolean {
  return BUILTIN_IDS.has(id);
}

/** Match rules for per-station metadata fetchers. Tried in order; the
 *  first matching rule wins. Fetchers are matched by station id (for
 *  built-ins) or by stream-URL pattern (so any RB / custom entry that
 *  uses the same stream gets the same rich feed). */
interface FetcherRule {
  match: (station: Station) => boolean;
  fetcher: MetadataFetcher;
}

const FETCHER_RULES: FetcherRule[] = [
  { match: (s) => s.id === 'builtin-grrif', fetcher: fetchGrrifMetadata },
  // ORF FM4 — official public stream URLs (any -q1a / -q2a quality)
  {
    match: (s) => /orf-live\.ors-shoutcast\.at\/fm4-/i.test(s.streamUrl),
    fetcher: fetchFm4Metadata,
  },
];

export function findFetcher(station: Station): MetadataFetcher | undefined {
  for (const rule of FETCHER_RULES) {
    if (rule.match(station)) return rule.fetcher;
  }
  return undefined;
}
