/**
 * Counts behind the dashboard's tiles and charts. Pure — no DOM.
 * Each takes already-filtered rows (filters.ts decides which).
 */

import type { HealthRow, NowPlaying } from './model';
import { failReason, logoIssue, LOGO_ISSUES, NP_KINDS, REASONS, type LogoIssue, type Reason } from './filters';
import { grade } from './score';

export interface Split {
  good: number;
  weak: number;
  bad: number;
}

export interface CountryCount extends Split {
  cc: string;
  total: number;
}

/** Stream verdicts per country, biggest first. Unchecked rows count in
 *  `total` only, so total ≥ good + weak + bad. */
export function byCountry(rows: readonly HealthRow[]): CountryCount[] {
  const map = new Map<string, CountryCount>();
  for (const r of rows) {
    const cc = r.cc || '';
    let c = map.get(cc);
    if (!c) map.set(cc, (c = { cc, total: 0, good: 0, weak: 0, bad: 0 }));
    c.total += 1;
    const g = grade(r, 'stream');
    if (g !== 'skip') c[g] += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.cc.localeCompare(b.cc));
}

/** Countries ranked by failing streams (failing + odd), then share. */
export function byCountryFailing(rows: readonly HealthRow[]): CountryCount[] {
  return byCountry(rows)
    .filter((c) => c.bad + c.weak > 0)
    .sort((a, b) => b.bad + b.weak - (a.bad + a.weak) || b.total - a.total);
}

export interface Count<K extends string> {
  key: K;
  value: number;
}

function tally<K extends string>(rows: readonly HealthRow[], keys: readonly K[], of: (r: HealthRow) => K | ''): Count<K>[] {
  const counts = new Map<K, number>(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = of(r);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return keys.map((key) => ({ key, value: counts.get(key) ?? 0 }));
}

export function byReason(rows: readonly HealthRow[]): Count<Reason>[] {
  return tally(rows, REASONS, failReason).filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
}

export function byLogoIssue(rows: readonly HealthRow[]): Count<LogoIssue>[] {
  return tally(rows, LOGO_ISSUES, logoIssue).filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
}

/** Fixed order (good kinds first) so bars don't jump as filters change. */
export function byNowPlaying(rows: readonly HealthRow[]): Count<Exclude<NowPlaying, ''>>[] {
  return tally(rows, NP_KINDS, (r) => r.np);
}
