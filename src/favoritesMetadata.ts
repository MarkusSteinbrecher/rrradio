import { findFetcher } from './builtins';
import { isLowResCoverUrl, lookupCover } from './coverArt';
import type { Station } from './types';

/**
 * Per-station "now playing" cover art for library feeds (Favorites, Lists,
 * Recents). Mirrors the iOS `FavoriteNowPlayingStore`: a background poll over
 * the *visible* rows that taps each station's broadcaster metadata fetcher for
 * the current track and resolves its cover art.
 *
 * Web reality (see CLAUDE.md): browsers can't read inline ICY from a raw
 * stream without playing it, so — unlike iOS — we only poll stations that have
 * a code-side broadcaster fetcher (`findFetcher`). Stream-only stations have no
 * track to show, so they yield nothing and are negative-cached.
 */
export interface FavCoverEntry {
  coverUrl: string;
  title?: string;
  artist?: string;
  updatedAt: number;
}

export type FavCoverFetcher = (
  station: Station,
  signal: AbortSignal,
) => Promise<FavCoverEntry | null>;

/** Fetch one station's current-track cover via its broadcaster fetcher,
 *  upgrading a missing / low-res cover through iTunes (same path the live
 *  player uses). Returns null when the station has no fetcher, no current
 *  track, or no resolvable art — the caller then renders nothing for it. */
export const fetchStationCover: FavCoverFetcher = async (station, signal) => {
  const resolved = findFetcher(station);
  if (!resolved) return null;
  let parsed;
  try {
    parsed = await resolved.fetcher(resolved.station, signal);
  } catch {
    return null; // source unreachable / unsupported
  }
  if (!parsed?.track) return null;
  let coverUrl = parsed.coverUrl;
  if (!coverUrl || isLowResCoverUrl(coverUrl)) {
    try {
      const upgraded = await lookupCover(parsed.artist, parsed.track, signal);
      if (upgraded) coverUrl = upgraded;
    } catch {
      /* keep the station-supplied cover (if any) */
    }
  }
  if (!coverUrl) return null;
  return { coverUrl, title: parsed.track, artist: parsed.artist, updatedAt: Date.now() };
};

export interface FavoritesCoverStoreOptions {
  /** Override the per-station fetch (tests inject a deterministic stub). */
  fetchOne?: FavCoverFetcher;
  now?: () => number;
  refreshIntervalMs?: number;
  /** Max metadata fetches in flight at once (network-stack guard). */
  concurrency?: number;
  /** Cache cap across a session's scroll history (leak guard). */
  maxEntries?: number;
  setTimer?: (cb: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

/**
 * Polls cover art for the visible library rows. `onChange` fires once per
 * cycle that lands new art, so the host can repaint the affected cards.
 */
export class FavoritesCoverStore {
  private readonly entries = new Map<string, FavCoverEntry>();
  /** Last fetch *attempt* per station — including attempts that yielded
   *  nothing, so stream-only / no-track stations aren't re-tapped each cycle. */
  private readonly lastAttemptedAt = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private target: Station[] = [];
  private pollTimer: number | undefined;
  private controller: AbortController | undefined;

  private readonly onChange: () => void;
  private readonly fetchOne: FavCoverFetcher;
  private readonly now: () => number;
  private readonly refreshIntervalMs: number;
  private readonly concurrency: number;
  private readonly maxEntries: number;
  private readonly setTimer: (cb: () => void, ms: number) => number;
  private readonly clearTimer: (id: number) => void;

  constructor(onChange: () => void, opts: FavoritesCoverStoreOptions = {}) {
    this.onChange = onChange;
    this.fetchOne = opts.fetchOne ?? fetchStationCover;
    this.now = opts.now ?? Date.now;
    this.refreshIntervalMs = opts.refreshIntervalMs ?? 60_000;
    this.concurrency = opts.concurrency ?? 6;
    this.maxEntries = opts.maxEntries ?? 400;
    this.setTimer = opts.setTimer ?? ((cb, ms) => window.setInterval(cb, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => window.clearInterval(id));
  }

  get(stationId: string): FavCoverEntry | undefined {
    return this.entries.get(stationId);
  }

  /** Report the rows currently worth polling (display order). When the poll
   *  is armed and the change exposed stale rows, fetch them now. */
  setVisibleStations(stations: Station[]): void {
    this.target = stations;
    if (this.pollTimer === undefined) return;
    if (this.stationsNeedingFetch(this.now()).length === 0) return;
    void this.fetchPending();
  }

  /** Arm the periodic poll. Idempotent. */
  start(): void {
    if (this.pollTimer !== undefined) return;
    this.controller = new AbortController();
    void this.fetchPending();
    this.pollTimer = this.setTimer(() => void this.fetchPending(), this.refreshIntervalMs);
  }

  /** Disarm. The entry + attempt caches survive so re-showing the feed
   *  doesn't re-tap every stream inside the freshness window. */
  stop(): void {
    if (this.pollTimer !== undefined) {
      this.clearTimer(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.controller?.abort();
    this.controller = undefined;
    this.inFlight.clear();
  }

  /** Target rows whose last attempt is missing or older than the refresh
   *  window, excluding in-flight ones. Deduped, display order. */
  stationsNeedingFetch(now: number): Station[] {
    const seen = new Set<string>();
    const out: Station[] = [];
    for (const station of this.target) {
      if (seen.has(station.id)) continue;
      seen.add(station.id);
      if (this.inFlight.has(station.id)) continue;
      const attempted = this.lastAttemptedAt.get(station.id);
      if (attempted !== undefined && now - attempted < this.refreshIntervalMs) continue;
      out.push(station);
    }
    return out;
  }

  /** Fetch every stale target and fold the results in. Reentrancy-safe:
   *  the poll tick and a visibility-driven fetch partition work via
   *  `inFlight`. */
  async fetchPending(): Promise<void> {
    const pending = this.stationsNeedingFetch(this.now());
    if (pending.length === 0) return;
    const controller = this.controller ?? new AbortController();
    this.controller = controller;
    for (const station of pending) this.inFlight.add(station.id);

    const results: Array<[string, FavCoverEntry]> = [];
    try {
      await runPool(pending, this.concurrency, async (station) => {
        const entry = await this.fetchOne(station, controller.signal);
        if (entry) results.push([station.id, entry]);
      });
    } finally {
      // Stamp every *attempted* id — stations that yielded nothing won't
      // appear in `results`, and without a stamp they'd be re-tapped on
      // every tick and every visibility change.
      const stamp = this.now();
      for (const station of pending) {
        this.lastAttemptedAt.set(station.id, stamp);
        this.inFlight.delete(station.id);
      }
    }
    this.applyBatch(results);
  }

  private applyBatch(results: Array<[string, FavCoverEntry]>): void {
    let changed = false;
    for (const [id, entry] of results) {
      const prev = this.entries.get(id);
      if (prev && prev.coverUrl === entry.coverUrl) continue; // identity-only update
      this.entries.set(id, entry);
      changed = true;
    }
    if (this.entries.size > this.maxEntries) {
      const evictCount = this.entries.size - this.maxEntries;
      const oldest = [...this.entries.entries()]
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
        .slice(0, evictCount);
      for (const [id] of oldest) this.entries.delete(id);
      changed = true;
    }
    if (changed) this.onChange();
  }
}

/** Run `worker` over `items` with at most `cap` in flight at once. Resolves
 *  when all have completed; a worker that throws rejects the pool. */
async function runPool<T>(
  items: T[],
  cap: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(cap, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}
