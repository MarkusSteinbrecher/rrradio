import { describe, expect, it } from 'vitest';
import {
  hasStreamVariants,
  playbackPlan,
  retryDelayMs,
  selectVariant,
} from './stream-select';
import type { Station, StreamVariant } from './types';

const BEST = 'https://example.com/best';

function station(streams?: StreamVariant[], streamUrl = BEST): Station {
  return { id: 'x', name: 'X', streamUrl, streams };
}

const tagged = station([
  { url: BEST, bitrate: 192, codec: 'AAC', tier: 'best' },
  { url: 'https://example.com/balanced', bitrate: 128, codec: 'AAC', tier: 'balanced' },
  { url: 'https://example.com/data', bitrate: 64, codec: 'AAC', tier: 'data' },
]);

const urls = (s: Station, pref: 'best' | 'data') => playbackPlan(s, pref).map((e) => e.url);

describe('selectVariant', () => {
  it('ignores the preference for a single-stream station', () => {
    expect(selectVariant(station(), 'best')).toEqual({ url: BEST, index: 0, variant: undefined });
    expect(selectVariant(station(), 'data').url).toBe(BEST);
    expect(urls(station(), 'data')).toEqual([BEST]);
  });

  it('best starts on the best variant, data on the data variant', () => {
    expect(selectVariant(tagged, 'best')).toMatchObject({ url: BEST, index: 0 });
    expect(selectVariant(tagged, 'data')).toMatchObject({
      url: 'https://example.com/data',
      index: 2,
      variant: { bitrate: 64 },
    });
  });

  it('data falls back to the lowest variant when no data tier is tagged', () => {
    const s = station([
      { url: BEST, tier: 'best' },
      { url: 'https://example.com/balanced', tier: 'balanced' },
    ]);
    expect(selectVariant(s, 'data').url).toBe('https://example.com/balanced');
  });

  it('data falls back to ordinal position when no tiers are tagged', () => {
    const s = station([{ url: BEST }, { url: 'https://example.com/lower' }]);
    expect(selectVariant(s, 'data').url).toBe('https://example.com/lower');
    expect(selectVariant(s, 'best').url).toBe(BEST);
  });

  it('data picks the lowest of several data-tagged variants', () => {
    const s = station([
      { url: BEST, tier: 'best' },
      { url: 'https://example.com/data-hi', tier: 'data' },
      { url: 'https://example.com/data-lo', tier: 'data' },
    ]);
    expect(selectVariant(s, 'data').url).toBe('https://example.com/data-lo');
  });
});

describe('playbackPlan', () => {
  it('best plan walks best → worst', () => {
    expect(urls(tagged, 'best')).toEqual([
      BEST,
      'https://example.com/balanced',
      'https://example.com/data',
    ]);
  });

  it('data plan starts low, then falls back toward best', () => {
    expect(urls(tagged, 'data')).toEqual([
      'https://example.com/data',
      BEST,
      'https://example.com/balanced',
    ]);
  });

  it('de-duplicates repeated URLs', () => {
    const s = station([
      { url: BEST, tier: 'best' },
      { url: BEST, tier: 'data' },
    ]);
    expect(urls(s, 'data')).toEqual([BEST]);
  });

  it('appends streamUrl when streams[0] does not match it', () => {
    const s = station([{ url: 'https://example.com/variant', tier: 'best' }], 'https://example.com/canonical');
    expect(urls(s, 'best')).toEqual(['https://example.com/variant', 'https://example.com/canonical']);
  });

  it('treats an empty streams array as single-stream', () => {
    expect(urls(station([]), 'data')).toEqual([BEST]);
  });
});

describe('hasStreamVariants', () => {
  it('is true only with two or more variants', () => {
    expect(hasStreamVariants(station())).toBe(false);
    expect(hasStreamVariants(station([{ url: BEST }]))).toBe(false);
    expect(hasStreamVariants(tagged)).toBe(true);
  });
});

describe('retryDelayMs', () => {
  it('backs off 1s, 2s, 4s and caps at 30s', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(retryDelayMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});
