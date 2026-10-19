/**
 * Catalog quality score: one number (0–100) for "how good is the catalog
 * today", built from four dimensions a listener notices. Pure — no DOM.
 *
 * Each dimension scores (good + ½·weak) / checked. Unchecked and
 * not-applicable stations are left out of that dimension rather than
 * counted as failures. The overall score is the weighted mean below: a
 * stream that doesn't play matters more than a missing homepage.
 */

import type { HealthRow } from './model';

export type Dimension = 'stream' | 'np' | 'logo' | 'home';
export type Grade = 'good' | 'weak' | 'bad' | 'skip';

export const DIMENSIONS: readonly Dimension[] = ['stream', 'np', 'logo', 'home'];

export const WEIGHT: Record<Dimension, number> = { stream: 0.4, np: 0.25, logo: 0.2, home: 0.15 };

export const DIMENSION_LABEL: Record<Dimension, string> = {
  stream: 'Stream',
  np: 'Now playing',
  logo: 'Logo',
  home: 'Homepage',
};

/** What good / weak / bad mean, per dimension — shown under each bar. */
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

const POINTS: Record<Exclude<Grade, 'skip'>, number> = { good: 1, weak: 0.5, bad: 0 };

/** One station's score, 0–100, or null when nothing about it was checked. */
export function stationScore(row: HealthRow): number | null {
  let sum = 0;
  let weight = 0;
  for (const dim of DIMENSIONS) {
    const g = grade(row, dim);
    if (g === 'skip') continue;
    sum += WEIGHT[dim] * POINTS[g];
    weight += WEIGHT[dim];
  }
  return weight === 0 ? null : Math.round((sum / weight) * 100);
}

/** True when any dimension is weak or bad — something a curator could fix. */
export function needsAttention(row: HealthRow): boolean {
  return DIMENSIONS.some((d) => {
    const g = grade(row, d);
    return g === 'weak' || g === 'bad';
  });
}

export interface DimensionSummary {
  dim: Dimension;
  good: number;
  weak: number;
  bad: number;
  checked: number;
  /** 0–100, null when no station was checked. */
  score: number | null;
}

export interface QualitySummary {
  score: number | null;
  dims: Record<Dimension, DimensionSummary>;
}

export function summarise(rows: readonly HealthRow[]): QualitySummary {
  const dims = {} as Record<Dimension, DimensionSummary>;
  for (const dim of DIMENSIONS) {
    const s: DimensionSummary = { dim, good: 0, weak: 0, bad: 0, checked: 0, score: null };
    for (const r of rows) {
      const g = grade(r, dim);
      if (g !== 'skip') s[g] += 1;
    }
    s.checked = s.good + s.weak + s.bad;
    s.score = s.checked === 0 ? null : ((s.good + 0.5 * s.weak) / s.checked) * 100;
    dims[dim] = s;
  }
  let sum = 0;
  let weight = 0;
  for (const dim of DIMENSIONS) {
    const sc = dims[dim].score;
    if (sc == null) continue;
    sum += WEIGHT[dim] * sc;
    weight += WEIGHT[dim];
  }
  return { score: weight === 0 ? null : sum / weight, dims };
}

/** The worst thing about a station, for one-line "needs attention" rows.
 *  Order follows the weights: a failing stream outranks a missing logo. */
export function worstIssue(row: HealthRow): { dim: Dimension; grade: 'weak' | 'bad' } | null {
  for (const level of ['bad', 'weak'] as const) {
    for (const dim of DIMENSIONS) if (grade(row, dim) === level) return { dim, grade: level };
  }
  return null;
}
