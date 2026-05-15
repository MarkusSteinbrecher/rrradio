import { describe, expect, it } from 'vitest';
import {
  activeCountryMap,
  aggregateDashboard,
  type DashboardData,
} from './dashboard';
import type { Station } from './types';

const catalog: Station[] = [
  { id: 'fm4', name: 'FM4', streamUrl: 'https://x/fm4', country: 'AT' },
  { id: 'br1', name: 'Bayern 1', streamUrl: 'https://x/br1', country: 'DE' },
  { id: 'br2', name: 'Bayern 2', streamUrl: 'https://x/br2', country: 'DE' },
  { id: 'foo', name: 'Foo Radio', streamUrl: 'https://x/foo' /* no country */ },
];

describe('aggregateDashboard', () => {
  it('totals plays + station count from items', () => {
    const d = aggregateDashboard(
      [
        { name: 'FM4', count: 100 },
        { name: 'Bayern 1', count: 80 },
      ],
      [],
      catalog,
    );
    expect(d.totalPlays).toBe(180);
    expect(d.totalStations).toBe(2);
  });

  it('groups station-country counts via case-insensitive name join', () => {
    const d = aggregateDashboard(
      [
        { name: 'FM4', count: 100 },
        { name: 'BAYERN 1', count: 50 }, // wrong case — should still join
        { name: 'Bayern 2', count: 30 },
      ],
      [],
      catalog,
    );
    expect(d.byStationCountry.get('AT')).toBe(100);
    expect(d.byStationCountry.get('DE')).toBe(80);
  });

  it('skips items whose station has no country', () => {
    const d = aggregateDashboard(
      [
        { name: 'FM4', count: 100 },
        { name: 'Foo Radio', count: 200 }, // no country in catalog
      ],
      [],
      catalog,
    );
    expect(d.byStationCountry.size).toBe(1);
    expect(d.byStationCountry.get('AT')).toBe(100);
  });

  it('skips items whose station is not in the catalog', () => {
    const d = aggregateDashboard(
      [
        { name: 'FM4', count: 100 },
        { name: 'Mystery Station 9000', count: 999 },
      ],
      [],
      catalog,
    );
    expect(d.totalStations).toBe(2); // counted as a play
    expect(d.totalPlays).toBe(1099);
    // …but didn't contribute to any country bucket.
    expect(d.byStationCountry.get('AT')).toBe(100);
  });

  it('groups listener-country counts (case-normalized)', () => {
    const d = aggregateDashboard(
      [],
      [
        { code: 'CH', name: 'Switzerland', count: 50 },
        { code: 'ch', name: 'Switzerland', count: 25 }, // duplicate, lowercase
        { code: 'DE', name: 'Germany', count: 100 },
      ],
      catalog,
    );
    expect(d.byListenerCountry.get('CH')).toBe(75);
    expect(d.byListenerCountry.get('DE')).toBe(100);
  });

  it('skips locations with empty code', () => {
    const d = aggregateDashboard(
      [],
      [
        { code: '', name: 'Unknown', count: 100 },
        { code: 'CH', name: 'Switzerland', count: 25 },
      ],
      catalog,
    );
    expect(d.byListenerCountry.size).toBe(1);
    expect(d.byListenerCountry.get('CH')).toBe(25);
  });

  it('handles empty inputs', () => {
    const d = aggregateDashboard([], [], catalog);
    expect(d.totalPlays).toBe(0);
    expect(d.totalStations).toBe(0);
    expect(d.byStationCountry.size).toBe(0);
    expect(d.byListenerCountry.size).toBe(0);
  });

  it('prefers worker-supplied playsTotal over summed items', () => {
    // The worker computes total across ALL play: events; items are
    // capped at the public limit. When passed, totalPlays should
    // reflect the authoritative number, not the items sum.
    const d = aggregateDashboard(
      [
        { name: 'FM4', count: 100 },
        { name: 'Bayern 1', count: 80 },
      ],
      [],
      catalog,
      500, // ← authoritative total includes plays not in the top-N
    );
    expect(d.totalPlays).toBe(500);
    expect(d.totalStations).toBe(2); // station count still from items
  });
});

describe('aggregateDashboard — per-country daily series', () => {
  it('sums series across stations whose origin country matches', () => {
    // FM4 (AT) + Bayern 1 (DE) + Bayern 2 (DE). Days arg is the
    // canonical day index from the worker; series length matches it.
    const d = aggregateDashboard(
      [
        { name: 'FM4', count: 30, series: [10, 5, 0, 15] },
        { name: 'Bayern 1', count: 20, series: [4, 4, 4, 8] },
        { name: 'Bayern 2', count: 10, series: [2, 2, 2, 4] },
      ],
      [],
      catalog,
      undefined,
      ['2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15'],
    );
    expect(d.byStationCountrySeries.get('AT')).toEqual([10, 5, 0, 15]);
    expect(d.byStationCountrySeries.get('DE')).toEqual([6, 6, 6, 12]);
    expect(d.days).toEqual(['2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15']);
  });

  it('omits series rollup when items carry no series', () => {
    // Older worker builds didn't emit `series`; aggregator should
    // still produce a valid DashboardData with an empty series map.
    const d = aggregateDashboard(
      [
        { name: 'FM4', count: 10 },
        { name: 'Bayern 1', count: 5 },
      ],
      [],
      catalog,
    );
    expect(d.byStationCountrySeries.size).toBe(0);
    expect(d.days).toEqual([]);
  });

  it('skips an item whose series length disagrees with the window', () => {
    // Defensive: if one item somehow has a shorter/longer series than
    // the rest, we drop just that contribution rather than corrupt the
    // per-country sum.
    const d = aggregateDashboard(
      [
        { name: 'FM4', count: 10, series: [10] },
        { name: 'Bayern 1', count: 5, series: [1, 1, 1] }, // wrong length
      ],
      [],
      catalog,
      undefined,
      ['d1'],
    );
    expect(d.byStationCountrySeries.get('AT')).toEqual([10]);
    expect(d.byStationCountrySeries.get('DE')).toBeUndefined();
  });
});

describe('activeCountryMap', () => {
  const d: DashboardData = {
    totalPlays: 0,
    totalStations: 0,
    byListenerCountry: new Map([['CH', 100]]),
    byStationCountry: new Map([['DE', 50]]),
    byStationCountrySeries: new Map(),
    days: [],
  };

  it('returns listener map when view is "listeners"', () => {
    expect(activeCountryMap(d, 'listeners').get('CH')).toBe(100);
  });

  it('returns station map when view is "stations"', () => {
    expect(activeCountryMap(d, 'stations').get('DE')).toBe(50);
  });
});
