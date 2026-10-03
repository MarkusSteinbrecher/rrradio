/**
 * Active playback queue (web port of iOS `StationPlaybackQueue`).
 *
 * Previous/next — on Now Playing, the mini-player and the Media Session
 * lock-screen / Bluetooth controls — step through the context the current
 * station was started from:
 *   - an open station list → that list (live, so edits/reorders apply),
 *   - Favorites            → favorites (live),
 *   - Recents              → the recents order at play time (snapshot; the
 *                            live list reshuffles on every play),
 *   - Browse / search      → the result list at play time (snapshot).
 * Anything else (deep link, map, featured card, no context) falls back to
 * Favorites. Stepping is circular; a station that isn't in the queue jumps
 * to the first (next) or last (previous) entry.
 */

import type { Station } from './types';

export type QueueSource =
  | { kind: 'list'; listId: string }
  | { kind: 'favorites' }
  | { kind: 'recents'; stations: Station[] }
  | { kind: 'results'; stations: Station[] };

export interface QueueDeps {
  /** Stations of a saved list, or undefined when the list no longer exists. */
  listStations: (listId: string) => Station[] | undefined;
  favorites: () => Station[];
}

/** De-duplicate by id, first occurrence wins, order preserved. */
function uniqueById(stations: Station[]): Station[] {
  const seen = new Set<string>();
  return stations.filter((s) => {
    if (!s.id || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

/** The stations previous/next should step through for `source`. An empty
 *  or vanished source (deleted list, emptied results) falls back to
 *  Favorites, as does no source at all. */
export function resolveQueue(source: QueueSource | null, deps: QueueDeps): Station[] {
  let stations: Station[] | undefined;
  if (source?.kind === 'list') stations = deps.listStations(source.listId);
  else if (source?.kind === 'recents' || source?.kind === 'results') stations = source.stations;
  const unique = uniqueById(stations ?? []);
  return unique.length > 0 ? unique : uniqueById(deps.favorites());
}

/** The station one step from `currentId` in `queue`, wrapping circularly.
 *  Undefined when the queue is empty or stepping would stay put. */
export function stepQueue(
  queue: Station[],
  currentId: string,
  direction: 1 | -1,
): Station | undefined {
  if (queue.length === 0) return undefined;
  const idx = queue.findIndex((s) => s.id === currentId);
  if (idx === -1) return direction === 1 ? queue[0] : queue[queue.length - 1];
  if (queue.length === 1) return undefined;
  return queue[(idx + direction + queue.length) % queue.length];
}

/** True when `source` is the given list — drives the Library-home card's
 *  now-playing indicator. */
export function isListQueue(source: QueueSource | null, listId: string): boolean {
  return source?.kind === 'list' && source.listId === listId;
}
