import { describe, expect, it } from 'vitest';
import { parseDashboard, type HealthRow } from './model';
import { grade, needsAttention, stationScore, summarise, worstIssue } from './score';

const COLS = ['id', 'name', 'tier', 'stream', 'np', 'logo', 'home'];
const rows = parseDashboard({
  cols: COLS,
  rows: [
    ['perfect', 'Perfect', 'curated', 'ok', 'api', 'ok', 'ok'],
    ['dead', 'Dead', 'long-tail', 'bad', 'none', 'bad', 'bad'],
    ['mixed', 'Mixed', 'long-tail', 'ok', 'silent', 'warn', 'na'],
    ['unchecked', 'Unchecked', 'long-tail', '', '', '', ''],
  ],
}).rows;
const byId = (id: string): HealthRow => rows.find((r) => r.id === id) as HealthRow;

describe('grade', () => {
  it('maps verdicts and now-playing kinds to good / weak / bad / skip', () => {
    expect(grade(byId('perfect'), 'np')).toBe('good');
    expect(grade(byId('mixed'), 'np')).toBe('weak');
    expect(grade(byId('dead'), 'np')).toBe('bad');
    expect(grade(byId('mixed'), 'home')).toBe('skip');
    expect(grade(byId('unchecked'), 'stream')).toBe('skip');
  });
});

describe('stationScore', () => {
  it('weights the four dimensions and leaves skipped ones out', () => {
    expect(stationScore(byId('perfect'))).toBe(100);
    expect(stationScore(byId('dead'))).toBe(0);
    // stream 1·0.4 + np ½·0.25 + logo ½·0.2, over 0.85 (homepage n/a)
    expect(stationScore(byId('mixed'))).toBe(Math.round(((0.4 + 0.125 + 0.1) / 0.85) * 100));
    expect(stationScore(byId('unchecked'))).toBeNull();
  });
});

describe('summarise', () => {
  it('scores each dimension over the stations it checked', () => {
    const s = summarise(rows);
    expect(s.dims.stream).toMatchObject({ good: 2, weak: 0, bad: 1, checked: 3 });
    expect(s.dims.stream.score).toBeCloseTo(66.67, 1);
    expect(s.dims.home).toMatchObject({ good: 1, bad: 1, checked: 2, score: 50 });
    const expected = 0.4 * (200 / 3) + 0.25 * 50 + 0.2 * 50 + 0.15 * 50;
    expect(s.score).toBeCloseTo(expected, 5);
  });
  it('is null for an empty catalog', () => {
    expect(summarise([]).score).toBeNull();
  });
});

describe('attention', () => {
  it('flags any weak or bad dimension and names the worst one', () => {
    expect(needsAttention(byId('perfect'))).toBe(false);
    expect(needsAttention(byId('mixed'))).toBe(true);
    expect(worstIssue(byId('dead'))).toEqual({ dim: 'stream', grade: 'bad' });
    expect(worstIssue(byId('mixed'))).toEqual({ dim: 'np', grade: 'weak' });
    expect(worstIssue(byId('perfect'))).toBeNull();
  });
});
