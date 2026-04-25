const FAVORITES_KEY = 'radio.favorites.v1';
const RECENTS_KEY = 'radio.recents.v1';
const RECENTS_LIMIT = 20;

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>): void {
  localStorage.setItem(key, JSON.stringify([...set]));
}

export function getFavorites(): Set<string> {
  return readSet(FAVORITES_KEY);
}

export function toggleFavorite(stationId: string): boolean {
  const favs = getFavorites();
  const isFav = favs.has(stationId);
  if (isFav) favs.delete(stationId);
  else favs.add(stationId);
  writeSet(FAVORITES_KEY, favs);
  return !isFav;
}

export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecent(stationId: string): void {
  const recents = getRecents().filter((id) => id !== stationId);
  recents.unshift(stationId);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, RECENTS_LIMIT)));
}
