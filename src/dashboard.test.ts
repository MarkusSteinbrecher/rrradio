import { describe, expect, it } from 'vitest';
import { aggregateDashboard } from './dashboard';

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
