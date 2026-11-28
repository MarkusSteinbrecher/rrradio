import { describe, it, expect } from 'vitest';
import {
  discoveryCounts,
  abbreviateCount,
  genreChips,
  countryChips,
  countryLogoStations,
  genreLogoStations,
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

describe('countryLogoStations / genreLogoStations', () => {
  const st = (id: string, extra: Partial<Station>): Station =>
    ({ id, name: id, streamUrl: `https://example.com/${id}`, favicon: `https://example.com/${id}.png`, ...extra }) as Station;

  it('takes up to four stations with logos per country, in order', () => {
    const stations = [
      st('a', { country: 'DE' }),
      st('nologo', { country: 'DE', favicon: undefined }),
      st('b', { country: 'de' }),
      st('c', { country: 'DE' }),
      st('d', { country: 'DE' }),
      st('e', { country: 'DE' }),
      st('x', { country: 'FR' }),
    ];
    const out = countryLogoStations(stations, ['de', 'FR', 'IT']);
    expect(out.get('DE')?.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out.get('FR')?.map((s) => s.id)).toEqual(['x']);
    expect(out.get('IT')).toEqual([]);
  });

  it('shows no logo and no network twice on a card, but many independents', () => {
    const stations = [
      st('a', { country: 'GB', broadcaster: 'bbc' }),
      st('b', { country: 'GB', broadcaster: 'bbc' }),
      st('c', { country: 'GB', favicon: 'https://example.com/a.png' }),
      st('d', { country: 'GB', broadcaster: 'independent' }),
      st('e', { country: 'GB', broadcaster: 'independent' }),
    ];
    expect(countryLogoStations(stations, ['GB']).get('GB')?.map((s) => s.id)).toEqual(['a', 'd', 'e']);
  });

  it('takes the first three matching stations with logos per wanted genre', () => {
    const stations = [
      st('j1', { tags: ['jazz'] }),
      st('r1', { tags: ['rock'] }),
      st('j2', { tags: ['jazz', 'rock'] }),
      st('j3', { tags: ['smooth jazz'] }),
      st('j4', { tags: ['jazz'] }),
    ];
    const out = genreLogoStations(stations, ['jazz']);
    expect(out.get('jazz')?.map((s) => s.id)).toEqual(['j1', 'j2', 'j3']);
    expect(out.has('rock')).toBe(false);
  });
});
