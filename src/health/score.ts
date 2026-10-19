/**
 * Station quality grades. Pure — no DOM.
 *
 * The headline is whether a station plays (the stream dimension). The
 * other three are extras on top of that and are reported next to it,
 * never blended into one number: a catalog where every station plays but
 * half lack logos is better than the reverse, and a weighted score hides it.
 *
 * Each dimension grades a station good / weak / bad, or skip when the
 * check doesn't apply or hasn't run (skipped stations are left out of
 * that dimension's shares rather than counted as failures).
 */

import type { HealthRow } from './model';

export type Dimension = 'stream' | 'np' | 'logo' | 'home';
export type Extra = Exclude<Dimension, 'stream'>;
export type Grade = 'good' | 'weak' | 'bad' | 'skip';

export const DIMENSIONS: readonly Dimension[] = ['stream', 'np', 'logo', 'home'];
export const EXTRAS: readonly Extra[] = ['np', 'logo', 'home'];

export const DIMENSION_LABEL: Record<Dimension, string> = {
  stream: 'Stream',
  np: 'Now playing',
  logo: 'Logo',
  home: 'Homepage',
};

/** What good / weak / bad mean, per dimension. */
export const GRADE_LABEL: Record<Dimension, Record<'good' | 'weak' | 'bad', string>> = {
  stream: { good: 'Playing', weak: 'Odd reply', bad: 'Failing' },
  np: { good: 'Titles arrive', weak: 'Advertised, none seen', bad: 'No titles' },
  logo: { good: 'Good', weak: 'Weak', bad: 'Missing' },
  home: { good: 'Reachable', weak: 'Blocked', bad: 'Dead' },
};

export const DIMENSION_HINT: Record<Dimension, string> = {
  stream: 'Does the stream answer with audio?',
  np: 'Does the player show what is on air?',
  logo: 'Is there a usable, licensed logo?',
  home: 'Does the station website still load?',
};

function verdictGrade(v: HealthRow['stream']): Grade {
  if (v === 'ok') return 'good';
  if (v === 'warn') return 'weak';
  if (v === 'bad') return 'bad';
  return 'skip';
}

export function grade(row: HealthRow, dim: Dimension): Grade {
  switch (dim) {
    case 'stream':
      return verdictGrade(row.stream);
    case 'np':
      if (row.np === 'api' || row.np === 'icy') return 'good';
      if (row.np === 'silent' || row.np === 'hls') return 'weak';
      if (row.np === 'none') return 'bad';
      return 'skip';
    case 'logo':
      return verdictGrade(row.logo);
    case 'home':
      return verdictGrade(row.home);
  }
}

/** True when any dimension is weak or bad — something a curator could fix. */
export function needsAttention(row: HealthRow): boolean {
  return DIMENSIONS.some((d) => {
    const g = grade(row, d);
    return g === 'weak' || g === 'bad';
  });
}

/** Sort key, lower = worse: a stream that doesn't play outranks every
 *  extra, then the number of bad extras, then weak ones. */
export function problemRank(row: HealthRow): number {
  const stream = grade(row, 'stream');
  let rank = stream === 'bad' ? 0 : stream === 'weak' ? 100 : 200;
  for (const d of EXTRAS) {
    const g = grade(row, d);
    if (g === 'bad') rank -= 10;
    else if (g === 'weak') rank -= 1;
  }
  return rank;
}

export interface DimensionSummary {
  dim: Dimension;
  good: number;
  weak: number;
  bad: number;
  checked: number;
}

export function summarise(rows: readonly HealthRow[]): Record<Dimension, DimensionSummary> {
  const out = {} as Record<Dimension, DimensionSummary>;
  for (const dim of DIMENSIONS) {
    const s: DimensionSummary = { dim, good: 0, weak: 0, bad: 0, checked: 0 };
    for (const r of rows) {
      const g = grade(r, dim);
      if (g !== 'skip') s[g] += 1;
    }
    s.checked = s.good + s.weak + s.bad;
    out[dim] = s;
  }
  return out;
}

/** good / checked, or null when nothing was checked. */
export function goodShare(s: DimensionSummary): number | null {
  return s.checked === 0 ? null : s.good / s.checked;
}

/** The worst thing about a station, for one-line "needs attention" rows.
 *  Stream first: not playing outranks a missing logo. */
export function worstIssue(row: HealthRow): { dim: Dimension; grade: 'weak' | 'bad' } | null {
  for (const level of ['bad', 'weak'] as const) {
    for (const dim of DIMENSIONS) if (grade(row, dim) === level) return { dim, grade: level };
  }
  return null;
}
