import { describe, expect, it } from 'vitest';
import { searchMatcher } from './search';

describe('searchMatcher', () => {
  it('matches every term independently (AND semantics)', () => {
    const m = searchMatcher('bandit rock');
    expect(m('Bandit Rock')).toBe(true);
    expect(m('Bandit Classic Rock')).toBe(true);
    expect(m('Bandit Metal')).toBe(false);
  });

  it('folds diacritics — the Bandit ÍRock case', () => {
    expect(searchMatcher('bandit rock')('Bandit ÍRock')).toBe(true);
    expect(searchMatcher('irock')('Bandit ÍRock')).toBe(true);
    expect(searchMatcher('radio francaise')('Radio Française')).toBe(true);
  });

  it('matches across separator differences via multiple fields', () => {
    const m = searchMatcher('bandit rock');
    expect(m('se-bandit-rock', 'Bandit Rock')).toBe(true);
    // id alone: terms can match across the joined haystack
    expect(searchMatcher('bandit')('se-bandit-rock')).toBe(true);
  });

  it('ignores null fields and extra whitespace', () => {
    expect(searchMatcher('  bandit   rock ')(null, undefined, 'Bandit Rock')).toBe(true);
    expect(searchMatcher('')('anything')).toBe(true);
  });
});
