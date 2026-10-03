import type { Station } from './types';

/**
 * "Surprise me" (#97): pick a random published station, optionally inside the
 * active Browse filter.
 *
 * Tiers, tried in order — the first non-empty one wins:
 *   1. curated + healthy: `working` / `icy-only` status, or editorially
 *      `featured` (these carry real metadata and are hand-checked);
 *   2. `stream-only` stations that carry a logo (a better first impression
 *      and a decent proxy for a maintained entry);
 *   3. everything else that passed the filter.
 *
 * Known duplicates and stream-bad stations are excluded via `exclude` (built
 * into public/surprise.json by tools/build-discovery.mjs from
 * station-duplicates.json + the station health record). Recent picks in
 * `avoid` are skipped while any alternative exists, so repeated taps don't
 * bounce between the same few stations.
 */

/** How many recent picks to keep out of the next draw. */
export const SURPRISE_AVOID_LIMIT = 5;

export interface SurpriseOptions {
  /** Extra gate (the active Browse filter); absent ⇒ whole catalog. */
  matches?: (s: Station) => boolean;
  /** Station ids never to pick (known duplicates, stream-bad). */
  exclude?: ReadonlySet<string>;
  /** Recently picked / currently playing ids to skip when possible. */
  avoid?: readonly string[];
  /** Injectable RNG in [0, 1) for tests. */
  random?: () => number;
}

function tierOf(s: Station): 0 | 1 | 2 {
  if (s.status === 'working' || s.status === 'icy-only' || s.featured) return 0;
  if (s.favicon) return 1;
  return 2;
}

export function pickSurprise(stations: readonly Station[], opts: SurpriseOptions = {}): Station | null {
  const random = opts.random ?? Math.random;
  const avoid = new Set(opts.avoid ?? []);
  const fresh: Station[][] = [[], [], []];
  const stale: Station[][] = [[], [], []];
  for (const s of stations) {
    if (opts.exclude?.has(s.id)) continue;
    if (opts.matches && !opts.matches(s)) continue;
    (avoid.has(s.id) ? stale : fresh)[tierOf(s)].push(s);
  }
  // Fresh picks in any tier beat a recently-played one; only when the whole
  // filtered pool is "recent" do we fall back to repeating.
  const pool = fresh.find((t) => t.length > 0) ?? stale.find((t) => t.length > 0);
  if (!pool) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? null;
}

/** Prepend a pick to the recent-picks list, de-duplicated and capped. */
export function rememberPick(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, SURPRISE_AVOID_LIMIT);
}

/** Parse the persisted recent-picks value (JSON array of ids) defensively. */
export function parseRecentPicks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string').slice(0, SURPRISE_AVOID_LIMIT)
      : [];
  } catch {
    return [];
  }
}

const BASE = import.meta.env.BASE_URL;
let excludeSet: Set<string> = new Set();
let excludePromise: Promise<Set<string>> | null = null;

/** The loaded exclusion set (empty until {@link loadSurpriseExclude}
 *  resolves, or if it failed — the picker then just skips nothing). */
export function getSurpriseExclude(): ReadonlySet<string> {
  return excludeSet;
}

/** Fetch public/surprise.json once (a build artifact; cacheable). */
export function loadSurpriseExclude(): Promise<Set<string>> {
  if (excludePromise) return excludePromise;
  excludePromise = (async () => {
    try {
      const res = await fetch(`${BASE}surprise.json`);
      if (!res.ok) return excludeSet;
      const data = (await res.json()) as { exclude?: unknown };
      if (Array.isArray(data.exclude)) {
        excludeSet = new Set(data.exclude.filter((x): x is string => typeof x === 'string'));
      }
    } catch {
      /* keep the empty set — Surprise me still works, just unfiltered */
    }
    return excludeSet;
  })();
  return excludePromise;
}
