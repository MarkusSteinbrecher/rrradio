/**
 * AudioPlayer state-machine tests.
 *
 * These exercise the loading-state race conditions audit #74 caught:
 * a deferred MIN_LOADING_MS exit scheduled for one station could
 * silently apply its patch to the next station if the user switched
 * before the timer fired.
 *
 * Tests run in happy-dom (HTMLAudioElement is provided) with:
 *   - audio.play() stubbed to a resolved promise (no real network),
 *   - Vitest's fake timers so we can advance MIN_LOADING_MS deterministically,
 *   - manual dispatchEvent('playing' / 'pause' / 'waiting' / 'error') to
 *     simulate the audio element's state-change events.
 *
 * The constructor takes an optional HTMLAudioElement so we can pass a
 * test-controlled instance. In production it defaults to `new Audio()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './player';
import type { NowPlaying, Station } from './types';

const A: Station = { id: 'a', name: 'Station A', streamUrl: 'https://example.com/a' };
const B: Station = { id: 'b', name: 'Station B', streamUrl: 'https://example.com/b' };

/** Build an HTMLAudioElement with a stubbed `.play()` so AudioPlayer's
 *  await never reaches a real network. addEventListener / dispatchEvent
 *  come for free from happy-dom. */
function makeAudio(): HTMLAudioElement {
  const audio = new Audio();
  vi.spyOn(audio, 'play').mockResolvedValue();
  return audio;
}

/** Wrap subscribe() so each test can assert the full sequence of states
 *  the player emitted, not just the latest. */
function recordStates(player: AudioPlayer): NowPlaying[] {
  const states: NowPlaying[] = [];
  player.subscribe((s) => {
    states.push(structuredClone(s));
  });
  return states;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AudioPlayer.play', () => {
  it('emits an initial loading state for the new station', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.play(A);

    // First emit is the constructor's initial idle, second is the loading
    // patch from play(). Inspect the most recent.
    expect(states.at(-1)).toMatchObject({
      station: A,
      state: 'loading',
    });
  });

  it("transitions loading → playing when the audio's 'playing' event fires after MIN_LOADING_MS", async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.play(A);
    // Let MIN_LOADING_MS elapse before the playing event arrives.
    vi.advanceTimersByTime(700);
    audio.dispatchEvent(new Event('playing'));

    expect(states.at(-1)).toMatchObject({ station: A, state: 'playing' });
  });

  it("holds the loading state for at least MIN_LOADING_MS even when 'playing' fires fast", async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.play(A);
    // Fire 'playing' at T+100ms — well under the 600ms minimum.
    vi.advanceTimersByTime(100);
    audio.dispatchEvent(new Event('playing'));

    // State should still read 'loading' until the deferred exit runs.
    expect(states.at(-1)?.state).toBe('loading');

    // Advance past the deferred-exit deadline. Now we should see 'playing'.
    vi.advanceTimersByTime(600);
    expect(states.at(-1)?.state).toBe('playing');
  });
});

describe('AudioPlayer race conditions (audit #74)', () => {
  it('a stale deferred-loading-exit cannot apply playing-state to the next station', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    // 1. play A → loading at T+0.
    await player.play(A);
    expect(states.at(-1)).toMatchObject({ station: A, state: 'loading' });

    // 2. 'playing' for A fires fast (T+100ms < MIN_LOADING_MS).
    //    update() defers the exit.
    vi.advanceTimersByTime(100);
    audio.dispatchEvent(new Event('playing'));
    expect(states.at(-1)?.state).toBe('loading');

    // 3. User switches to B while A's deferred exit is still pending.
    await player.play(B);
    expect(states.at(-1)).toMatchObject({ station: B, state: 'loading' });

    // 4. Advance past A's original deferred-exit deadline. The stale
    //    timer must not patch B with 'playing'.
    vi.advanceTimersByTime(2000);
    expect(states.at(-1)).toMatchObject({ station: B, state: 'loading' });

    // 5. B legitimately starts playing — its own playing event applies.
    audio.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(2000);
    expect(states.at(-1)).toMatchObject({ station: B, state: 'playing' });
  });

  it('rapid station switch during loading clears the previous trackTitle / cover', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.play(A);
    player.setTrackTitle('A song', { artist: 'A', track: 'song' });
    expect(states.at(-1)?.trackTitle).toBe('A song');

    await player.play(B);
    // Different station ⇒ trackTitle reset.
    expect(states.at(-1)).toMatchObject({
      station: B,
      state: 'loading',
      trackTitle: undefined,
    });
  });

  it('replaying the same station preserves trackTitle through the loading flash', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.play(A);
    player.setTrackTitle('A song', { artist: 'A', track: 'song' });
    expect(states.at(-1)?.trackTitle).toBe('A song');

    // Re-play the same station (e.g. user hits play after pause).
    await player.play(A);
    // Same station ⇒ trackTitle preserved during the loading state.
    expect(states.at(-1)).toMatchObject({
      station: A,
      state: 'loading',
      trackTitle: 'A song',
    });
  });

  it("teardown clears any in-flight pendingLoadingExit (defense in depth)", async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.play(A);
    vi.advanceTimersByTime(100);
    audio.dispatchEvent(new Event('playing'));

    // Switch to B — teardown runs and should drop the pending timer.
    await player.play(B);

    // Even if some hostile race kept the generation check from running,
    // the timer itself should have been cleared. We can verify
    // indirectly: advancing past A's original deadline produces no
    // additional emits beyond what play(B) already produced.
    const lengthBefore = states.length;
    vi.advanceTimersByTime(2000);
    expect(states.length).toBe(lengthBefore);
  });
});

