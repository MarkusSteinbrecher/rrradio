import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fadeVolume } from './fade';

// Drive requestAnimationFrame by hand so the fade is deterministic.
let now = 0;
let queued: FrameRequestCallback[] = [];

function frame(atMs: number): void {
  now = atMs;
  const cbs = queued;
  queued = [];
  for (const cb of cbs) cb(now);
}

beforeEach(() => {
  now = 0;
  queued = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    queued = [];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fadeVolume', () => {
  it('interpolates linearly from → to over the duration', () => {
    const seen: number[] = [];
    fadeVolume((v) => seen.push(v), 1, 0, 1000);
    frame(0);
    frame(250);
    frame(500);
    frame(1000);
    expect(seen).toEqual([1, 0.75, 0.5, 0]);
  });

  it('stops scheduling frames once it reaches the target', () => {
    const seen: number[] = [];
    fadeVolume((v) => seen.push(v), 0, 1, 100);
    frame(200);
    expect(seen).toEqual([1]);
    expect(queued).toHaveLength(0);
  });

  it('cancel stops further volume updates', () => {
    const seen: number[] = [];
    const cancel = fadeVolume((v) => seen.push(v), 0, 1, 1000);
    frame(500);
    cancel();
    frame(1000);
    expect(seen).toEqual([0.5]);
  });
});
