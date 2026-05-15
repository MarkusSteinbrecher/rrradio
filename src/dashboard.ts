/**
 * Dashboard aggregation — pure reducers over the raw GoatCounter
 * payloads the dashboard sheet displays. Extracted from `src/main.ts`
 * (audit #77 follow-up).
 *
 * The aggregation step joins three Worker responses into a single
 * `DashboardData` shape the render layer reads from:
 *   - top-stations (`{ name, count }[]`) → byStationCountry
 *   - public-locations (`{ code, name, count }[]`) → byListenerCountry
 *   - top-stations           → totalPlays / totalStations
 *
 * Pure: no DOM access, no module globals. The "joined against
 * BUILTIN_STATIONS" piece in the original took the catalog as a
 * module global — here it's an explicit parameter so tests can pass
 * a tiny fixture instead of bootstrapping the full catalog.
 */

import type { Station } from './types';

export interface TopStationItem {
  name: string;
  count: number;
  /** Per-day plays in the requested window, oldest → newest. Same
   *  length as `DashboardData.days`. Optional because older worker
   *  builds didn't emit it — frontends should treat missing as
   *  "no sparkline available". */
  series?: number[];
}

export interface PublicLocationItem {
  code: string;
  name: string;
  count: number;
  /** Per-day visit counts, oldest → newest. Aligned to the worker's
   *  top-level `days` array. Optional because older worker builds
   *  didn't emit it — frontends fall back to a single bar then. */
  series?: number[];
}

export interface PublicTotals {
  total?: number;
  total_events?: number;
  range_days?: number;
}

/** Which country map drives the table + map view. The "Listeners"
 *  view shows where visitors are from; "Stations" shows where the
 *  played stations originate. */
export type DashCountryView = 'listeners' | 'stations';

export interface DashboardData {
  totalPlays: number;
  totalStations: number;
  /** Visitor-country counts (where listeners browse from). */
  byListenerCountry: Map<string, number>;
  /** Station-origin counts (where each played station is from),
   *  built from the top-stations payload joined against the catalog. */
  byStationCountry: Map<string, number>;
  /** Per-day plays summed across all stations whose origin country is
   *  the map key. Same length as `days` for every entry. Empty when
   *  the worker didn't supply per-station series (older builds). */
  byStationCountrySeries: Map<string, number[]>;
  /** Per-day visits per visitor country, aligned to `days`. Built by
   *  the worker via one /stats/locations call per day in the window
   *  (GoatCounter has no built-in daily breakdown on /stats/locations,
   *  but it accepts start+end so per-day queries get us the same data).
   *  Empty when the worker didn't ship a series — frontends should
   *  fall back to the single share-of-max bar in that case. */
  byListenerCountrySeries: Map<string, number[]>;
  /** Day labels (YYYY-MM-DD), oldest → newest. Empty when the worker
   *  didn't supply a daily series. */
  days: string[];
}

/** Roll up the three Worker payloads into the dashboard's view model.
 *
 *  `playsTotal` is the worker-computed sum across ALL matched `play:`
 *  events in the window. Pass it when available — items are capped at
 *  the worker's `limit`, so summing them undercounts as soon as more
 *  than `limit` distinct stations were played. Falls back to summing
 *  items when undefined. */
export function aggregateDashboard(
  items: TopStationItem[],
  locations: PublicLocationItem[],
  catalog: Station[],
  playsTotal?: number,
  days: string[] = [],
): DashboardData {
  let summedPlays = 0;
  let totalStations = 0;
  const builtinByName = new Map<string, Station>();
  for (const s of catalog) builtinByName.set(s.name.toLowerCase(), s);

  // Lock the series length to the first non-empty series we see — every
  // station's series is sourced from the same /stats/hits call so they
  // all match. Stays 0 if the worker didn't emit any series, which
  // signals "no sparkline data" to the render layer.
  const seriesLen =
    days.length || items.find((i) => i.series && i.series.length > 0)?.series?.length || 0;

  const byStationCountry = new Map<string, number>();
  const byStationCountrySeries = new Map<string, number[]>();
  for (const it of items) {
    totalStations++;
    summedPlays += it.count;
    const builtin = builtinByName.get(it.name.toLowerCase());
    const cc = builtin?.country?.toUpperCase();
    if (!cc) continue;
    byStationCountry.set(cc, (byStationCountry.get(cc) ?? 0) + it.count);
    if (seriesLen > 0 && it.series && it.series.length === seriesLen) {
      let bucket = byStationCountrySeries.get(cc);
      if (!bucket) {
        bucket = new Array<number>(seriesLen).fill(0);
        byStationCountrySeries.set(cc, bucket);
      }
      for (let i = 0; i < seriesLen; i++) bucket[i] += it.series[i] ?? 0;
    }
  }

  const byListenerCountry = new Map<string, number>();
  const byListenerCountrySeries = new Map<string, number[]>();
  for (const loc of locations) {
    if (!loc.code) continue;
    const cc = loc.code.toUpperCase();
    byListenerCountry.set(cc, (byListenerCountry.get(cc) ?? 0) + loc.count);
    // Adopt the series only when it matches the canonical window. Drop
    // mismatched-length payloads rather than render off-by-one bars.
    if (seriesLen > 0 && loc.series && loc.series.length === seriesLen) {
      let bucket = byListenerCountrySeries.get(cc);
      if (!bucket) {
        bucket = new Array<number>(seriesLen).fill(0);
        byListenerCountrySeries.set(cc, bucket);
      }
      for (let i = 0; i < seriesLen; i++) bucket[i] += loc.series[i] ?? 0;
    }
  }

  return {
    totalPlays: playsTotal ?? summedPlays,
    totalStations,
    byListenerCountry,
    byStationCountry,
    byStationCountrySeries,
    byListenerCountrySeries,
    days,
  };
}

/** Pick the active country map for the current view toggle. Pure
 *  reducer over `(d, view)` — main.ts holds the toggle state, this
 *  just translates it into a reference. */
export function activeCountryMap(
  d: DashboardData,
  view: DashCountryView,
): Map<string, number> {
  return view === 'listeners' ? d.byListenerCountry : d.byStationCountry;
}
