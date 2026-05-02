import type { Station, WakeTo } from './types';

const FAVORITES_KEY = 'rrradio.favorites.v2';
const RECENTS_KEY = 'rrradio.recents.v2';
const CUSTOM_KEY = 'rrradio.custom.v1';
const WAKE_KEY = 'rrradio.wake.v1';
const WAKE_LAST_TIME_KEY = 'rrradio.wake.lastTime.v1';
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

export function getWakeTo(): WakeTo | null {
  try {
    const raw = localStorage.getItem(WAKE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as WakeTo).time === 'string' &&
      typeof (v as WakeTo).stationId === 'string' &&
      typeof (v as WakeTo).station === 'object' &&
      typeof (v as WakeTo).armedAt === 'number'
    ) {
      return v as WakeTo;
    }
    return null;
  } catch {
    return null;
  }
}

export function setWakeTo(w: WakeTo | null): void {
  try {
    if (w === null) localStorage.removeItem(WAKE_KEY);
    else localStorage.setItem(WAKE_KEY, JSON.stringify(w));
  } catch {
    // quota / privacy mode — ignore
  }
}

/** Persist the most recently armed wake time so the sheet pre-fills
 *  with it on next open — independent of whether a wake is currently
 *  armed. Falls back to "07:00" when nothing is stored. */
export function getLastWakeTime(): string | undefined {
  try {
    const v = localStorage.getItem(WAKE_LAST_TIME_KEY);
    return v && /^\d{1,2}:\d{2}$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function setLastWakeTime(time: string): void {
  try {
    localStorage.setItem(WAKE_LAST_TIME_KEY, time);
  } catch {
    // quota / privacy mode — ignore
  }
}
