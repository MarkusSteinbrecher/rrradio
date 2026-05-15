import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRegionCacheForTests,
  fetchUserRegion,
  geoRestrictionLabel,
  getCachedUserRegion,
  isAvailableInUserRegion,
} from './region';

const countryName = (cc: string): string =>
  ({ CH: 'Switzerland', DE: 'Germany', FR: 'France' })[cc] ?? cc;

beforeEach(() => {
  __resetRegionCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isAvailableInUserRegion', () => {
  it('returns true when station has no restriction', () => {
    expect(isAvailableInUserRegion({}, 'DE')).toBe(true);
    expect(isAvailableInUserRegion({ availableIn: [] }, 'DE')).toBe(true);
  });

  it('returns true when user country is in the allow-list (case-insensitive)', () => {
    expect(isAvailableInUserRegion({ availableIn: ['CH'] }, 'CH')).toBe(true);
    expect(isAvailableInUserRegion({ availableIn: ['CH'] }, 'ch')).toBe(true);
  });

  it('returns false when user country is outside the allow-list', () => {
    expect(isAvailableInUserRegion({ availableIn: ['CH'] }, 'DE')).toBe(false);
  });

  it('fails open when user country is unknown', () => {
    // We'd rather show a geo-restricted station and let it fail at
    // playback than badge a working station as unavailable because we
    // can't read CF-IPCountry from an anycast / Tor edge.
    expect(isAvailableInUserRegion({ availableIn: ['CH'] }, null)).toBe(true);
  });
});

describe('geoRestrictionLabel', () => {
  it('returns null when no restriction', () => {
    expect(geoRestrictionLabel({}, countryName, 'DE')).toBeNull();
  });

  it('returns null when user country is unknown', () => {
    expect(geoRestrictionLabel({ availableIn: ['CH'] }, countryName, null)).toBeNull();
  });

  it('returns null when user is in the allow-list', () => {
    expect(geoRestrictionLabel({ availableIn: ['CH'] }, countryName, 'CH')).toBeNull();
  });

  it('formats a single-country restriction', () => {
    expect(geoRestrictionLabel({ availableIn: ['CH'] }, countryName, 'DE')).toBe(
      'Switzerland only',
    );
  });

  it('formats a multi-country restriction', () => {
    expect(
      geoRestrictionLabel({ availableIn: ['CH', 'FR'] }, countryName, 'DE'),
    ).toBe('Only in Switzerland, France');
  });
});

describe('fetchUserRegion', () => {
  it('reads CF-IPCountry through the worker and caches the result', async () => {
    // mockImplementation builds a fresh Response per call. mockResolvedValue
    // reuses the same Response object across calls, and Response bodies are
    // single-shot streams — so a re-fetch (e.g., if cache reads fail under
    // happy-dom) silently produces `country: undefined` and the bug masks
    // itself as a cache miss.
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ country: 'DE' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    expect(await fetchUserRegion()).toBe('DE');
    expect(getCachedUserRegion()).toBe('DE');
    // Cached call doesn't refetch — important so we don't ping the
    // worker on every page navigation.
    expect(await fetchUserRegion()).toBe('DE');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when the worker says country is unknown', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ country: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    expect(await fetchUserRegion()).toBeNull();
  });

  it('returns null on network error and does not pin the cache', async () => {
    // Network errors fail open: next fetch retries instead of locking
    // the user to "unknown" for a full day.
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    expect(await fetchUserRegion()).toBeNull();
    // No cache entry was written, so a subsequent successful fetch
    // does refetch.
    const second = vi.spyOn(global, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ country: 'CH' }), { status: 200 }),
    );
    expect(await fetchUserRegion()).toBe('CH');
    expect(second).toHaveBeenCalled();
  });

  it('coalesces concurrent calls into a single fetch', async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const pending = new Promise<Response>((r) => (resolveFetch = r));
    const fetchSpy = vi.spyOn(global, 'fetch').mockReturnValue(pending);
    const a = fetchUserRegion();
    const b = fetchUserRegion();
    resolveFetch(
      new Response(JSON.stringify({ country: 'CH' }), { status: 200 }),
    );
    expect(await a).toBe('CH');
    expect(await b).toBe('CH');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
