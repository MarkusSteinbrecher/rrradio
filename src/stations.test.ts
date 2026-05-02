import { describe, expect, it } from 'vitest';
import { looseSearchQuery } from './stations';

describe('looseSearchQuery', () => {
  it('inserts a space between letter and digit', () => {
    expect(looseSearchQuery('WDR5')).toBe('WDR 5');
    expect(looseSearchQuery('BR24')).toBe('BR 24');
    expect(looseSearchQuery('FFH80')).toBe('FFH 80');
    expect(looseSearchQuery('Antenne1')).toBe('Antenne 1');
  });

  it('inserts a space between digit and letter', () => {
    expect(looseSearchQuery('5live')).toBe('5 live');
    expect(looseSearchQuery('80er')).toBe('80 er');
  });

  it('preserves the query untouched when it already contains whitespace', () => {
    expect(looseSearchQuery('WDR 5')).toBe('WDR 5');
    expect(looseSearchQuery('Hit Radio FFH')).toBe('Hit Radio FFH');
    expect(looseSearchQuery(' wdr 5 ')).toBe('wdr 5');
  });

  it('preserves the query when there are no letter↔digit boundaries', () => {
    expect(looseSearchQuery('jazz')).toBe('jazz');
    expect(looseSearchQuery('100,5')).toBe('100,5'); // comma between digits — no boundary
  });

  it('handles undefined / empty input', () => {
    expect(looseSearchQuery(undefined)).toBeUndefined();
    expect(looseSearchQuery('')).toBe('');
    expect(looseSearchQuery('   ')).toBe('');
  });

  it('preserves case (RB substring search is case-insensitive anyway)', () => {
    expect(looseSearchQuery('wdr5')).toBe('wdr 5');
    expect(looseSearchQuery('WDR5')).toBe('WDR 5');
    expect(looseSearchQuery('WdR5')).toBe('WdR 5');
  });

  it('handles German diacritics on the letter side', () => {
    expect(looseSearchQuery('München1')).toBe('München 1');
  });
});
