/**
 * Visitor region detection for geo-restricted stations.
 *
 * The Cloudflare Worker hands us back the visitor's country via
 * `/api/public/region`, sourced from Cloudflare's `CF-IPCountry`
 * header (network location, not the device locale — exactly what we
 * want for "can this station's stream reach you"). The result is
 * cached in localStorage for a day so most page loads don't pay
 * the round-trip.
 *
 * Country can legitimately be `null` (Tor exits, anycast, missing
 * header). Callers should treat null as "unknown" and fall back to
 * "no restriction" UX — better to over-show a station than to badge
 * a working one as inaccessible.
 */
import { STATS_WORKER_BASE } from './config';
import type { Station } from './types';

const CACHE_KEY = 'rrradio.region.v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

interface CacheEntry {
  country: string | null;
  fetchedAt: number;
}

let inMemoryCountry: string | null | undefined = undefined;
let inFlight: Promise<string | null> | null = null;

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed.fetchedAt !== 'number') return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(country: string | null): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ country, fetchedAt: Date.now() }));
  } catch {
    // Storage full or denied — fine, we'll just refetch next time.
  }
}

/** Synchronous cached read. Returns the user's country (uppercase
 *  ISO-3166 alpha-2) when known, or null when unknown or not yet
 *  fetched. Use `fetchUserRegion()` to populate the cache on boot. */
export function getCachedUserRegion(): string | null {
  if (inMemoryCountry !== undefined) return inMemoryCountry;
  const cached = readCache();
  inMemoryCountry = cached?.country ?? null;
  return inMemoryCountry;
}

/** Fetch the visitor's country from the worker, with cache + dedupe.
 *  Always resolves — network errors map to `null` (unknown). Safe to
 *  call repeatedly; subsequent calls return the same in-flight or
 *  cached value. */
export async function fetchUserRegion(): Promise<string | null> {
  // In-memory cache first. Doesn't depend on localStorage being
  // reachable (private-mode Safari, sandboxed iframes), and is the
  // only state that's guaranteed to round-trip in the same session.
  if (inMemoryCountry !== undefined) return inMemoryCountry;
  const cached = readCache();
  if (cached) {
    inMemoryCountry = cached.country;
    return cached.country;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(`${STATS_WORKER_BASE}/api/public/region`);
      if (!res.ok) return null;
      const data = (await res.json()) as { country?: unknown };
      const country =
        typeof data.country === 'string' && data.country.length === 2
          ? data.country.toUpperCase()
          : null;
      writeCache(country);
      inMemoryCountry = country;
      return country;
    } catch {
      // Don't poison the cache on network errors — fail open so the
      // next visit retries instead of pinning "unknown" for a day.
      // Importantly, leave inMemoryCountry as `undefined` (the
      // "unset" sentinel) rather than setting it to `null` (the
      // "known-unknown" value), otherwise the in-memory cache would
      // short-circuit subsequent calls and never recover from a
      // transient network blip.
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Returns true when the station has no known geo-restriction OR the
 *  user is inside the allow-list OR we don't know where the user is.
 *  Fails open — when in doubt we show the station as available.
 *  `userCountry` defaults to the cached region but can be overridden
 *  for tests. */
export function isAvailableInUserRegion(
  station: Pick<Station, 'availableIn'>,
  userCountry: string | null = getCachedUserRegion(),
): boolean {
  if (!station.availableIn || station.availableIn.length === 0) return true;
  if (!userCountry) return true;
  return station.availableIn.includes(userCountry.toUpperCase());
}

/** Short user-facing label for the geo restriction, e.g. "Switzerland
 *  only" when the station has `availableIn: ['CH']` and the visitor
 *  isn't in CH. Returns null when no badge should be shown. */
export function geoRestrictionLabel(
  station: Pick<Station, 'availableIn'>,
  countryName: (cc: string) => string,
  userCountry: string | null = getCachedUserRegion(),
): string | null {
  if (!station.availableIn || station.availableIn.length === 0) return null;
  if (!userCountry) return null;
  if (station.availableIn.map((c) => c.toUpperCase()).includes(userCountry.toUpperCase())) {
    return null;
  }
  if (station.availableIn.length === 1) {
    return `${countryName(station.availableIn[0])} only`;
  }
  return `Only in ${station.availableIn.map(countryName).join(', ')}`;
}

/** Test seam: reset the in-memory cache. Not exported through index;
 *  reach in via the module import in test files. */
export function __resetRegionCacheForTests(): void {
  inMemoryCountry = undefined;
  inFlight = null;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
