import { BUILTIN_STATIONS } from './builtins';
import { normalizeStreamUrl, radioBrowser } from './radioBrowser';
import type { Station } from './types';

/** Hide Radio Browser rows that point at a stream URL we already curate.
 *  Without this filter, searching e.g. "Kontrafunk" surfaces both our
 *  curated entry and the RB record(s) for the same stream — the user
 *  ends up seeing the same station several times under different cards. */
function hideCuratedCollisions(stations: Station[]): Station[] {
  if (BUILTIN_STATIONS.length === 0) return stations;
  const curated = new Set(BUILTIN_STATIONS.map((s) => normalizeStreamUrl(s.streamUrl)));
  return stations.filter((s) => !curated.has(normalizeStreamUrl(s.streamUrl)));
}

/**
 * Offline / API-down fallback only. The primary catalog comes from
 * Radio Browser via {@link fetchStations} and {@link searchStations}.
 */
export const SEED_STATIONS: Station[] = [
  {
    id: 'soma-groove-salad',
    name: 'SomaFM — Groove Salad',
    streamUrl: 'https://ice2.somafm.com/groovesalad-128-mp3',
    homepage: 'https://somafm.com/groovesalad/',
    tags: ['ambient', 'downtempo'],
  },
  {
    id: 'soma-drone-zone',
    name: 'SomaFM — Drone Zone',
    streamUrl: 'https://ice2.somafm.com/dronezone-128-mp3',
    homepage: 'https://somafm.com/dronezone/',
    tags: ['ambient'],
  },
  {
    id: 'soma-deep-space-one',
    name: 'SomaFM — Deep Space One',
    streamUrl: 'https://ice2.somafm.com/deepspaceone-128-mp3',
    homepage: 'https://somafm.com/deepspaceone/',
    tags: ['ambient', 'space'],
  },
];

export const PAGE_SIZE = 60;

/** Loosen tightly-bound letter↔digit queries before sending to Radio
 *  Browser. RB does substring matching on station names, which usually
 *  carry a space between brand letters and a channel number ("WDR 5",
 *  "Antenne 1", "FFH 80er"). Without this transform a user typing
 *  "WDR5" with no space gets nothing. We only insert spaces at letter↔
 *  digit boundaries when the query has no whitespace at all — if the
 *  user already used spaces, trust them. */
export function looseSearchQuery(q: string | undefined): string | undefined {
  if (!q) return q;
  const trimmed = q.trim();
  if (!trimmed || /\s/.test(trimmed)) return trimmed;
  const transformed = trimmed
    .replace(/([a-zäöüß])(\d)/gi, '$1 $2')
    .replace(/(\d)([a-zäöüß])/gi, '$1 $2');
  return transformed === trimmed ? trimmed : transformed;
}

export async function fetchStations(offset = 0): Promise<Station[]> {
  try {
    const stations = await radioBrowser.searchStations({
      limit: PAGE_SIZE,
      offset,
      order: 'votes',
      reverse: true,
    });
    // SEED_STATIONS is the offline fallback; only use it for the
    // first page when Radio Browser returned nothing.
    if (stations.length > 0) return hideCuratedCollisions(stations);
    return offset === 0 ? SEED_STATIONS : [];
  } catch {
    return offset === 0 ? SEED_STATIONS : [];
  }
}

export interface StationFilter {
  query?: string;
  tag?: string;
  countryCode?: string;
  offset?: number;
}

export async function searchStations(filter: StationFilter): Promise<Station[]> {
  const hasFilter = !!(filter.query || filter.tag || filter.countryCode);
  if (!hasFilter) return fetchStations(filter.offset);
  try {
    const stations = await radioBrowser.searchStations({
      name: looseSearchQuery(filter.query),
      tag: filter.tag,
      countrycode: filter.countryCode,
      limit: PAGE_SIZE,
      offset: filter.offset,
    });
    return hideCuratedCollisions(stations);
  } catch {
    return [];
  }
}
