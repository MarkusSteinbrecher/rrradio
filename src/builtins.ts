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
  const res = await fetch(`https://www.grrif.ch/live/covers.json?_=${Date.now()}`, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`grrif covers.json ${res.status}`);
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
}

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

/** Per-station metadata fetcher overrides. When a station id has an entry
 *  here, the poller uses it instead of the default ICY reader. */
export const BUILTIN_FETCHERS: Record<string, MetadataFetcher> = {
  'builtin-grrif': fetchGrrifMetadata,
};
