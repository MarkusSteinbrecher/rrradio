import { describe, it, expect } from 'vitest';
import { cycleSort, sortStations, orderFeaturedFirst } from './sort';
import type { Station } from './types';

const st = (id: string, name: string, featured?: boolean): Station => ({
  id,
  name,
  streamUrl: `https://example.com/${id}`,
  ...(featured ? { featured: true } : {}),
});

describe('cycleSort', () => {
  it('cycles off → A–Z → Z–A → off', () => {
    expect(cycleSort(null)).toBe('az');
    expect(cycleSort('az')).toBe('za');
    expect(cycleSort('za')).toBe(null);
  });
});

describe('sortStations', () => {
  const list = [st('c', 'Charlie'), st('a', 'alpha'), st('b', 'Bravo')];

  it('leaves order untouched and returns the same array when sort is null', () => {
    expect(sortStations(list, null)).toBe(list);
  });

  it('sorts A–Z case-insensitively without mutating the input', () => {
    const out = sortStations(list, 'az');
    expect(out.map((s) => s.name)).toEqual(['alpha', 'Bravo', 'Charlie']);
    expect(list.map((s) => s.name)).toEqual(['Charlie', 'alpha', 'Bravo']);
  });

  it('sorts Z–A', () => {
    expect(sortStations(list, 'za').map((s) => s.name)).toEqual(['Charlie', 'Bravo', 'alpha']);
  });

  it('breaks ties on id', () => {
    const dup = [st('z', 'Same'), st('a', 'Same')];
    expect(sortStations(dup, 'az').map((s) => s.id)).toEqual(['a', 'z']);
  });
});

describe('orderFeaturedFirst', () => {
  it('floats featured stations to the top, preserving relative order', () => {
    const list = [st('a', 'A'), st('b', 'B', true), st('c', 'C'), st('d', 'D', true)];
    expect(orderFeaturedFirst(list).map((s) => s.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('returns the input untouched when nothing is featured', () => {
    const list = [st('a', 'A'), st('b', 'B')];
    expect(orderFeaturedFirst(list)).toBe(list);
  });
});
