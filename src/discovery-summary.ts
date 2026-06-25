import type { DiscoveryCounts } from './discovery';

/**
 * Precomputed Browse-discovery summary (public/discovery.json, built by
 * tools/build-discovery.mjs). A few KB of per-genre / per-country counts so
 * the discovery landing can paint its chips + "Browse all N" count without
 * first downloading the 21 MB full catalog. The full catalog still loads in
 * the background for search / filters / Browse-all; once it lands, the
 * landing recomputes from it (identical counts).
 */
export interface DiscoverySummary {
  /** Total catalog station count — the "Browse all N" figure. */
  total: number;
  /** Same shape the landing derives from the full catalog. */
  counts: DiscoveryCounts;
}

interface DiscoveryJson {
  total?: number;
  genres?: Array<{ id?: string; count?: number }>;
  countries?: Array<{ code?: string; count?: number }>;
}

const BASE = import.meta.env.BASE_URL;

let summary: DiscoverySummary | null = null;
let loadPromise: Promise<DiscoverySummary | null> | null = null;

/** The loaded summary, or null until {@link loadDiscoverySummary} resolves
 *  (or if it failed — callers fall back to the full catalog). */
export function getDiscoverySummary(): DiscoverySummary | null {
  return summary;
}

/** Fetch + parse discovery.json once. Cacheable (no `no-store`): it is a
 *  build artifact that only changes on deploy, so the browser/HTTP cache
 *  can serve repeat loads instantly. */
export function loadDiscoverySummary(): Promise<DiscoverySummary | null> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(`${BASE}discovery.json`);
      if (!res.ok) return null;
      const data = (await res.json()) as DiscoveryJson;
      const genre = new Map<string, number>();
      for (const g of data.genres ?? []) {
        if (typeof g.id === 'string' && typeof g.count === 'number') genre.set(g.id, g.count);
      }
      const country = new Map<string, number>();
      for (const c of data.countries ?? []) {
        if (typeof c.code === 'string' && typeof c.count === 'number') country.set(c.code, c.count);
      }
      summary = { total: typeof data.total === 'number' ? data.total : 0, counts: { genre, country } };
      return summary;
    } catch {
      return null;
    }
  })();
  return loadPromise;
}
