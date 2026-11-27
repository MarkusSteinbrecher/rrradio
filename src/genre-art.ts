import type { Station } from './types';
import { GENRES, stationMatchesGenre } from './genre-taxonomy';

// Pictures on the Browse genre cards and the featured cards, read from
// `genre-art.json` (built from `data/genre-art.yaml`). Contract:
// docs/spec/contracts/genre-art.md. Same validity rules and rotation as
// the iOS `GenreArtStore`, so every client shows the same set.

export interface Cover {
  artist?: string;
  album?: string;
  image: string;
}

export interface GenreArt {
  /** Genre id → its valid sets of three covers, hero first. */
  sets: Map<string, Cover[][]>;
  rotateEveryDays: number;
}

export const SCHEMA_VERSION = 1;
export const DEFAULT_ROTATION_DAYS = 7;
/** Genres pictured by photos, not album covers. */
export const SPOKEN_GENRES: ReadonlySet<string> = new Set(['news', 'talk', 'sports', 'public']);
/** Broad genres a station with no music genre of its own, or one tagged
 *  as mixed, takes its covers from (iOS `GenreCoverArt.mixGenreIDs`). */
export const MIX_GENRE_IDS = ['rock', 'jazz', 'soul', 'electronic', 'indie', 'folk', 'hiphop', 'reggae', 'pop', 'ambient'];
const MIXED_TAGS = ['eclectic', 'variety', 'freeform', 'free-form'];

