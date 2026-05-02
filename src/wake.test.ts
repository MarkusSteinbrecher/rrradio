import { describe, expect, it } from 'vitest';
import { formatCountdown, nextFireTime } from './wake';
import type { Station, WakeTo } from './types';

/** Build a fixed `now` so tests are deterministic regardless of when they
 *  run. 2026-05-02 (Saturday) at 09:00:00 local time. */
const NOW = new Date(2026, 4, 2, 9, 0, 0).getTime();

const STUB_STATION: Station = {
  id: 'fixture-a',
  name: 'Fixture',
  streamUrl: 'https://example.com/a',
};

/** Helper — fills the WakeTo fields that don't matter for fire-time math
 *  with stable stubs, so the tests stay focused on `time` + `armedAt`. */
function wake(time: string, armedAt: number): WakeTo {
  return { time, armedAt, stationId: STUB_STATION.id, station: STUB_STATION };
}

describe('nextFireTime', () => {
  it('fires later today when the time is in the future and we just armed', () => {
    const fire = nextFireTime(wake('17:30', NOW));
    expect(new Date(fire).toDateString()).toBe(new Date(NOW).toDateString());
    expect(new Date(fire).getHours()).toBe(17);
    expect(new Date(fire).getMinutes()).toBe(30);
  });

  it('rolls to tomorrow when the time has already passed today', () => {
    // Armed at 09:00, time set to 07:30 → tomorrow 07:30
    const fire = nextFireTime(wake('07:30', NOW));
    const fireDate = new Date(fire);
    const today = new Date(NOW);
    expect(fireDate.getDate()).toBe(today.getDate() + 1);
    expect(fireDate.getHours()).toBe(7);
    expect(fireDate.getMinutes()).toBe(30);
  });

  it('rolls to tomorrow when the time exactly matches "now" at arm', () => {
    // Setting wake to right now is interpreted as "tomorrow at this time"
    const fire = nextFireTime(wake('09:00', NOW));
    expect(new Date(fire).getDate()).toBe(new Date(NOW).getDate() + 1);
  });

  it('handles single-digit hours ("8:30")', () => {
    const fire = nextFireTime(wake('8:30', NOW));
    // 08:30 < 09:00, so rolls to tomorrow
    expect(new Date(fire).getDate()).toBe(new Date(NOW).getDate() + 1);
    expect(new Date(fire).getHours()).toBe(8);
    expect(new Date(fire).getMinutes()).toBe(30);
  });

  it('returns NaN for malformed time strings', () => {
    expect(Number.isNaN(nextFireTime(wake('', NOW)))).toBe(true);
    expect(Number.isNaN(nextFireTime(wake('25:00', NOW)))).toBe(true);
    expect(Number.isNaN(nextFireTime(wake('12:60', NOW)))).toBe(true);
    expect(Number.isNaN(nextFireTime(wake('abc', NOW)))).toBe(true);
  });

  it('falls back to current time when armedAt is missing', () => {
    const fire = nextFireTime(
      wake('23:59', 0),
      NOW,
    );
    expect(new Date(fire).toDateString()).toBe(new Date(NOW).toDateString());
    expect(new Date(fire).getHours()).toBe(23);
  });
});

describe('formatCountdown', () => {
  it('says "now" when the deadline has passed', () => {
    expect(formatCountdown(0)).toBe('now');
    expect(formatCountdown(-5000)).toBe('now');
  });

  it('says "soon" for less than a minute', () => {
    expect(formatCountdown(30_000)).toBe('soon');
    expect(formatCountdown(59_999)).toBe('soon');
  });

  it('counts minutes when under an hour', () => {
    expect(formatCountdown(60_000)).toBe('in 1m');
    expect(formatCountdown(4 * 60_000)).toBe('in 4m');
    expect(formatCountdown(59 * 60_000)).toBe('in 59m');
  });

  it('counts hours and minutes for longer waits', () => {
    expect(formatCountdown(60 * 60_000)).toBe('in 1h');
    expect(formatCountdown(8 * 60 * 60_000 + 12 * 60_000)).toBe('in 8h 12m');
  });

  it('drops the minutes suffix when even hours', () => {
    expect(formatCountdown(2 * 60 * 60_000)).toBe('in 2h');
  });
});
