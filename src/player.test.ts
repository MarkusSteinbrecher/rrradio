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

  it("treats AbortError as paused, not error (user paused before play() resolved)", async () => {
    // Per HTML spec, audio.play() rejects with AbortError when pause()
    // / load() / a new src is set before the play() promise resolves.
    // That's a legitimate user action (the pause button tapped while
    // the stream is still buffering), not a load failure — it must
    // not surface as state: 'error' or emit an analytics error event.
    const audio = makeAudio();
    vi.spyOn(audio, 'play').mockRejectedValue(
      new DOMException('The play() request was interrupted by a call to pause()', 'AbortError'),
    );
    const player = new AudioPlayer(audio);
    const states = recordStates(player);

    await player.play(A);
    vi.advanceTimersByTime(700);

    expect(states.at(-1)).toMatchObject({ station: A, state: 'paused' });
    expect(states.some((s) => s.state === 'error')).toBe(false);
  });
});

describe('AudioPlayer retry ladder + stream variants (#95, #623)', () => {
  const V: Station = {
    id: 'v',
    name: 'Variant FM',
    streamUrl: 'https://example.com/v-192',
    streams: [
      { url: 'https://example.com/v-192', bitrate: 192, codec: 'MP3', tier: 'best' },
      { url: 'https://example.com/v-128', bitrate: 128, codec: 'MP3', tier: 'data' },
    ],
  };

  /** Fail the current load: the error event, then flush the microtasks
   *  so any rebuild's play() promise settles. */
  async function fail(audio: HTMLAudioElement): Promise<void> {
    audio.dispatchEvent(new Event('error'));
    await Promise.resolve();
  }

  /** Spend one variant's whole budget: initial failure + 3 retries. */
  async function exhaustVariant(audio: HTMLAudioElement): Promise<void> {
    for (const delay of [1000, 2000, 4000]) {
      await fail(audio);
      await vi.advanceTimersByTimeAsync(delay);
    }
    await fail(audio);
  }

  it('single-stream: retries with 1s/2s/4s backoff, then surfaces error', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);
    await player.play(A);
    const playSpy = vi.mocked(audio.play);
    expect(playSpy).toHaveBeenCalledTimes(1);

    await fail(audio);
    expect(states.at(-1)).toMatchObject({
      state: 'loading',
      retry: { attempt: 1, maxAttempts: 3, planIndex: 0, planLength: 1 },
    });
    // Nothing rebuilds before the backoff elapses.
    await vi.advanceTimersByTimeAsync(999);
    expect(playSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(audio.src).toBe('https://example.com/a');

    await fail(audio);
    expect(states.at(-1)?.retry?.attempt).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    await fail(audio);
    expect(states.at(-1)?.retry?.attempt).toBe(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(playSpy).toHaveBeenCalledTimes(4);

    await fail(audio);
    await vi.advanceTimersByTimeAsync(700);
    expect(states.at(-1)).toMatchObject({ state: 'error', errorMessage: 'Stream error' });
    expect(states.at(-1)?.retry).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(playSpy).toHaveBeenCalledTimes(4);
  });

  it('advances to the next variant once the first is spent, then plays on it', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);
    await player.play(V);
    expect(audio.src).toBe('https://example.com/v-192');
    expect(states.at(-1)?.variant?.bitrate).toBe(192);

    await exhaustVariant(audio);
    expect(audio.src).toBe('https://example.com/v-128');
    expect(states.at(-1)).toMatchObject({
      state: 'loading',
      variant: { bitrate: 128 },
      retry: { attempt: 0, planIndex: 1, planLength: 2 },
    });

    audio.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(700);
    expect(states.at(-1)).toMatchObject({
      station: { id: 'v' },
      state: 'playing',
      variant: { bitrate: 128 },
    });
    expect(states.at(-1)?.retry).toBeUndefined();
    expect(player.currentVariant()).toMatchObject({
      url: 'https://example.com/v-128',
      planIndex: 1,
    });
  });

  it('surfaces error only after the last variant is spent', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);
    await player.play(V);
    await exhaustVariant(audio);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.state).toBe('loading');
    await exhaustVariant(audio);
    await vi.advanceTimersByTimeAsync(700);
    expect(states.at(-1)?.state).toBe('error');
  });

  it('counts the error event + rejected play() of one load as a single failure', async () => {
    const audio = makeAudio();
    vi.mocked(audio.play).mockRejectedValueOnce(
      new DOMException('no source', 'NotSupportedError'),
    );
    const player = new AudioPlayer(audio);
    const states = recordStates(player);
    const pending = player.play(A);
    audio.dispatchEvent(new Event('error'));
    await pending;
    expect(states.at(-1)?.retry?.attempt).toBe(1);
  });

  it('pause during a backoff cancels the pending rebuild', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);
    await player.play(A);
    await fail(audio);
    player.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.mocked(audio.play)).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ state: 'paused' });
    expect(states.at(-1)?.retry).toBeUndefined();
  });

  it('a permanent (region-locked) failure skips the ladder', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    player.configure({ isPermanentFailure: () => true });
    const states = recordStates(player);
    await player.play(A);
    await fail(audio);
    await vi.advanceTimersByTimeAsync(700);
    expect(states.at(-1)?.state).toBe('error');
    expect(vi.mocked(audio.play)).toHaveBeenCalledTimes(1);
  });

  it('a stalled stream goes through the ladder instead of reconnecting forever', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);
    await player.play(A);
    audio.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(700);
    // currentTime never advances → watchdog trips after 4 ticks × 2s.
    await vi.advanceTimersByTimeAsync(8000);
    expect(states.at(-1)).toMatchObject({ state: 'loading', retry: { attempt: 1 } });
  });

  it('data preference starts on the data variant', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    player.configure({ qualityPref: 'data' });
    await player.play(V);
    expect(audio.src).toBe('https://example.com/v-128');
    expect(player.getCurrent().variant?.tier).toBe('data');
  });

  it('hydrate() fills streams for a stored station copy', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    player.configure({ qualityPref: 'data', hydrate: (s) => (s.id === 'v' ? V : s) });
    await player.play({ id: 'v', name: 'Variant FM', streamUrl: 'https://example.com/v-192' });
    expect(audio.src).toBe('https://example.com/v-128');
  });

  it('changing the preference while playing re-plays on the new variant, keeping metadata', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    const states = recordStates(player);
    await player.play(V);
    audio.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(700);
    player.setTrackTitle('Artist — Song');

    player.setQualityPref('data');
    expect(audio.src).toBe('https://example.com/v-128');
    expect(states.at(-1)).toMatchObject({
      state: 'loading',
      trackTitle: 'Artist — Song',
      variant: { tier: 'data' },
    });
    expect(vi.mocked(audio.play)).toHaveBeenCalledTimes(2);
  });

  it('changing the preference on a single-stream station is a no-op', async () => {
    const audio = makeAudio();
    const player = new AudioPlayer(audio);
    await player.play(A);
    player.setQualityPref('data');
    expect(vi.mocked(audio.play)).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe('https://example.com/a');
  });
});
