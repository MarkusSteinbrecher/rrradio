import type { Station } from './types';
import { GENRES, stationMatchesGenre } from './genre-taxonomy';

// Discovery-landing data + formatting, mirroring the iOS
// `BrowseDiscoveryView` / `BrowseDiscoveryFormat` caps and counts.
export const DISCOVERY_COUNTRY_CHIP_LIMIT = 20;
export const DISCOVERY_HIGHLIGHT_LIMIT = 8;
// Higher than the iOS phone rail (which caps lower): wide desktop screens
// have far more horizontal room, so a longer rail fills the width instead of
// trailing off into empty space. Logos lazy-load, so off-screen ones are free.
export const DISCOVERY_BROWSE_ALL_LOGO_LIMIT = 100;

export interface DiscoveryCounts {
  /** genre id → number of catalog stations matching that genre */
  genre: Map<string, number>;
  /** country code (upper-case) → number of catalog stations */
  country: Map<string, number>;
}

export interface Chip {
  id: string;
  label: string;
  count: number;
}

/** Per-genre and per-country catalog match counts. Mirrors iOS
 *  `computeDiscoveryCounts`. */
export function discoveryCounts(stations: Station[]): DiscoveryCounts {
  const genre = new Map<string, number>();
  const country = new Map<string, number>();
  for (const s of stations) {
    const code = (s.country ?? '').toUpperCase();
    if (code) country.set(code, (country.get(code) ?? 0) + 1);
    if (!s.tags || s.tags.length === 0) continue;
    for (const g of GENRES) {
      if (stationMatchesGenre(s, g)) genre.set(g.id, (genre.get(g.id) ?? 0) + 1);
    }
  }
  return { genre, country };
}

/** Abbreviate a chip count: 812, 1.4k, 2k, 17k. Mirrors iOS
 *  `BrowseDiscoveryFormat.count`. */
export function abbreviateCount(value: number): string {
  if (value < 1000) return String(value);
  const thousands = value / 1000;
  if (thousands >= 100) return `${Math.round(thousands)}k`;
  const rounded = Math.round(thousands * 10) / 10;
  if (rounded === Math.round(rounded)) return `${Math.round(rounded)}k`;
  return `${rounded.toFixed(1)}k`;
}

/** Genre chips with a positive count, sorted by count desc then id asc
 *  (stable tiebreak), in catalog-taxonomy order otherwise. */
export function genreChips(counts: DiscoveryCounts): Chip[] {
  const chips: Chip[] = [];
  for (const g of GENRES) {
    const count = counts.genre.get(g.id) ?? 0;
    if (count > 0) chips.push({ id: g.id, label: g.label, count });
  }
  chips.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return chips;
}

/** Country chips, sorted by count desc then code asc, capped at the
 *  discovery country limit. Display names are injected so this stays a
 *  pure function. */
export function countryChips(
  counts: DiscoveryCounts,
  displayName: (code: string) => string,
): Chip[] {
  const chips: Chip[] = [];
  for (const [code, count] of counts.country) {
    chips.push({ id: code, label: displayName(code), count });
  }
  chips.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return chips.slice(0, DISCOVERY_COUNTRY_CHIP_LIMIT);
}

/** Stations whose logos picture a country card: up to `limit` per country
 *  code, in the given order (pass featured-first), each with a logo, and
 *  no logo or broadcaster twice on one card so it does not show four
 *  siblings of one network. */
export function countryLogoStations(stations: Station[], codes: string[], limit = 4): Map<string, Station[]> {
  const out = new Map<string, Station[]>(codes.map((c) => [c.toUpperCase(), []]));
  const seen = new Map<string, Set<string>>();
  let open = out.size;
  for (const s of stations) {
    if (open === 0) break;
    if (!s.favicon) continue;
    const code = (s.country ?? '').toUpperCase();
    const list = out.get(code);
    if (!list || list.length >= limit) continue;
    let keys = seen.get(code);
    if (!keys) seen.set(code, (keys = new Set()));
    // `independent` is the catalog's value for "no network", not a network.
    const broadcaster = s.broadcaster && s.broadcaster !== 'independent' ? `b:${s.broadcaster}` : '';
    if (keys.has(s.favicon) || (broadcaster && keys.has(broadcaster))) continue;
    keys.add(s.favicon);
    if (broadcaster) keys.add(broadcaster);
    list.push(s);
    if (list.length === limit) open--;
  }
  return out;
}

/** Stations whose logos stand in for a genre card's pictures when
 *  genre-art.json has no set for that genre: the first `limit` matching
 *  stations with a logo, in the given order. */
export function genreLogoStations(stations: Station[], genreIds: string[], limit = 3): Map<string, Station[]> {
  const wanted = GENRES.filter((g) => genreIds.includes(g.id));
  const out = new Map<string, Station[]>(wanted.map((g) => [g.id, []]));
  let open = wanted.length;
  for (const s of stations) {
    if (open === 0) break;
    if (!s.favicon || !s.tags || s.tags.length === 0) continue;
    for (const g of wanted) {
      const list = out.get(g.id);
      if (!list || list.length >= limit || !stationMatchesGenre(s, g)) continue;
      list.push(s);
      if (list.length === limit) open--;
    }
  }
  return out;
}
