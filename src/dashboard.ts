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

// ─── Web / iOS split of the plays ───────────────────────────

/** What the sheet's selector can show. */
export type StatsPlatform = 'all' | 'web' | 'ios';

export interface PlatformStationItem {
  name: string;
  /** All plays, web and iOS together. */
  count: number;
  /** The part of `count` that came from the iOS app. */
  ios: number;
  series?: number[];
  ios_series?: number[];
}

/** `platforms` block of the Worker's dashboard payload (worker/src/platforms.ts). */
export interface PlatformsPayload {
  totals: { all: number; ios: number };
  distinct: { all: number; ios: number; web: number };
  plays_per_day: { all: number[]; ios: number[] };
  stations: PlatformStationItem[];
}

export interface PlaysViewStation {
  name: string;
  web: number;
  ios: number;
  /** Plays shown for the selected platform: `web + ios`. */
  plays: number;
}

export interface PlaysView {
  /** False when the Worker sent no split (older build): everything is
   *  shown as one undivided count and the selector has nothing to do. */
  hasSplit: boolean;
  /** The platform actually shown; 'all' whenever there is no split. */
  platform: StatsPlatform;
  plays: number;
  web: number;
  ios: number;
  stationsPlayed: number;
  perDay: Array<{ day: string; web: number; ios: number }>;
  stations: PlaysViewStation[];
}

export interface PlaysInput {
  platforms?: PlatformsPayload | null;
  items: TopStationItem[];
  total: number;
  distinct: number;
  days: string[];
}

/** The plays numbers for one selector position. A side that is not
 *  selected is zero everywhere, so the renderer draws what it is given
 *  and never has to know which position is active. */
export function playsView(input: PlaysInput, platform: StatsPlatform, limit = 25): PlaysView {
  const { platforms, days } = input;
  if (!platforms) {
    const perDay = days.map((day, i) => ({
      day,
      web: input.items.reduce((n, it) => n + (it.series?.[i] ?? 0), 0),
      ios: 0,
    }));
    return {
      hasSplit: false,
      platform: 'all',
      plays: input.total,
      web: input.total,
      ios: 0,
      stationsPlayed: input.distinct,
      perDay,
      stations: input.items
        .slice(0, limit)
        .map((it) => ({ name: it.name, web: it.count, ios: 0, plays: it.count })),
    };
  }

  const showWeb = platform !== 'ios';
  const showIos = platform !== 'web';
  const web = showWeb ? Math.max(0, platforms.totals.all - platforms.totals.ios) : 0;
  const ios = showIos ? platforms.totals.ios : 0;
  const stations = platforms.stations
    .filter((s) => typeof s.name === 'string' && s.name.length > 0)
    .map((s) => {
      const w = showWeb ? Math.max(0, s.count - s.ios) : 0;
      const i = showIos ? s.ios : 0;
      return { name: s.name, web: w, ios: i, plays: w + i };
    })
    .filter((s) => s.plays > 0)
    .sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name))
    .slice(0, limit);
  const perDay = days.map((day, i) => {
    const all = platforms.plays_per_day.all[i] ?? 0;
    const onIos = platforms.plays_per_day.ios[i] ?? 0;
    return { day, web: showWeb ? Math.max(0, all - onIos) : 0, ios: showIos ? onIos : 0 };
  });
  return {
    hasSplit: true,
    platform,
    plays: web + ios,
    web,
    ios,
    stationsPlayed: platforms.distinct[platform],
    perDay,
    stations,
  };
}
