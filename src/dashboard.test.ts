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
});

describe('activeCountryMap', () => {
  const d: DashboardData = {
    totalPlays: 0,
    totalStations: 0,
    byListenerCountry: new Map([['CH', 100]]),
    byStationCountry: new Map([['DE', 50]]),
  };

  it('returns listener map when view is "listeners"', () => {
    expect(activeCountryMap(d, 'listeners').get('CH')).toBe(100);
  });

  it('returns station map when view is "stations"', () => {
    expect(activeCountryMap(d, 'stations').get('DE')).toBe(50);
  });
});
