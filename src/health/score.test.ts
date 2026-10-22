import { describe, expect, it } from 'vitest';
import { parseDashboard, type HealthRow } from './model';
import { goodShare, grade, needsAttention, problemRank, summarise, worstIssue } from './score';

const COLS = ['id', 'name', 'tier', 'stream', 'np', 'logo', 'home'];
const rows = parseDashboard({
  cols: COLS,
  rows: [
    ['perfect', 'Perfect', 'curated', 'ok', 'api', 'ok', 'ok'],
    ['dead', 'Dead', 'long-tail', 'bad', 'none', 'bad', 'bad'],
    ['mixed', 'Mixed', 'long-tail', 'ok', 'silent', 'warn', 'na'],
    ['plays-bare', 'Plays bare', 'long-tail', 'ok', 'none', 'bad', 'bad'],
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

describe('summarise', () => {
  it('counts each dimension over the stations it checked', () => {
    const s = summarise(rows);
    expect(s.stream).toEqual({ dim: 'stream', good: 3, weak: 0, bad: 1, checked: 4 });
    expect(goodShare(s.stream)).toBe(0.75);
    expect(s.home).toMatchObject({ good: 1, bad: 2, checked: 3 });
  });
  it('has no share for an empty catalog', () => {
    expect(goodShare(summarise([]).stream)).toBeNull();
  });
});

describe('problemRank', () => {
  it('puts a failing stream below any station that plays, however bare', () => {
    expect(problemRank(byId('dead'))).toBeLessThan(problemRank(byId('plays-bare')));
    expect(problemRank(byId('plays-bare'))).toBeLessThan(problemRank(byId('mixed')));
    expect(problemRank(byId('mixed'))).toBeLessThan(problemRank(byId('perfect')));
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
