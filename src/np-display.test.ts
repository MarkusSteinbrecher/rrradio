import { describe, expect, it } from 'vitest';
import { displayStation, isWakeBedActive, SILENT_BED_ID } from './np-display';
import type { NowPlaying, Station, WakeTo } from './types';

const station: Station = {
  id: 'fm4',
  name: 'FM4',
  streamUrl: 'https://example.com/fm4',
  bitrate: 192,
  codec: 'AAC',
};

const silentBed: Station = {
  id: SILENT_BED_ID,
  name: 'Silent bed',
  streamUrl: '/silence.m4a',
};

const wake: WakeTo = {
  time: '07:30',
  stationId: 'fm4',
  station,
  armedAt: 1_700_000_000_000,
};

describe('displayStation', () => {
  it('returns np.station when not in silent-bed mode', () => {
    const np: NowPlaying = { station, state: 'playing' };
    expect(displayStation(np, null)).toBe(np.station);
  });

  it('returns np.station when on silent bed but no wake armed', () => {
    const np: NowPlaying = { station: silentBed, state: 'playing' };
    expect(displayStation(np, null)).toBe(silentBed);
  });

  it('substitutes the armed station + "Wake up at HH:MM" name when on silent bed', () => {
    const np: NowPlaying = { station: silentBed, state: 'playing' };
    const result = displayStation(np, wake);
    expect(result.id).toBe('fm4');
    expect(result.name).toBe('Wake up at 07:30');
    expect(result.bitrate).toBe(192); // other fields preserved from armed station
  });
});

describe('isWakeBedActive', () => {
  it('false when no wake armed', () => {
    const np: NowPlaying = { station: silentBed, state: 'playing' };
    expect(isWakeBedActive(np, null)).toBe(false);
  });

  it('false when not on silent bed even with wake armed', () => {
    const np: NowPlaying = { station, state: 'playing' };
    expect(isWakeBedActive(np, wake)).toBe(false);
  });

  it('true on silent bed + wake armed', () => {
    const np: NowPlaying = { station: silentBed, state: 'playing' };
    expect(isWakeBedActive(np, wake)).toBe(true);
  });
});
