import { describe, expect, it } from 'vitest';
import { aggregateDashboard, playsView, type PlatformsPayload } from './dashboard';

describe('aggregateDashboard', () => {
  it('passes through worker-supplied totals', () => {
    const d = aggregateDashboard([], 500, 12, ['d1', 'd2']);
    expect(d.totalPlays).toBe(500);
    expect(d.totalStations).toBe(12);
    expect(d.days).toEqual(['d1', 'd2']);
  });

  it('groups listener-country counts (case-normalized)', () => {
    const d = aggregateDashboard(
      [
        { code: 'CH', name: 'Switzerland', count: 50 },
        { code: 'ch', name: 'Switzerland', count: 25 }, // duplicate, lowercase
        { code: 'DE', name: 'Germany', count: 100 },
      ],
      0,
      0,
    );
    expect(d.byListenerCountry.get('CH')).toBe(75);
    expect(d.byListenerCountry.get('DE')).toBe(100);
  });

  it('skips locations with empty code', () => {
    const d = aggregateDashboard(
      [
        { code: '', name: 'Unknown', count: 100 },
        { code: 'CH', name: 'Switzerland', count: 25 },
      ],
      0,
      0,
    );
    expect(d.byListenerCountry.size).toBe(1);
    expect(d.byListenerCountry.get('CH')).toBe(25);
  });

  it('handles empty inputs', () => {
    const d = aggregateDashboard([], 0, 0);
    expect(d.totalPlays).toBe(0);
    expect(d.totalStations).toBe(0);
    expect(d.byListenerCountry.size).toBe(0);
    expect(d.days).toEqual([]);
  });
});

describe('playsView', () => {
  const days = ['2026-11-26', '2026-11-27'];
  const platforms: PlatformsPayload = {
    totals: { all: 12, ios: 4 },
    distinct: { all: 3, ios: 2, web: 2 },
    plays_per_day: { all: [5, 7], ios: [1, 3] },
    stations: [
      { name: 'FM4', count: 6, ios: 2 },
      { name: 'FIP', count: 4, ios: 0 },
      { name: 'Radio 538', count: 2, ios: 2 },
    ],
  };
  const input = { platforms, items: [], total: 12, distinct: 3, days };

  it('shows both sides for All', () => {
    const v = playsView(input, 'all');
    expect(v).toMatchObject({ hasSplit: true, platform: 'all', plays: 12, web: 8, ios: 4, stationsPlayed: 3 });
    expect(v.perDay).toEqual([
      { day: '2026-11-26', web: 4, ios: 1 },
      { day: '2026-11-27', web: 4, ios: 3 },
    ]);
    expect(v.stations).toEqual([
      { name: 'FM4', web: 4, ios: 2, plays: 6 },
      { name: 'FIP', web: 4, ios: 0, plays: 4 },
      { name: 'Radio 538', web: 0, ios: 2, plays: 2 },
    ]);
  });

  it('shows the web side only, re-ranked, without iOS-only stations', () => {
    const v = playsView(input, 'web');
    expect(v).toMatchObject({ plays: 8, web: 8, ios: 0, stationsPlayed: 2 });
    expect(v.stations.map((s) => [s.name, s.plays])).toEqual([
      ['FIP', 4],
      ['FM4', 4],
    ]);
    expect(v.perDay.every((d) => d.ios === 0)).toBe(true);
  });

  it('shows the iOS side only', () => {
    const v = playsView(input, 'ios');
    expect(v).toMatchObject({ plays: 4, web: 0, ios: 4, stationsPlayed: 2 });
    expect(v.stations.map((s) => [s.name, s.plays])).toEqual([
      ['FM4', 2],
      ['Radio 538', 2],
    ]);
    expect(v.perDay.map((d) => d.ios)).toEqual([1, 3]);
  });

  it('caps the list at the limit', () => {
    expect(playsView(input, 'all', 2).stations).toHaveLength(2);
  });

  it('falls back to one undivided count when the Worker sent no split', () => {
    const v = playsView(
      {
        items: [
          { name: 'FM4', count: 6, series: [2, 4] },
          { name: 'FIP', count: 4, series: [3, 1] },
        ],
        total: 10,
        distinct: 2,
        days,
      },
      'ios',
    );
    expect(v).toMatchObject({ hasSplit: false, platform: 'all', plays: 10, web: 10, ios: 0, stationsPlayed: 2 });
    expect(v.perDay.map((d) => d.web)).toEqual([5, 5]);
    expect(v.stations[0]).toEqual({ name: 'FM4', web: 6, ios: 0, plays: 6 });
  });
});
