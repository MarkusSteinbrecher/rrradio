import type { Station } from './types';

const FAVORITES_KEY = 'rrradio.favorites.v2';
const RECENTS_KEY = 'rrradio.recents.v2';
const RECENTS_LIMIT = 12;

function readStations(key: string): Station[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (s): s is Station =>
        typeof s === 'object' && s !== null && typeof (s as Station).id === 'string',
    );
  } catch {
    return [];
  }
}

function writeStations(key: string, list: Station[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // quota / privacy mode — ignore
  }
}

export function getFavorites(): Station[] {
  return readStations(FAVORITES_KEY);
}

export function isFavorite(stationId: string): boolean {
  return getFavorites().some((s) => s.id === stationId);
}

/** Toggle favorite. Returns new state — `true` if added, `false` if removed. */
export function toggleFavorite(station: Station): boolean {
  const favs = getFavorites();
  const idx = favs.findIndex((s) => s.id === station.id);
  if (idx >= 0) {
    favs.splice(idx, 1);
    writeStations(FAVORITES_KEY, favs);
    return false;
  }
  favs.unshift(station);
  writeStations(FAVORITES_KEY, favs);
  return true;
}

export function getRecents(): Station[] {
  return readStations(RECENTS_KEY);
}

export function pushRecent(station: Station): void {
  const recents = getRecents().filter((s) => s.id !== station.id);
  recents.unshift(station);
  writeStations(RECENTS_KEY, recents.slice(0, RECENTS_LIMIT));
}
