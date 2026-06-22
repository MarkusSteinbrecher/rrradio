/**
 * Named station lists (gh #520) — the web port of the iOS "lists" feature.
 *
 * A list is a user-named, ordered group of stations. Like favorites /
 * recents / custom, lists live entirely in localStorage: there is no
 * backend and no account, so "the user" is simply this browser. Each
 * list stores full Station snapshots (not just ids) so it survives
 * catalog churn and works for custom stations the catalog never had —
 * the same trade-off favorites already make.
 *
 * Cross-device movement is the backup/restore file (see backup.ts), not
 * a sync server.
 */

import type { Station } from './types';

const LISTS_KEY = 'rrradio.lists.v1';

export interface StationList {
  id: string;
  name: string;
  stations: Station[];
  /** Epoch ms when the list was created — used for stable display order. */
  createdAt: number;
}

function isStation(s: unknown): s is Station {
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof (s as Station).id === 'string' &&
    typeof (s as Station).name === 'string' &&
    typeof (s as Station).streamUrl === 'string'
  );
}

function isList(v: unknown): v is StationList {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as StationList).id === 'string' &&
    typeof (v as StationList).name === 'string' &&
    Array.isArray((v as StationList).stations)
  );
}

/** Read all lists. Tolerant of malformed storage (returns [] on any
 *  parse error) and sanitizes each list's stations to the Station shape,
 *  mirroring storage.ts's readStations. */
export function getLists(): StationList[] {
  try {
    const raw = localStorage.getItem(LISTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(isList).map((l) => ({
      id: l.id,
      name: l.name,
      stations: l.stations.filter(isStation),
      createdAt: typeof l.createdAt === 'number' ? l.createdAt : 0,
    }));
  } catch {
    return [];
  }
}

export function setLists(lists: StationList[]): void {
  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
  } catch {
    // quota / privacy mode — ignore
  }
}

export function getList(id: string): StationList | undefined {
  return getLists().find((l) => l.id === id);
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `list-${crypto.randomUUID()}`;
  }
  return `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create a new empty list. The name is trimmed; a blank name falls back
 *  to "Untitled list". Prepended so the newest list shows first. Returns
 *  the created list (callers need its generated id). */
export function createList(name: string, now = Date.now()): StationList {
  const list: StationList = {
    id: newId(),
    name: name.trim() || 'Untitled list',
    stations: [],
    createdAt: now,
  };
  const all = getLists();
  all.unshift(list);
  setLists(all);
  return list;
}

/** Rename a list. A blank new name is ignored (keeps the old one). */
export function renameList(id: string, name: string): void {
  const all = getLists();
  const l = all.find((x) => x.id === id);
  if (!l) return;
  l.name = name.trim() || l.name;
  setLists(all);
}

export function deleteList(id: string): void {
  setLists(getLists().filter((l) => l.id !== id));
}

/** Add a station to a list (no duplicates). New stations append to the
 *  end so the list keeps insertion order. Returns true if added, false
 *  if it was already present (or the list doesn't exist). */
export function addToList(listId: string, station: Station): boolean {
  const all = getLists();
  const l = all.find((x) => x.id === listId);
  if (!l) return false;
  if (l.stations.some((s) => s.id === station.id)) return false;
  l.stations.push(station);
  setLists(all);
  return true;
}

export function removeFromList(listId: string, stationId: string): void {
  const all = getLists();
  const l = all.find((x) => x.id === listId);
  if (!l) return;
  l.stations = l.stations.filter((s) => s.id !== stationId);
  setLists(all);
}

/** Toggle a station's membership in a list. Returns the new state —
 *  true if the station is now in the list, false if it was removed. */
export function toggleInList(listId: string, station: Station): boolean {
  const all = getLists();
  const l = all.find((x) => x.id === listId);
  if (!l) return false;
  const idx = l.stations.findIndex((s) => s.id === station.id);
  if (idx >= 0) {
    l.stations.splice(idx, 1);
    setLists(all);
    return false;
  }
  l.stations.push(station);
  setLists(all);
  return true;
}

export function listContains(listId: string, stationId: string): boolean {
  const l = getList(listId);
  return !!l && l.stations.some((s) => s.id === stationId);
}

/** Persist a manually re-ordered list (ids in the new order). Mirrors
 *  storage.ts's reorderFavorites — ids missing from storage are dropped,
 *  any stored stations not named are appended so a stale reorder never
 *  loses data. */
export function reorderListStations(listId: string, orderedIds: string[]): void {
  const all = getLists();
  const l = all.find((x) => x.id === listId);
  if (!l) return;
  const byId = new Map(l.stations.map((s) => [s.id, s]));
  const next: Station[] = [];
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (s) {
      next.push(s);
      byId.delete(id);
    }
  }
  for (const s of byId.values()) next.push(s);
  l.stations = next;
  setLists(all);
}

/** Persist a manually re-ordered set of lists (ids in the new order).
 *  Same drop-missing / append-unnamed safety as reorderListStations, so a
 *  stale reorder never loses a list. */
export function reorderLists(orderedIds: string[]): void {
  const all = getLists();
  const byId = new Map(all.map((l) => [l.id, l]));
  const next: StationList[] = [];
  for (const id of orderedIds) {
    const l = byId.get(id);
    if (l) {
      next.push(l);
      byId.delete(id);
    }
  }
  for (const l of byId.values()) next.push(l);
  setLists(next);
}
