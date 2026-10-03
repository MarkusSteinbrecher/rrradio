import type { Station } from './types';

const FAVORITES_KEY = 'rrradio.favorites.v2';
const RECENTS_KEY = 'rrradio.recents.v2';
const CUSTOM_KEY = 'rrradio.custom.v1';
/** Keys left behind by the removed web wake-to-radio feature. */
const LEGACY_WAKE_KEYS = ['rrradio.wake.v1', 'rrradio.wake.lastTime.v1'];
const RECENTS_LIMIT = 12;

/** Safe localStorage.getItem — returns null on quota / privacy-mode /
 *  disabled-storage errors. Use this for any read in the app rather
 *  than raw `localStorage.getItem`, so a misbehaving browser never
 *  crashes app boot. */
export function getString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Safe localStorage.setItem — silently swallows quota / privacy-mode
 *  errors. Persisting non-critical UI state (last-tab, theme) shouldn't
 *  fail the user-visible action. */
export function setString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // quota / privacy mode — ignore
  }
}

/** Safe localStorage.removeItem — paired with getString/setString so
 *  the whole key→value lifecycle goes through the safe wrappers. */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // quota / privacy mode — ignore
  }
}

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

/** Replace the entire favorites list. Used by backup-import to write a
 *  merged list back; toggleFavorite / reorderFavorites cover the
 *  per-row mutations. */
export function setFavorites(list: Station[]): void {
  writeStations(FAVORITES_KEY, list);
}

export function getRecents(): Station[] {
  return readStations(RECENTS_KEY);
}

export function pushRecent(station: Station): void {
  const recents = getRecents().filter((s) => s.id !== station.id);
  recents.unshift(station);
  writeStations(RECENTS_KEY, recents.slice(0, RECENTS_LIMIT));
}

/** Replace the entire recents list (capped at RECENTS_LIMIT). Used by
 *  backup-import to write a merged history back; pushRecent covers the
 *  per-play mutation. */
export function setRecents(list: Station[]): void {
  writeStations(RECENTS_KEY, list.slice(0, RECENTS_LIMIT));
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

/** Replace the entire custom-stations list. Backup-import uses this to
 *  write the merged result back in one call. */
export function setCustom(list: Station[]): void {
  writeStations(CUSTOM_KEY, list);
}

/** One-time cleanup: drop wake-to-radio keys written by older builds.
 *  Wake-to-radio is iOS-only now; the web app no longer reads them. */
export function clearLegacyWakeKeys(): void {
  for (const key of LEGACY_WAKE_KEYS) removeKey(key);
}
