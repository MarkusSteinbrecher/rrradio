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
}

export interface PublicLocationItem {
  code: string;
  name: string;
  count: number;
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
}

/** Roll up the three Worker payloads into the dashboard's view model. */
export function aggregateDashboard(
  items: TopStationItem[],
  locations: PublicLocationItem[],
  catalog: Station[],
): DashboardData {
  let totalPlays = 0;
  let totalStations = 0;
  const builtinByName = new Map<string, Station>();
  for (const s of catalog) builtinByName.set(s.name.toLowerCase(), s);

  const byStationCountry = new Map<string, number>();
  for (const it of items) {
    totalStations++;
    totalPlays += it.count;
    const builtin = builtinByName.get(it.name.toLowerCase());
    const cc = builtin?.country?.toUpperCase();
    if (!cc) continue;
    byStationCountry.set(cc, (byStationCountry.get(cc) ?? 0) + it.count);
  }

  const byListenerCountry = new Map<string, number>();
  for (const loc of locations) {
    if (!loc.code) continue;
    const cc = loc.code.toUpperCase();
    byListenerCountry.set(cc, (byListenerCountry.get(cc) ?? 0) + loc.count);
  }

  return { totalPlays, totalStations, byListenerCountry, byStationCountry };
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
