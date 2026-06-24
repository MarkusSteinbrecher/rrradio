import { describe, it, expect, vi } from 'vitest';
import {
  FavoritesCoverStore,
  fetchStationCover,
  type FavCoverEntry,
  type FavCoverFetcher,
} from './favoritesMetadata';
import type { Station } from './types';

const st = (id: string): Station => ({ id, name: id, streamUrl: `https://example.com/${id}` });

const cover = (id: string, updatedAt = 0): FavCoverEntry => ({ coverUrl: `cover-${id}`, updatedAt });

interface Harness {
  store: FavoritesCoverStore;
  onChange: ReturnType<typeof vi.fn>;
  tick: () => void;
}

function makeStore(opts: {
  fetchOne: FavCoverFetcher;
  now?: () => number;
  concurrency?: number;
  maxEntries?: number;
} & Record<string, unknown>): Harness {
  const onChange = vi.fn();
  let timerCb: (() => void) | null = null;
  const store = new FavoritesCoverStore(onChange, {
    fetchOne: opts.fetchOne,
    now: opts.now ?? (() => 0),
    refreshIntervalMs: 1000,
    concurrency: opts.concurrency ?? 2,
    maxEntries: opts.maxEntries,
    setTimer: (cb) => {
      timerCb = cb;
      return 1;
    },
    clearTimer: () => {
      timerCb = null;
    },
  });
  return { store, onChange, tick: () => timerCb?.() };
}

describe('FavoritesCoverStore.stationsNeedingFetch', () => {
  it('dedupes by id and excludes rows attempted within the refresh window', () => {
    const { store } = makeStore({ fetchOne: async () => null });
    store.setVisibleStations([st('a'), st('a'), st('b')]);
    expect(store.stationsNeedingFetch(0).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('FavoritesCoverStore.fetchPending', () => {
  it('fills entries and notifies once per cycle that lands art', async () => {
    const fetchOne: FavCoverFetcher = async (s) => cover(s.id);
    const { store, onChange } = makeStore({ fetchOne });
    store.setVisibleStations([st('a'), st('b')]);
    await store.fetchPending();
    expect(store.get('a')?.coverUrl).toBe('cover-a');
    expect(store.get('b')?.coverUrl).toBe('cover-b');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('negative-caches: a station that yields nothing is not re-tapped within the window', async () => {
    const calls: string[] = [];
    let t = 0;
    const fetchOne: FavCoverFetcher = async (s) => {
      calls.push(s.id);
      return s.id === 'a' ? cover('a') : null;
    };
    const { store } = makeStore({ fetchOne, now: () => t });
    store.setVisibleStations([st('a'), st('b')]);

    await store.fetchPending();
    expect(calls.sort()).toEqual(['a', 'b']);

    // Within the window: both 'a' (had art) and 'b' (yielded nothing) are
    // stamped, so neither is re-fetched.
    calls.length = 0;
    await store.fetchPending();
    expect(calls).toEqual([]);

    // Past the window: both go stale again.
    t = 1000;
    calls.length = 0;
    await store.fetchPending();
    expect(calls.sort()).toEqual(['a', 'b']);
  });

  it('skips identity-only updates (same cover → no notify)', async () => {
    let t = 0;
    const fetchOne: FavCoverFetcher = async () => ({ coverUrl: 'same', updatedAt: 0 });
    const { store, onChange } = makeStore({ fetchOne, now: () => t });
    store.setVisibleStations([st('a')]);

    await store.fetchPending();
    expect(onChange).toHaveBeenCalledTimes(1);

    t = 1000; // expire the freshness window so it re-fetches
    await store.fetchPending();
    expect(onChange).toHaveBeenCalledTimes(1); // cover unchanged → no second notify
  });

  it('caps concurrency at the configured limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchOne: FavCoverFetcher = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
      return null;
    };
    const { store } = makeStore({ fetchOne, concurrency: 2 });
    store.setVisibleStations([st('a'), st('b'), st('c'), st('d')]);
    await store.fetchPending();
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('evicts the oldest entries past maxEntries', async () => {
    let u = 0;
    const fetchOne: FavCoverFetcher = async (s) => ({ coverUrl: `c-${s.id}`, updatedAt: u++ });
    const { store } = makeStore({ fetchOne, maxEntries: 2 });
    store.setVisibleStations([st('a'), st('b'), st('c')]);
    await store.fetchPending();
    expect(store.get('a')).toBeUndefined(); // oldest, evicted
    expect(store.get('b')).toBeDefined();
    expect(store.get('c')).toBeDefined();
  });
});

describe('FavoritesCoverStore lifecycle', () => {
  it('start() runs an initial fetch and arms the poll; stop() disarms', async () => {
    const fetchOne = vi.fn<FavCoverFetcher>(async (s) => cover(s.id));
    const { store, tick } = makeStore({ fetchOne });
    store.setVisibleStations([st('a')]);
    store.start();
    await new Promise((r) => setTimeout(r, 0)); // let the start()-triggered fetch settle
    expect(store.get('a')?.coverUrl).toBe('cover-a');

    store.stop();
    tick(); // the fake timer is cleared, so this is a no-op
    expect(fetchOne).toHaveBeenCalledTimes(1);
  });

  it('keeps the entry cache across stop()', async () => {
    const fetchOne: FavCoverFetcher = async (s) => cover(s.id);
    const { store } = makeStore({ fetchOne });
    store.setVisibleStations([st('a')]);
    await store.fetchPending();
    store.stop();
    expect(store.get('a')?.coverUrl).toBe('cover-a');
  });
});

describe('fetchStationCover', () => {
  it('returns null for a station with no broadcaster fetcher', async () => {
    const entry = await fetchStationCover(st('no-fetcher'), new AbortController().signal);
    expect(entry).toBeNull();
  });
});
