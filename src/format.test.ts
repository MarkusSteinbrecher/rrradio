import { describe, expect, it } from 'vitest';
import { fmtSharePct, normalizeForSearch, parseLooseJSON, titleCase } from './format';

describe('titleCase', () => {
  it('uppercases the first letter of every whitespace/hyphen segment', () => {
    expect(titleCase('SAM SMITH - I')).toBe('Sam Smith - I');
    expect(titleCase('hello world')).toBe('Hello World');
  });

  it('preserves Latin-1 diacritics in the segment-start position', () => {
    expect(titleCase('öl ist teuer')).toBe('Öl Ist Teuer');
    expect(titleCase('école buissonnière')).toBe('École Buissonnière');
  });

  it('handles slash-separated segments (used in classical broadcasts)', () => {
    expect(titleCase('beethoven/karajan')).toBe('Beethoven/Karajan');
  });

  it('returns empty for empty input', () => {
    expect(titleCase('')).toBe('');
  });
});

describe('parseLooseJSON', () => {
  it('parses standard JSON', () => {
    expect(parseLooseJSON('{"a":1}')).toEqual({ a: 1 });
    expect(parseLooseJSON('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('strips leading non-JSON noise like BR\'s //@formatter:off', () => {
    expect(parseLooseJSON('//@formatter:off\n{"channelId":"x"}')).toEqual({ channelId: 'x' });
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseLooseJSON('﻿{"a":1}')).toEqual({ a: 1 });
  });

  it('throws on input with no JSON token at all', () => {
    expect(() => parseLooseJSON('not json')).toThrow();
  });
});

describe('normalizeForSearch', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeForSearch('WDR 5')).toBe('wdr5');
    expect(normalizeForSearch('Hit Radio FFH - 80er')).toBe('hitradioffh80er');
  });

  it('preserves German diacritics + ß', () => {
    expect(normalizeForSearch('SR3 Saarländer Straße')).toBe('sr3saarländerstraße');
  });

  it('returns empty for whitespace/punctuation-only input', () => {
    expect(normalizeForSearch('   --  ')).toBe('');
  });

  it('makes "WDR5" match "WDR 5" (the canonical use case)', () => {
    const haystack = normalizeForSearch('WDR 5');
    expect(haystack.includes(normalizeForSearch('wdr5'))).toBe(true);
    expect(haystack.includes(normalizeForSearch('WDR5'))).toBe(true);
    expect(haystack.includes(normalizeForSearch('w-d-r-5'))).toBe(true);
  });
});

describe('fmtSharePct', () => {
  it('rounds to whole percent for normal shares', () => {
    expect(fmtSharePct(589, 691)).toBe('85%');
    expect(fmtSharePct(51, 691)).toBe('7%');
    expect(fmtSharePct(28, 691)).toBe('4%');
  });

  it('shows <1% for non-zero shares that would round to 0', () => {
    expect(fmtSharePct(1, 691)).toBe('<1%');   // ≈ 0.14%
    expect(fmtSharePct(2, 691)).toBe('<1%');   // ≈ 0.29%
    expect(fmtSharePct(3, 691)).toBe('<1%');   // ≈ 0.43%
  });

  it('shows 1% for shares that round up from below 1', () => {
    expect(fmtSharePct(4, 691)).toBe('1%');   // ≈ 0.58% → rounds to 1
  });

  it('returns empty string for total=0 (avoids division-by-zero)', () => {
    expect(fmtSharePct(0, 0)).toBe('');
    expect(fmtSharePct(5, 0)).toBe('');
  });

  it('handles 100%', () => {
    expect(fmtSharePct(50, 50)).toBe('100%');
  });

  it('handles count=0', () => {
    expect(fmtSharePct(0, 100)).toBe('0%');
  });
});