describe('AudioPlayer error path', () => {
  it("treats NotAllowedError as paused, not error (autoplay-blocked case)", async () => {
    const audio = makeAudio();
    vi.spyOn(audio, 'play').mockRejectedValue(
      new DOMException('autoplay blocked', 'NotAllowedError'),
    );
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.play(A);
    // The deferred loading exit will still apply MIN_LOADING_MS, advance.
    vi.advanceTimersByTime(700);

    expect(states.at(-1)).toMatchObject({ station: A, state: 'paused' });
  });
});

describe('AudioPlayer.swap', () => {
  // The wake-to-radio fire path (src/main.ts onWakeFire) calls
  // player.swap() to move from the silent bed to the wake station.
  // On iOS Safari / Chrome (WebKit), audio.removeAttribute('src') +
  // audio.load() ends the active media-playback session and the
  // next play() gets autoplay-blocked. swap() avoids that — and
  // when a primed sidecar is available, adopts it instead so the
  // gesture-fresh activation token is what's used. See player.ts.

  it('without prime, does not call audio.load() (preserves the iOS session)', async () => {
    const audio = makeAudio();
    const loadSpy = vi.spyOn(audio, 'load');
    const player = new AudioPlayer(audio);

    await player.swap(B);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('does not removeAttribute("src") (only writes the new src)', async () => {
    const audio = makeAudio();
    audio.src = 'https://example.com/silent.m4a';
    const removeSpy = vi.spyOn(audio, 'removeAttribute');
    const player = new AudioPlayer(audio);

    await player.swap(B);
    // The new src should be set; the previous one should not have
    // been explicitly removed via removeAttribute.
    expect(audio.src).toBe('https://example.com/b');
    for (const call of removeSpy.mock.calls) {
      expect(call[0]).not.toBe('src');
    }
  });

  it('emits a loading state for the swap target', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.swap(B);
    expect(states.at(-1)).toMatchObject({ station: B, state: 'loading' });
  });

  it('disables loop on the audio element (silent bed loops; live stations do not)', async () => {
    const audio = makeAudio();
    audio.loop = true; // pretend silent bed is currently looping
    const player = new AudioPlayer(audio);

    await player.swap(B);
    expect(audio.loop).toBe(false);
  });

  it('treats NotAllowedError as paused (same shape as play())', async () => {
    const audio = makeAudio();
    vi.spyOn(audio, 'play').mockRejectedValue(
      new DOMException('autoplay blocked', 'NotAllowedError'),
    );
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.swap(B);
    vi.advanceTimersByTime(700);
    expect(states.at(-1)).toMatchObject({ station: B, state: 'paused' });
  });
});

describe('AudioPlayer.prime + swap (wake handoff)', () => {
  it('prime() registers a sidecar element with the wake station URL', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    await player.prime(B);
    // Internal — exposed via swap() behavior. After prime, swap(B)
    // should use the sidecar (verified by the next test).
    expect((player as unknown as { primedAudio: HTMLAudioElement | null }).primedAudio).not.toBeNull();
    expect((player as unknown as { primedStationId: string | null }).primedStationId).toBe('b');
  });

  it('swap() with a matching prime adopts the sidecar (not the main element)', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    await player.prime(B);
    const sidecarBeforeSwap = (player as unknown as { primedAudio: HTMLAudioElement | null }).primedAudio;
    await player.swap(B);
    // Sidecar reference dropped after adoption.
    expect((player as unknown as { primedAudio: HTMLAudioElement | null }).primedAudio).toBeNull();
    // The new this.audio is the sidecar.
    const audioAfter = (player as unknown as { audio: HTMLAudioElement }).audio;
    expect(audioAfter).toBe(sidecarBeforeSwap);
    expect(audioAfter).not.toBe(audio);
  });

  it('swap() with a mismatched prime falls back to in-place src swap', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    await player.prime(A); // primed for A
    await player.swap(B); // ...but swapping to B
    // The main audio element is still the original — fallback path.
    const audioAfter = (player as unknown as { audio: HTMLAudioElement }).audio;
    expect(audioAfter).toBe(audio);
  });

  it('prime() failure (sidecar.play rejects) drops the prime silently', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    // Stub the global Audio constructor for this test so the sidecar
    // .play() rejects.
    const origAudio = globalThis.Audio;
    globalThis.Audio = class extends origAudio {
      override play() { return Promise.reject(new DOMException('blocked', 'NotAllowedError')); }
    } as typeof Audio;
    try {
      await player.prime(B);
    } finally {
      globalThis.Audio = origAudio;
    }
    expect((player as unknown as { primedAudio: HTMLAudioElement | null }).primedAudio).toBeNull();
  });

  it('two consecutive primes: second replaces first', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    await player.prime(A);
    await player.prime(B);
    expect((player as unknown as { primedStationId: string | null }).primedStationId).toBe('b');
  });
});