/** https only, on rrradio.org or Apple's artwork servers. */
export function isAllowedImage(image: unknown): image is string {
  if (typeof image !== 'string') return false;
  let url: URL;
  try {
    url = new URL(image);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'rrradio.org' || host.endsWith('.mzstatic.com');
}

/** Read a `genre-art.json` payload. Lenient per genre, set and entry: a
 *  malformed one is dropped. Returns null when the payload is not that
 *  file or is a schema this build does not know. */
export function parseGenreArt(data: unknown): GenreArt | null {
  if (!data || typeof data !== 'object') return null;
  const doc = data as { schemaVersion?: unknown; rotateEveryDays?: unknown; genres?: unknown };
  if (doc.schemaVersion !== undefined && doc.schemaVersion !== SCHEMA_VERSION) return null;
  if (!doc.genres || typeof doc.genres !== 'object' || Array.isArray(doc.genres)) return null;
  const days = doc.rotateEveryDays;
  const art: GenreArt = {
    sets: new Map(),
    rotateEveryDays: typeof days === 'number' && Number.isInteger(days) && days >= 1 ? days : DEFAULT_ROTATION_DAYS,
  };
  for (const [id, rawSets] of Object.entries(doc.genres as Record<string, unknown>)) {
    if (!Array.isArray(rawSets)) continue;
    const valid: Cover[][] = [];
    for (const rawSet of rawSets) {
      if (!Array.isArray(rawSet)) continue;
      const covers: Cover[] = [];
      for (const entry of rawSet) {
        if (covers.length === 3) break;
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as { artist?: unknown; album?: unknown; image?: unknown };
        if (!isAllowedImage(e.image)) continue;
        const cover: Cover = { image: e.image };
        if (typeof e.artist === 'string') cover.artist = e.artist;
        if (typeof e.album === 'string') cover.album = e.album;
        covers.push(cover);
      }
      if (covers.length === 3) valid.push(covers);
    }
    if (valid.length > 0) art.sets.set(id, valid);
  }
  return art;
}

/** Which of `count` sets shows at `unixSeconds`: periods count from
 *  Monday 1970-01-05 00:00 UTC, so with 7 days the set changes every
 *  Monday and every device agrees. Same formula as the contract. */
export function rotationIndex(unixSeconds: number, days: number, count: number): number {
  if (!(count > 1)) return 0;
  const period = Math.max(1, days) * 86400;
  const index = Math.floor((unixSeconds - 4 * 86400) / period) % count;
  return index < 0 ? index + count : index;
}

/** Genre id → the set showing at `now`. */
export function currentCovers(art: GenreArt | null, now: Date = new Date()): Map<string, Cover[]> {
  const out = new Map<string, Cover[]>();
  if (!art) return out;
  const seconds = now.getTime() / 1000;
  for (const [id, sets] of art.sets) {
    out.set(id, sets[rotationIndex(seconds, art.rotateEveryDays, sets.length)]);
  }
  return out;
}

/** Three album covers per station for one rail of cards, keyed by station
 *  id and chosen together so no album shows twice on the rail while the
 *  pool lasts. A port of iOS `GenreCoverArt.covers(forRail:)`: stations
 *  with the least choice pick first; a mixed station, or one whose own
 *  genres are used up, borrows from the broad genres. */
export function coversForRail(stations: Station[], current: Map<string, Cover[]>): Map<string, Cover[]> {
  const picks = new Map([...current].filter(([id]) => !SPOKEN_GENRES.has(id)));
  const result = new Map<string, Cover[]>();
  if (picks.size === 0) return result;
  const plans = stations.map((station, index) => {
    const tags = (station.tags ?? []).map((t) => t.toLowerCase());
    const matched = GENRES.filter((g) => picks.has(g.id) && stationMatchesGenre(station, g)).map((g) => g.id);
    let seed = 0;
    for (const ch of station.id) seed = (seed * 31 + (ch.codePointAt(0) ?? 0)) & 0xffff;
    const isMixed = matched.length === 0 || tags.some((t) => MIXED_TAGS.some((m) => t.includes(m)));
    return { station, index, seed, matched, isMixed };
  });
  const order = [...plans].sort((a, b) => {
    if (a.isMixed !== b.isMixed) return a.isMixed ? 1 : -1;
    if (!a.isMixed && a.matched.length !== b.matched.length) return a.matched.length - b.matched.length;
    return a.index - b.index;
  });
  const used = new Set<string>();
  for (const plan of order) {
    if (result.has(plan.station.id)) continue;
    const row: Cover[] = [];
    const take = (genreId: string, fresh: boolean): void => {
      const covers = picks.get(genreId);
      if (row.length >= 3 || !covers) return;
      for (let offset = 0; offset < covers.length; offset++) {
        const cover = covers[(Math.floor(plan.seed / 7) + offset) % covers.length];
        if (row.some((c) => c.image === cover.image) || (fresh && used.has(cover.image))) continue;
        row.push(cover);
        return;
      }
    };
    const n = MIX_GENRE_IDS.length;
    // Start and stride come from the id; the strides are coprime to the
    // list length, so every genre is reached.
    const stride = [1, 3, 7, 9][Math.floor(plan.seed / n) % 4];
    const mix = Array.from({ length: n }, (_, i) => MIX_GENRE_IDS[(plan.seed + i * stride) % n]).filter(
      (id) => !plan.matched.includes(id),
    );
    for (const fresh of [true, false]) {
      for (const id of plan.matched.slice(0, 3)) {
        if (row.length < Math.min(3, plan.matched.length)) take(id, fresh);
      }
      if (plan.isMixed) {
        for (const id of mix) take(id, fresh);
      } else {
        for (let pass = 0; pass < 2; pass++) for (const id of plan.matched) take(id, fresh);
        // Own genres used up by neighbours: borrow, don't repeat.
        if (fresh) for (const id of mix) take(id, true);
      }
      if (row.length === 3) break;
    }
    for (const c of row) used.add(c.image);
    result.set(plan.station.id, row);
  }
  return result;
}

const BASE = import.meta.env.BASE_URL;

/** Where to load a cover from. A photo published at
 *  `https://rrradio.org/genre-art/…` is one of this site's own files, so
 *  it loads from this origin: that also works in a preview or dev build,
 *  and before a new photo has reached the live site. */
export function coverSrc(image: string, base: string = BASE): string {
  const prefix = 'https://rrradio.org/genre-art/';
  return image.startsWith(prefix) ? `${base}genre-art/${image.slice(prefix.length)}` : image;
}

const CACHE_KEY = 'rrradio.genre-art';

let cache: GenreArt | null = null;
let loaded = false;

function readCached(): GenreArt | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? parseGenreArt(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** The last good copy, available synchronously (from memory, else from
 *  localStorage), so the first paint already shows the pictures. */
export function getGenreArt(): GenreArt | null {
  cache ??= readCached();
  return cache;
}

/** Fetch genre-art.json once per page load, keeping the last good copy
 *  in localStorage for offline and for the next first paint. A missing
 *  or unreadable file leaves the cached copy in place. */
export async function loadGenreArt(): Promise<GenreArt | null> {
  if (loaded) return cache;
  loaded = true;
  try {
    const res = await fetch(`${BASE}genre-art.json`, { cache: 'no-cache' });
    if (res.ok) {
      const text = await res.text();
      let unchanged = false;
      try {
        unchanged = cache !== null && localStorage.getItem(CACHE_KEY) === text;
      } catch {
        /* storage unavailable */
      }
      // Same file as the cached copy: keep the same object, so callers
      // can tell by identity that nothing changed.
      if (unchanged) return cache;
      const fresh = parseGenreArt(JSON.parse(text));
      if (fresh) {
        cache = fresh;
        try {
          localStorage.setItem(CACHE_KEY, text);
        } catch {
          /* private mode / quota: non-fatal */
        }
        return cache;
      }
    }
  } catch {
    /* offline or malformed: fall through to the cached copy */
  }
  return getGenreArt();
}
