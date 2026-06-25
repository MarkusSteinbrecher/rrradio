import { describe, it, expect } from 'vitest';
import {
  discoveryCounts,
  abbreviateCount,
  genreChips,
  countryChips,
  DISCOVERY_COUNTRY_CHIP_LIMIT,
} from './discovery';
import type { Station } from './types';

const st = (id: string, country?: string, tags?: string[]): Station => ({
  id,
  name: id,
  streamUrl: `https://example.com/${id}`,
  ...(country ? { country } : {}),
  ...(tags ? { tags } : {}),
});

describe('discoveryCounts', () => {
  it('counts by country code (upper-cased) and by matched genre', () => {
    const stations = [
      st('a', 'de', ['rock']),
      st('b', 'DE', ['pop']),
      st('c', 'gb', ['rock', 'indie']),
      st('d', undefined, ['rock']),
    ];
    const counts = discoveryCounts(stations);
    expect(counts.country.get('DE')).toBe(2);
    expect(counts.country.get('GB')).toBe(1);
    expect(counts.country.has('')).toBe(false);
    expect(counts.genre.get('rock')).toBe(3);
    expect(counts.genre.get('pop')).toBe(1);
  });

  it('ignores stations without tags for genre counts', () => {
    const counts = discoveryCounts([st('a', 'de')]);
    expect(counts.genre.size).toBe(0);
    expect(counts.country.get('DE')).toBe(1);
  });
});

describe('abbreviateCount', () => {
  it('matches the iOS abbreviation rule', () => {
    expect(abbreviateCount(812)).toBe('812');
    expect(abbreviateCount(999)).toBe('999');
    expect(abbreviateCount(1000)).toBe('1k');
    expect(abbreviateCount(1400)).toBe('1.4k');
    expect(abbreviateCount(2000)).toBe('2k');
    expect(abbreviateCount(2600)).toBe('2.6k');
    expect(abbreviateCount(17000)).toBe('17k');
    expect(abbreviateCount(99900)).toBe('99.9k');
    expect(abbreviateCount(100000)).toBe('100k');
  });
});

describe('genreChips', () => {
  it('drops zero-count genres and sorts by count desc, id asc', () => {
    const counts = discoveryCounts([
      st('a', 'de', ['rock']),
      st('b', 'de', ['rock']),
      st('c', 'de', ['pop']),
    ]);
    const chips = genreChips(counts);
    expect(chips[0]).toMatchObject({ id: 'rock', count: 2 });
    expect(chips.find((c) => c.id === 'pop')).toMatchObject({ count: 1 });
    expect(chips.every((c) => c.count > 0)).toBe(true);
  });
});

describe('countryChips', () => {
  it('sorts by count desc and caps at the country limit', () => {
    const stations: Station[] = [];
    // 25 distinct countries, the first with the most stations.
    for (let i = 0; i < 25; i++) {
      const code = String.fromCharCode(65 + i) + 'X';
      const n = 25 - i;
      for (let j = 0; j < n; j++) stations.push(st(`${code}-${j}`, code));
    }
    const chips = countryChips(discoveryCounts(stations), (c) => `Country ${c}`);
    expect(chips.length).toBe(DISCOVERY_COUNTRY_CHIP_LIMIT);
    expect(chips[0].id).toBe('AX');
    expect(chips[0].label).toBe('Country AX');
    expect(chips[0].count).toBe(25);
  });
});
