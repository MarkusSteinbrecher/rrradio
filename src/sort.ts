import type { Station } from './types';

// Browse alphabet sort, mirroring the iOS `BrowseSort` cycle. The Browse
// sort row exposes only the alphabet cycle: off → A–Z → Z–A → off.
export type BrowseSort = null | 'az' | 'za';

/** Advance the alphabet sort one step in the cycle. Mirrors iOS
 *  `BrowseSortRow.cycleAlphabet`. */
export function cycleSort(sort: BrowseSort): BrowseSort {
  if (sort === 'az') return 'za';
  if (sort === 'za') return null;
  return 'az';
}

// `sensitivity: 'accent'` matches iOS `localizedCaseInsensitiveCompare`
// (case-insensitive, diacritic-sensitive).
const collator = new Intl.Collator(undefined, { sensitivity: 'accent', usage: 'sort' });

function nameAscending(a: Station, b: Station): number {
  const byName = collator.compare(a.name, b.name);
  if (byName !== 0) return byName;
  // Stable id tiebreak so equal names keep a deterministic order.
  return collator.compare(a.id, b.id);
}

/** Sort by the alphabet sort. `null` returns the list untouched (a fresh
 *  copy is only made when actually sorting). */
export function sortStations(stations: Station[], sort: BrowseSort): Station[] {
  if (sort === null) return stations;
  const out = stations.slice().sort(nameAscending);
  if (sort === 'za') out.reverse();
  return out;
}

/** Featured-first ordering for the un-queried catalog: `featured: true`
 *  stations float to the top, otherwise the input order is preserved
 *  (stable). Mirrors iOS `Catalog.orderForBrowse`. */
export function orderFeaturedFirst(stations: Station[]): Station[] {
  const featured: Station[] = [];
  const rest: Station[] = [];
  for (const s of stations) (s.featured === true ? featured : rest).push(s);
  return featured.length === 0 ? stations : [...featured, ...rest];
}
