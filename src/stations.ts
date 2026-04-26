import { radioBrowser } from './radioBrowser';
import type { Station } from './types';

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
    if (stations.length > 0) return stations;
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
    return await radioBrowser.searchStations({
      name: filter.query,
      tag: filter.tag,
      countrycode: filter.countryCode,
      limit: PAGE_SIZE,
      offset: filter.offset,
    });
  } catch {
    return [];
  }
}
