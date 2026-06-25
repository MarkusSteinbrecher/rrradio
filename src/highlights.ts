import type { Station } from './types';

// Editorial "Featured by rrradio" rail. The feed is data, not code:
// `data/highlights.yaml` → `public/highlights.json` (built by
// `tools/build-highlights.mjs`, served at /highlights.json). Clients
// fetch it, cache the last-good copy, window entries by date, resolve
// `stationId` against the catalog, and hide unknown/expired ones.
// Mirrors the iOS `HighlightsStore`.

export interface HighlightBadge {
  label: string;
  accent?: string;
}

export interface Highlight {
  stationId: string;
  badge?: HighlightBadge;
  blurb?: string;
  /** Inclusive window, `YYYY-MM-DD`. Absent = evergreen (always active). */
  startsOn?: string;
  endsOn?: string;
}

export interface ResolvedHighlight extends Highlight {
  station: Station;
}

const BASE = import.meta.env.BASE_URL;
const CACHE_KEY = 'rrradio:highlights:v1';

/** Today as `YYYY-MM-DD` in local time. */
export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Is a highlight in-window for the given day (inclusive)? Un-windowed
 *  entries are always active. Lexical compare works for `YYYY-MM-DD`. */
export function isHighlightActive(h: Highlight, today: string): boolean {
  if (h.startsOn && today < h.startsOn) return false;
  if (h.endsOn && today > h.endsOn) return false;
  return true;
}

/** Resolve raw highlights against the catalog: keep active + known-station
 *  entries, dedupe by station (first wins — file order is render order),
 *  cap at `limit`. */
export function resolveHighlights(
  highlights: Highlight[],
  stationById: (id: string) => Station | undefined,
  today: string,
  limit = 8,
): ResolvedHighlight[] {
  const out: ResolvedHighlight[] = [];
  const seen = new Set<string>();
  for (const h of highlights) {
    if (out.length >= limit) break;
    if (!isHighlightActive(h, today)) continue;
    if (seen.has(h.stationId)) continue;
    const station = stationById(h.stationId);
    if (!station) continue;
    seen.add(h.stationId);
    out.push({ ...h, station });
  }
  return out;
}

let cache: Highlight[] | null = null;

/** Fetch highlights.json, caching the last-good copy in localStorage so
 *  an offline / failed reload still shows the rail. Returns raw entries;
 *  callers resolve them against the catalog with `resolveHighlights`. */
export async function loadHighlights(): Promise<Highlight[]> {
  if (cache) return cache;
  try {
    const res = await fetch(`${BASE}highlights.json`, { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as { highlights?: Highlight[] };
      const list = Array.isArray(data.highlights) ? data.highlights : [];
      cache = list;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(list));
      } catch {
        /* private-mode / quota — non-fatal */
      }
      return list;
    }
  } catch {
    /* network error — fall through to the cached copy */
  }
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      cache = JSON.parse(raw) as Highlight[];
      return cache;
    }
  } catch {
    /* ignore */
  }
  return [];
}
