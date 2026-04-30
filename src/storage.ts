import type { Station } from './types';

const FAVORITES_KEY = 'rrradio.favorites.v2';
const RECENTS_KEY = 'rrradio.recents.v2';
const CUSTOM_KEY = 'rrradio.custom.v1';
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

/** Persist a manually re-ordered favorites list. The caller passes the
 *  ids in the new order; we re-resolve each id against the current
 *  stored list (to keep the full Station record) and write back. Ids
 *  not present in storage are dropped silently. */
export function reorderFavorites(orderedIds: string[]): void {
  const current = getFavorites();
  const byId = new Map(current.map((s) => [s.id, s]));
  const next: Station[] = [];
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (s) {
      next.push(s);
      byId.delete(id);
    }
  }
  // Anything missed (e.g. concurrent toggle from another tab) appended
  // at the end so we don't lose data on a stale reorder.
  for (const s of byId.values()) next.push(s);
  writeStations(FAVORITES_KEY, next);
}

export function getRecents(): Station[] {
  return readStations(RECENTS_KEY);
}

export function pushRecent(station: Station): void {
  const recents = getRecents().filter((s) => s.id !== station.id);
  recents.unshift(station);
  writeStations(RECENTS_KEY, recents.slice(0, RECENTS_LIMIT));
}

export function getCustom(): Station[] {
  return readStations(CUSTOM_KEY);
}

export function isCustom(id: string): boolean {
  return getCustom().some((s) => s.id === id);
}

export function addCustom(station: Station): void {
  const all = getCustom();
  const idx = all.findIndex((s) => s.id === station.id);
  if (idx >= 0) all[idx] = station;
  else all.unshift(station);
  writeStations(CUSTOM_KEY, all);
}

export function removeCustom(id: string): void {
  const next = getCustom().filter((s) => s.id !== id);
  writeStations(CUSTOM_KEY, next);
}
