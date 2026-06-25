/**
 * Dashboard aggregation — pure reducer over the Worker payload for the
 * public stats sheet. The sheet mirrors what GoatCounter's own dashboard
 * shows for the same window (Visits + Locations) plus rrradio-specific
 * extras (top `play:` events).
 *
 * No more synthesized "station country" join against the local catalog,
 * no Listeners/Stations toggle, no per-country sparkline rollups. If you
 * find yourself wanting one of those again, ask whether it really is a
 * GC metric or whether you're inventing one — the entire point of the
 * recent rewrite was to stop drifting from what GC actually reports.
 */

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
}

export interface PublicTotals {
  total?: number;
  total_events?: number;
  range_days?: number;
}

export interface DashboardData {
  /** Sum of every `play:` event GC has in the window — the worker
   *  returns this as `top_stations.total`, computed across the full
   *  matched-prefix list (not just the displayed top-N). */
  totalPlays: number;
  /** True distinct stations played. Worker computes from the unfiltered
   *  hits buffer; not capped by the top-N display limit. */
  totalStations: number;
  /** Visitor-country counts straight from GC `/stats/locations`. */
  byListenerCountry: Map<string, number>;
  /** Day labels (YYYY-MM-DD), oldest → newest. Used to label sparkline
   *  tooltips on the top-stations table. */
  days: string[];
}

export function aggregateDashboard(
  locations: PublicLocationItem[],
  playsTotal: number,
  distinctStations: number,
  days: string[] = [],
): DashboardData {
  const byListenerCountry = new Map<string, number>();
  for (const loc of locations) {
    if (!loc.code) continue;
    const cc = loc.code.toUpperCase();
    byListenerCountry.set(cc, (byListenerCountry.get(cc) ?? 0) + loc.count);
  }
  return {
    totalPlays: playsTotal,
    totalStations: distinctStations,
    byListenerCountry,
    days,
  };
}
