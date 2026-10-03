/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SleepFade } from './sleepFade';

function setup(initial = 0.8, durationMs = 20_000) {
  let volume = initial;
  const stop = vi.fn();
  const fade = new SleepFade(
    {
      getVolume: () => volume,
      setVolume: (v) => {
        volume = v;
      },
      stop,
    },
    durationMs,
  );
  return { fade, stop, vol: () => volume };
}

describe('SleepFade', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ramps the volume down, stops at the end, then restores the volume', () => {
    const { fade, stop, vol } = setup(0.8);
    fade.start();
    expect(fade.active).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(vol()).toBeGreaterThan(0.3);
    expect(vol()).toBeLessThan(0.5);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(vol()).toBe(0.8);
    expect(fade.active).toBe(false);
    // Nothing keeps ticking after the stop.
    vi.advanceTimersByTime(30_000);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(vol()).toBe(0.8);
  });

  it('volume is at (or near) zero right before the stop', () => {
    const { fade, stop, vol } = setup(1);
    let atStop = -1;
    stop.mockImplementation(() => {
      atStop = vol();
    });
    fade.start();
    vi.advanceTimersByTime(20_000);
    expect(atStop).toBeGreaterThanOrEqual(0);
    expect(atStop).toBeLessThan(0.02);
  });

  it('cancel aborts the fade, restores the volume and never stops', () => {
    const { fade, stop, vol } = setup(0.6);
    fade.start();
    vi.advanceTimersByTime(12_000);
    expect(vol()).toBeLessThan(0.6);
    fade.cancel();
    expect(vol()).toBe(0.6);
    expect(fade.active).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(stop).not.toHaveBeenCalled();
    expect(vol()).toBe(0.6);
  });

  it('cancel when idle is a no-op', () => {
    const { fade, stop, vol } = setup(0.5);
    fade.cancel();
    expect(vol()).toBe(0.5);
    expect(stop).not.toHaveBeenCalled();
  });

  it('stops on time even when the ramp never ticks (hidden tab, rAF paused)', () => {
    const { fade, stop, vol } = setup(0.7);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0);
    fade.start();
    vi.advanceTimersByTime(20_000);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(vol()).toBe(0.7);
  });

  it('restarting mid-fade restores first, so the new fade starts from the original volume', () => {
    const { fade, stop, vol } = setup(0.9);
    fade.start();
    vi.advanceTimersByTime(15_000);
    fade.start();
    vi.advanceTimersByTime(20_000);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(vol()).toBe(0.9);
  });
});
