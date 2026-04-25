/// <reference types="vite/client" />
import { pseudoFrequency } from './radioBrowser';
import type { Station } from './types';

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
