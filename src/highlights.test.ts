import { describe, it, expect } from 'vitest';
import { isHighlightActive, resolveHighlights, todayISO, type Highlight } from './highlights';
import type { Station } from './types';

const st = (id: string): Station => ({ id, name: id, streamUrl: `https://example.com/${id}` });

describe('todayISO', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(todayISO(new Date(2026, 5, 13))).toBe('2026-06-13');
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('isHighlightActive', () => {
  it('treats un-windowed entries as always active', () => {
    expect(isHighlightActive({ stationId: 'a' }, '2026-06-13')).toBe(true);
  });

  it('respects the inclusive window', () => {
    const h: Highlight = { stationId: 'a', startsOn: '2026-06-08', endsOn: '2026-06-14' };
    expect(isHighlightActive(h, '2026-06-07')).toBe(false);
    expect(isHighlightActive(h, '2026-06-08')).toBe(true);
    expect(isHighlightActive(h, '2026-06-14')).toBe(true);
    expect(isHighlightActive(h, '2026-06-15')).toBe(false);
  });

  it('honours an open-ended window', () => {
    expect(isHighlightActive({ stationId: 'a', startsOn: '2026-06-08' }, '2026-09-01')).toBe(true);
    expect(isHighlightActive({ stationId: 'a', endsOn: '2026-06-08' }, '2026-06-01')).toBe(true);
  });
});

describe('resolveHighlights', () => {
  const catalog = new Map([
    ['a', st('a')],
    ['b', st('b')],
    ['c', st('c')],
  ]);
  const byId = (id: string) => catalog.get(id);

  it('drops expired and unknown-station entries, keeps file order', () => {
    const feed: Highlight[] = [
      { stationId: 'missing' },
      { stationId: 'a', startsOn: '2026-06-08', endsOn: '2026-06-14' },
      { stationId: 'b', startsOn: '2027-01-01' }, // future window
      { stationId: 'c' },
    ];
    const out = resolveHighlights(feed, byId, '2026-06-13');
    expect(out.map((h) => h.stationId)).toEqual(['a', 'c']);
    expect(out[0].station.id).toBe('a');
  });

  it('dedupes by station id (first wins)', () => {
    const feed: Highlight[] = [
      { stationId: 'a', blurb: 'first' },
      { stationId: 'a', blurb: 'second' },
    ];
    const out = resolveHighlights(feed, byId, '2026-06-13');
    expect(out).toHaveLength(1);
    expect(out[0].blurb).toBe('first');
  });

  it('caps at the limit', () => {
    const feed: Highlight[] = ['a', 'b', 'c'].map((id) => ({ stationId: id }));
    expect(resolveHighlights(feed, byId, '2026-06-13', 2)).toHaveLength(2);
  });
});
