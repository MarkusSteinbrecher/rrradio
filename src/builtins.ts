/// <reference types="vite/client" />
import type { MetadataFetcher } from './metadata';
import type { Station } from './types';

const BASE = import.meta.env.BASE_URL;

// ============================================================
// Helpers
// ============================================================

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'’\-/])([a-zà-ÿ])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** Strip leading non-JSON noise (comments, BOM) so JSON.parse can swallow
 *  responses like BR's radioplayer.json which starts with `//@formatter:off`. */
function parseLooseJSON(text: string): unknown {
  const idx = text.search(/[\[{]/);
  return JSON.parse(idx > 0 ? text.slice(idx) : text);
}

// ============================================================
// Per-station metadata fetchers
// ============================================================

interface GrrifTrack {
  Title?: string;
  Artist?: string;
  URLCover?: string;
  Hours?: string;
}

const fetchGrrifMetadata: MetadataFetcher = async (_station, signal) => {
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
    const cover =
      latest.URLCover && !/\/default\.jpg$/i.test(latest.URLCover) ? latest.URLCover : undefined;
    return {
      artist: latest.Artist ? titleCase(latest.Artist) : undefined,
      track: titleCase(latest.Title),
      raw: `${latest.Artist ?? ''} - ${latest.Title ?? ''}`.trim(),
      coverUrl: cover,
    };
  } catch {
    return null;
  }
};

interface OrfImage {
  versions?: Array<{ path: string; width: number }>;
}
interface OrfBroadcast {
  start: number;
  end: number;
  href: string;
  title?: string;
  subtitle?: string;
  program?: string;
  programKey?: string;
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

/** ORF audioapi: takes /<station>/api/json/4.0/live, finds the current
 *  broadcast (now ∈ [start,end]), drills into its detail, then finds the
 *  current item. Music items (type "M") get artist+title+cover. */
const fetchOrfMetadata: MetadataFetcher = async (station, signal) => {
  const liveUrl = station.metadataUrl;
  if (!liveUrl) return null;
  try {
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

    const program = current.title
      ? { name: current.title.trim(), subtitle: stripHtml(current.subtitle) }
      : undefined;

    // Music item — full track + program. For news/talk (type !== "M")
    // we still surface the program info so the user knows which show
    // is on, even when there's no track to display.
    if (!item || item.type !== 'M' || !item.title) {
      return program ? { track: undefined, raw: '', program } : null;
    }

    return {
      artist: item.interpreter,
      track: item.title,
      raw: `${item.interpreter ?? ''} - ${item.title}`.trim(),
      coverUrl: bestImage(item.images),
      program,
    };
  } catch {
    return null;
  }
};

/** Strip HTML tags + collapse whitespace. ORF's broadcast subtitles
 *  arrive as fragments like "<p>Some description.</p>"; we just want
 *  the visible text. */
function stripHtml(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const text = input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

interface BrTrack {
  interpret?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
}
interface BrBroadcast {
  headline?: string;
  subTitle?: string;
  startTime?: string;
  endTime?: string;
  broadcastSeriesName?: string;
}
interface BrPlayer {
  tracks?: BrTrack[];
  broadcasts?: BrBroadcast[];
}

/** BR radioplayer.json: Bavarian-radio "now playing" feed used by br.de.
 *  Returns a `tracks[]` list with ISO-format start/end timestamps. We pick
 *  whichever entry currently brackets `Date.now()`; if none do (between
 *  songs / news segment), return null. CORS-permissive but the body
 *  starts with `//@formatter:off` so JSON.parse needs the loose helper. */
const fetchBrMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const res = await fetch(`${url}?_=${Date.now()}`, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    const data = parseLooseJSON(text) as BrPlayer;
    const tracks = data.tracks ?? [];
    const broadcasts = data.broadcasts ?? [];
    const now = Date.now();
    const currentTrack = tracks.find((t) => {
      const start = t.startTime ? Date.parse(t.startTime) : 0;
      const end = t.endTime ? Date.parse(t.endTime) : 0;
      return start <= now && now < end;
    });
    const pick = currentTrack ?? tracks[0];

    const currentBc = broadcasts.find((b) => {
      const start = b.startTime ? Date.parse(b.startTime) : 0;
      const end = b.endTime ? Date.parse(b.endTime) : 0;
      return start <= now && now < end;
    });
    const program = currentBc?.headline
      ? { name: currentBc.headline.trim(), subtitle: currentBc.subTitle?.trim() || undefined }
      : undefined;

    if (!pick?.title) return program ? { track: undefined, raw: '', program } : null;
    return {
      artist: pick.interpret ? titleCase(pick.interpret) : undefined,
      track: titleCase(pick.title),
      raw: `${pick.interpret ?? ''} - ${pick.title}`.trim(),
      program,
    };
  } catch {
    return null;
  }
};

// ============================================================
// Fetcher registry
// ============================================================

/** Code-side registry: station.metadata field → fetcher implementation. */
const FETCHERS_BY_KEY: Record<string, MetadataFetcher> = {
  grrif: fetchGrrifMetadata,
  orf: fetchOrfMetadata,
  'br-radioplayer': fetchBrMetadata,
};

/** URL-pattern fallback rules. Used when a Station object doesn't
 *  declare a `metadata` key but its stream URL matches a known pattern
 *  (e.g. random RB entries that happen to point at FM4 or BR). */
interface UrlPatternRule {
  match: (s: Station) => boolean;
  fetcher: MetadataFetcher;
  /** What to put in `station.metadataUrl` when wiring this fetcher
   *  for a station that didn't declare one (so the code fetcher knows
   *  where to call). */
  metadataUrl: string;
}
const URL_PATTERN_RULES: UrlPatternRule[] = [
  {
    match: (s) => /orf-live\.ors-shoutcast\.at\/fm4-/i.test(s.streamUrl),
    fetcher: fetchOrfMetadata,
    metadataUrl: 'https://audioapi.orf.at/fm4/api/json/4.0/live',
  },
];

export function findFetcher(
  station: Station,
): { fetcher: MetadataFetcher; station: Station } | undefined {
  if (station.metadata) {
    const f = FETCHERS_BY_KEY[station.metadata];
    if (f) return { fetcher: f, station };
  }
  for (const rule of URL_PATTERN_RULES) {
    if (rule.match(station)) {
      return { fetcher: rule.fetcher, station: { ...station, metadataUrl: rule.metadataUrl } };
    }
  }
  return undefined;
}

// ============================================================
// JSON-driven station catalog
// ============================================================

/** Mutable export — populated by loadBuiltinStations on app boot.
 *  Other modules import this by reference and read its current value. */
export const BUILTIN_STATIONS: Station[] = [];

let loadPromise: Promise<Station[]> | null = null;

function resolveFavicon(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return BASE + path.replace(/^\/+/, '');
}

function normaliseStation(raw: unknown): Station | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Station>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.streamUrl !== 'string') {
    return null;
  }
  return {
    id: r.id,
    name: r.name,
    streamUrl: r.streamUrl,
    homepage: r.homepage,
    country: r.country,
    tags: Array.isArray(r.tags) ? r.tags : undefined,
    favicon: resolveFavicon(r.favicon),
    bitrate: typeof r.bitrate === 'number' ? r.bitrate : undefined,
    codec: r.codec,
    listeners: typeof r.listeners === 'number' ? r.listeners : undefined,
    metadata: r.metadata,
    metadataUrl: r.metadataUrl,
    geo: Array.isArray(r.geo) && r.geo.length === 2 && r.geo.every((n) => typeof n === 'number')
      ? (r.geo as [number, number])
      : undefined,
  };
}

export function loadBuiltinStations(): Promise<Station[]> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(`${BASE}stations.json`, { cache: 'no-store' });
      if (!res.ok) return [];
      const data = (await res.json()) as { stations?: unknown };
      const list = Array.isArray(data.stations)
        ? data.stations.map(normaliseStation).filter((s): s is Station => s !== null)
        : [];
      BUILTIN_STATIONS.length = 0;
      BUILTIN_STATIONS.push(...list);
      return list;
    } catch {
      return [];
    }
  })();
  return loadPromise;
}

const BUILTIN_IDS = new Set<string>();
loadBuiltinStations().then((list) => {
  for (const s of list) BUILTIN_IDS.add(s.id);
});

export function isBuiltin(id: string): boolean {
  return BUILTIN_IDS.has(id);
}
