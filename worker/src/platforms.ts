/**
 * Web / native split of the play counts for the public stats sheet.
 *
 * Every play is one `play: <name>` event in GoatCounter, whichever app
 * it came from. A native play is recorded a second time under
 * `play-<platform>: <name>` (see plays.ts), so the share that came from
 * the iOS app is a path prefix of its own; web is the rest. Pure: no
 * fetch, no env.
 */

export const PLAY_PREFIX = 'play: ';

/** Native platforms that get their own event. Anything else a client
 *  sends stays in the combined count only. */
export const NATIVE_PLATFORMS = ['ios'] as const;
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

export function isNativePlatform(value: string): value is NativePlatform {
  return (NATIVE_PLATFORMS as readonly string[]).includes(value);
}

export function platformPlayPrefix(platform: NativePlatform): string {
  return `play-${platform}: `;
}

export interface HitLike {
  path: string;
  count: number;
  stats?: Array<{ day: string; daily: number }>;
}

export interface PlatformStation {
  name: string;
  /** All plays, web and native together. */
  count: number;
  /** The part of `count` that came from the iOS app. */
  ios: number;
  /** Per-day plays aligned to the response's `days`. */
  series: number[];
  ios_series: number[];
}

export interface PlatformSplit {
  totals: { all: number; ios: number };
  /** Distinct stations played on each side. */
  distinct: { all: number; ios: number; web: number };
  plays_per_day: { all: number[]; ios: number[] };
  /** Union of the top stations overall, on the web and on iOS, so each
   *  of the three views has its own full top list. Sorted by `count`. */
  stations: PlatformStation[];
}

function seriesOf(hit: HitLike, dayIndex: Map<string, number>, length: number): number[] {
  const series = new Array<number>(length).fill(0);
  for (const s of hit.stats ?? []) {
    const idx = dayIndex.get(s.day);
    if (idx !== undefined) series[idx] = s.daily;
  }
  return series;
}

export function platformSplit(hits: HitLike[], days: string[], perList = 25): PlatformSplit {
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const iosPrefix = platformPlayPrefix('ios');
  const byName = new Map<string, PlatformStation>();
  const entry = (name: string): PlatformStation => {
    let station = byName.get(name);
    if (!station) {
      station = {
        name,
        count: 0,
        ios: 0,
        series: new Array<number>(days.length).fill(0),
        ios_series: new Array<number>(days.length).fill(0),
      };
      byName.set(name, station);
    }
    return station;
  };

  for (const hit of hits) {
    if (hit.path.startsWith(PLAY_PREFIX)) {
      const station = entry(hit.path.slice(PLAY_PREFIX.length).trim());
      station.count = hit.count;
      station.series = seriesOf(hit, dayIndex, days.length);
    } else if (hit.path.startsWith(iosPrefix)) {
      const station = entry(hit.path.slice(iosPrefix.length).trim());
      station.ios = hit.count;
      station.ios_series = seriesOf(hit, dayIndex, days.length);
    }
  }

  // The two events are counted independently upstream, so the native
  // one can run ahead of the combined one. The combined count is the
  // floor for the total: a native play is always a play.
  const all = [...byName.values()].filter((s) => s.name);
  for (const s of all) {
    s.count = Math.max(s.count, s.ios);
    s.series = s.series.map((v, i) => Math.max(v, s.ios_series[i]));
  }

  const top = (score: (s: PlatformStation) => number): PlatformStation[] =>
    all
      .filter((s) => score(s) > 0)
      .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))
      .slice(0, perList);
  const picked = new Set([
    ...top((s) => s.count),
    ...top((s) => s.ios),
    ...top((s) => s.count - s.ios),
  ]);
  const stations = [...picked].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const sum = (pick: (s: PlatformStation) => number): number => all.reduce((n, s) => n + pick(s), 0);
  const perDay = (pick: (s: PlatformStation) => number[]): number[] =>
    days.map((_, i) => all.reduce((n, s) => n + pick(s)[i], 0));

  return {
    totals: { all: sum((s) => s.count), ios: sum((s) => s.ios) },
    distinct: {
      all: all.filter((s) => s.count > 0).length,
      ios: all.filter((s) => s.ios > 0).length,
      web: all.filter((s) => s.count - s.ios > 0).length,
    },
    plays_per_day: { all: perDay((s) => s.series), ios: perDay((s) => s.ios_series) },
    stations,
  };
}
