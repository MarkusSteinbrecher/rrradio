/** Web / iOS split of the play events for the public stats sheet. */
import { describe, expect, it } from 'vitest';
import { isNativePlatform, platformPlayPrefix, platformSplit } from './platforms';

const days = ['2026-11-25', '2026-11-26', '2026-11-27'];
const hit = (path: string, perDay: number[]) => ({
  path,
  count: perDay.reduce((a, b) => a + b, 0),
  stats: perDay.map((daily, i) => ({ day: days[i], daily })).filter((s) => s.daily > 0),
});

describe('platformSplit', () => {
  it('splits totals, days and stations into all and iOS', () => {
    const split = platformSplit(
      [
        hit('play: FM4', [2, 3, 1]),
        hit('play-ios: FM4', [1, 0, 1]),
        hit('play: FIP', [0, 4, 0]),
        hit('play-ios: Radio 538', [0, 0, 2]),
        hit('play: Radio 538', [0, 0, 2]),
        hit('favorite: FM4', [5, 5, 5]),
        hit('/', [9, 9, 9]),
      ],
      days,
    );
    expect(split.totals).toEqual({ all: 12, ios: 4 });
    expect(split.distinct).toEqual({ all: 3, ios: 2, web: 2 });
    expect(split.plays_per_day).toEqual({ all: [2, 7, 3], ios: [1, 0, 3] });
    expect(split.stations).toEqual([
      { name: 'FM4', count: 6, ios: 2, series: [2, 3, 1], ios_series: [1, 0, 1] },
      { name: 'FIP', count: 4, ios: 0, series: [0, 4, 0], ios_series: [0, 0, 0] },
      { name: 'Radio 538', count: 2, ios: 2, series: [0, 0, 2], ios_series: [0, 0, 2] },
    ]);
  });

  it('never reports more iOS plays than plays', () => {
    const split = platformSplit([hit('play: FM4', [1, 0, 0]), hit('play-ios: FM4', [1, 2, 0])], days);
    expect(split.stations[0]).toMatchObject({ count: 3, ios: 3, series: [1, 2, 0] });
    expect(split.totals).toEqual({ all: 3, ios: 3 });
    expect(split.distinct.web).toBe(0);
  });

  it('keeps a station that only ranks on one side', () => {
    const hits = [
      ...Array.from({ length: 4 }, (_, i) => hit(`play: Web ${i}`, [10 - i, 0, 0])),
      hit('play: Small', [1, 0, 0]),
      hit('play-ios: Small', [1, 0, 0]),
    ];
    const names = platformSplit(hits, days, 2).stations.map((s) => s.name);
    expect(names).toEqual(['Web 0', 'Web 1', 'Small']);
  });

  it('is empty without play events', () => {
    const split = platformSplit([hit('/', [1, 1, 1])], days);
    expect(split.totals).toEqual({ all: 0, ios: 0 });
    expect(split.stations).toEqual([]);
    expect(split.plays_per_day).toEqual({ all: [0, 0, 0], ios: [0, 0, 0] });
  });
});

describe('native platforms', () => {
  it('knows iOS only, and its prefix is not the combined one', () => {
    expect(isNativePlatform('ios')).toBe(true);
    expect(isNativePlatform('android')).toBe(false);
    expect(isNativePlatform('unknown')).toBe(false);
    expect(platformPlayPrefix('ios')).toBe('play-ios: ');
    expect('play-ios: FM4'.startsWith('play: ')).toBe(false);
  });
});
