import Hls from 'hls.js';
import type { NowPlaying, PlayerState, Station } from './types';

type Listener = (state: NowPlaying) => void;

/**
 * MediaError code → user-facing label. Code 4 (SRC_NOT_SUPPORTED) is what
 * the browser raises both for genuinely unplayable formats AND for stations
 * sitting behind expired / signed / authenticated URLs (Apple Music,
 * Spotify, Tidal — anything where the access token rotates per session).
 * In practice, RB entries that fire this on otherwise-modern browsers are
 * almost always the second case, so we surface that explicitly.
 */
function audioErrorMessage(err: MediaError | null): string {
  if (!err) return 'Stream error';
  switch (err.code) {
    case 1: return 'Playback aborted';
    case 2: return 'Network error';
    case 3: return 'Cannot decode stream';
    case 4: return 'Not a public stream';
    default: return 'Stream error';
  }
}

/**
 * Wraps a single HTMLAudioElement with:
 *  - HLS support via hls.js (where native HLS is unavailable)
 *  - Media Session API (lock-screen + Bluetooth controls on mobile)
 *  - A simple state machine + subscribe() for UI updates
 *
 * Reconnection is intentionally minimal here — Phase 1 just surfaces errors.
 * Phase 4 should add exponential-backoff reconnect on `error`/`stalled`.
 */
export class AudioPlayer {
  private audio: HTMLAudioElement;
  private hls: Hls | null = null;
  private listeners = new Set<Listener>();
  private current: NowPlaying = {
    station: { id: '', name: '', streamUrl: '' },
    state: 'idle',
  };
  /** When the loading state began. Used to keep the loading UI visible
   *  for at least MIN_LOADING_MS so the bouncing-dots animation has
   *  time to register on fast streams. */
  private loadingSince = 0;
  private pendingLoadingExit: number | undefined;
  /** Increments on every `play()` so a stale deferred-loading-exit timer
   *  scheduled for an earlier station can detect that it's no longer
   *  current and bail. Belt-and-suspenders against the race the audit
   *  caught in #74 — `update()` already cancels the pending timer when
   *  re-entering loading, so the generation check only matters if a
   *  timer somehow slips through (hostile race, sync-throw teardown). */
  private playGeneration = 0;
  private static readonly MIN_LOADING_MS = 600;

  /** `audio` is optional so tests can inject a controlled element with
   *  a mocked .play(). In normal use we construct a new HTMLAudioElement. */
  constructor(audio?: HTMLAudioElement) {
    this.audio = audio ?? new Audio();
    this.audio.preload = 'none';

    this.audio.addEventListener('playing', () => this.update({ state: 'playing' }));
    this.audio.addEventListener('pause', () => {
      // Ignore the pause event that fires when we tear down the source
      if (this.current.state !== 'idle') this.update({ state: 'paused' });
    });
    this.audio.addEventListener('waiting', () => this.update({ state: 'loading' }));
    this.audio.addEventListener('error', () => {
      this.update({ state: 'error', errorMessage: audioErrorMessage(this.audio.error) });
    });

    this.setupMediaSession();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  async play(station: Station, options?: { loop?: boolean }): Promise<void> {
    // Always teardown + reconnect, even if the same station is "paused".
    // Live streams can't actually be resumed from a buffered position, and
    // an HTMLAudioElement that's been paused for a while can silently
    // refuse to deliver audio when .play() is called again — the user
    // sees the play button but hears nothing. Fresh connection every time
    // is the only reliable behaviour for live audio.
    this.teardown();
    return this.playInternal(station, { loop: !!options?.loop, sameStation: this.current.station.id === station.id });
  }

  /** Switch the underlying <audio> source to a new station WITHOUT
   *  the full teardown→load cycle. Used by the wake-to-radio fire
   *  handler to swap from the silent bed to the wake station while
   *  the audio session — kept alive overnight by the looping silent
   *  bed — stays continuously active.
   *
   *  iOS Safari (and Chrome on iOS, which is WebKit) treats
   *  `audio.removeAttribute('src') + audio.load()` as ending the
   *  current media-playback session. The next `audio.play()` is
   *  then a fresh autoplay attempt — gesture-required and silently
   *  rejected with NotAllowedError. swap() avoids that reset so the
   *  swap stays inside the same active session. */
  async swap(station: Station): Promise<void> {
    // Keep the audio element alive — only do the bookkeeping that
    // teardown() does *around* the audio reset.
    this.stopWatchdog();
    if (this.pendingLoadingExit !== undefined) {
      window.clearTimeout(this.pendingLoadingExit);
      this.pendingLoadingExit = undefined;
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    return this.playInternal(station, { loop: false, sameStation: false });
  }

  private async playInternal(
    station: Station,
    opts: { loop: boolean; sameStation: boolean },
  ): Promise<void> {
    this.playGeneration += 1;
    // Preserve trackTitle + coverUrl when re-playing the same station so
    // the on-air line and cover don't snap to "—" during the loading flash.
    // Reset them when switching stations. Routed through update() so the
    // single state-machine path stamps loadingSince correctly and any
    // pending deferred-exit timer from a previous loading transition is
    // cancelled (see audit #74).
    this.update({
      station,
      state: 'loading',
      trackTitle: opts.sameStation ? this.current.trackTitle : undefined,
      coverUrl: opts.sameStation ? this.current.coverUrl : undefined,
      errorMessage: undefined,
    });

    const url = station.streamUrl;
    const isHls = /\.m3u8(\?|$)/i.test(url);

    // loop is used by the wake-to silent bed so the same short audio
    // clip seamlessly cycles through the night, keeping the iOS audio
    // session alive without a streaming server. Live stations always
    // play unlooped.
    this.audio.loop = opts.loop;

    if (isHls && !this.audio.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
      this.hls = new Hls();
      this.hls.loadSource(url);
      this.hls.attachMedia(this.audio);
    } else {
      this.audio.src = url;
    }

    try {
      await this.audio.play();
      this.updateMediaSessionMetadata(station);
      this.startWatchdog();
    } catch (err) {
      // Browsers reject audio.play() with NotAllowedError when no user
      // gesture preceded the call — typical when the SPA auto-loads a
      // station from the URL on a /station/<id>/ page reload. Surface
      // it as paused (not error) so the user just hits the play button
      // to resume; the stream URL is already set up on the audio element.
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        this.update({ state: 'paused', errorMessage: undefined });
        return;
      }
      this.update({ state: 'error', errorMessage: String(err) });
    }
  }

  pause(): void {
    this.audio.pause();
    this.stopWatchdog();
  }

  toggle(): void {
    if (this.current.state === 'playing') this.pause();
    else if (this.current.station.id) void this.play(this.current.station);
  }

  /** Toggle muted on the underlying <audio>; returns the new state. */
  toggleMute(): boolean {
    this.audio.muted = !this.audio.muted;
    return this.audio.muted;
  }

  isMuted(): boolean {
    return this.audio.muted;
  }

  /** 0..1, clamped. Used by the wake-to fade-up; iOS ignores this
   *  (audio.volume is read-only there) but Android + desktop honor it. */
  setVolume(v: number): void {
    this.audio.volume = Math.max(0, Math.min(1, v));
  }

  getVolume(): number {
    return this.audio.volume;
  }

  private teardown(): void {
    this.stopWatchdog();
    // Drop any deferred-loading-exit timer carried over from the previous
    // session. Belt-and-suspenders: update() also cancels it on the next
    // loading transition, but clearing here guarantees an in-flight
    // timer can't apply a stale patch even if the next update never runs
    // (hostile race / sync-throw mid-play).
    if (this.pendingLoadingExit !== undefined) {
      window.clearTimeout(this.pendingLoadingExit);
      this.pendingLoadingExit = undefined;
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  /**
   * Stall watchdog. Live audio that's "playing" should advance
   * `currentTime` continuously. If it doesn't for ~8 seconds, the
   * stream connection has gone bad without the audio element raising
   * an error event — the symptom is "shows play, hear nothing." We
   * detect that and force a fresh reconnect.
   */
  private watchdogTimer: number | undefined;
  private lastTime = 0;
  private stallTicks = 0;
  private static readonly WATCHDOG_INTERVAL_MS = 2000;
  private static readonly STALL_TICK_THRESHOLD = 4;

  private startWatchdog(): void {
    this.stopWatchdog();
    this.lastTime = this.audio.currentTime;
    this.stallTicks = 0;
    this.watchdogTimer = window.setInterval(() => this.checkStall(), AudioPlayer.WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer !== undefined) {
      window.clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
  }

  private checkStall(): void {
    if (this.current.state !== 'playing') return;
    const now = this.audio.currentTime;
    if (now > this.lastTime) {
      this.lastTime = now;
      this.stallTicks = 0;
      return;
    }
    this.stallTicks += 1;
    if (this.stallTicks >= AudioPlayer.STALL_TICK_THRESHOLD) {
      // Connection is dead but the audio element hasn't fired an
      // error. Reconnect from scratch to recover.
      this.stallTicks = 0;
      const station = this.current.station;
      if (station.id) void this.play(station);
    }
  }

  /**
   * Push a best-effort current-track string from a side-channel
   * metadata reader (ICY, station JSON, etc.). Pass `undefined` to
   * clear. Re-renders subscribers and updates the lock-screen
   * Media Session metadata so iOS / Android show the song.
   */
  setTrackTitle(
    trackTitle: string | undefined,
    parts?: {
      artist?: string;
      track?: string;
      coverUrl?: string;
      programName?: string;
      programSubtitle?: string;
    },
  ): void {
    this.update({
      trackTitle,
      coverUrl: parts?.coverUrl,
      programName: parts?.programName,
      programSubtitle: parts?.programSubtitle,
    });
    this.updateMediaSessionMetadata(this.current.station, parts);
  }

  private update(patch: Partial<NowPlaying>): void {
    const wasLoading = this.current.state === 'loading';
    const targetState = patch.state ?? this.current.state;

    // If we're entering 'loading', stamp when so we can hold it long enough
    // to be visible. If we're leaving 'loading' too soon, defer the exit.
    if (!wasLoading && targetState === 'loading') {
      this.loadingSince = Date.now();
    }
    if (wasLoading && targetState !== 'loading' && patch.state) {
      const elapsed = Date.now() - this.loadingSince;
      if (elapsed < AudioPlayer.MIN_LOADING_MS) {
        if (this.pendingLoadingExit !== undefined) {
          window.clearTimeout(this.pendingLoadingExit);
        }
        // Capture the play-generation at schedule time. If the user
        // switches stations before the timer fires, the new station's
        // play() bumps playGeneration and this stale callback bails
        // out instead of clobbering the new station's state.
        const generationAtSchedule = this.playGeneration;
        this.pendingLoadingExit = window.setTimeout(() => {
          this.pendingLoadingExit = undefined;
          if (generationAtSchedule !== this.playGeneration) return;
          this.update(patch);
        }, AudioPlayer.MIN_LOADING_MS - elapsed);
        return;
      }
    }

    if (this.pendingLoadingExit !== undefined && patch.state === 'loading') {
      // Re-entered loading — cancel any pending exit.
      window.clearTimeout(this.pendingLoadingExit);
      this.pendingLoadingExit = undefined;
    }

    this.current = { ...this.current, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.current);
  }

  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => this.toggle());
    navigator.mediaSession.setActionHandler('pause', () => this.toggle());
    navigator.mediaSession.setActionHandler('stop', () => this.pause());
  }

  /** Wire prev/next handlers so the lock-screen player widget,
   *  Bluetooth headphone skip buttons, AirPods squeezes, and CarPlay
   *  arrows can flip stations without unlocking. The action handlers
   *  are installed lazily so callers can decide which list to skip
   *  through (favorites, recents, ...). */
  setSkipHandlers(next: () => void, prev: () => void): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
  }

  private updateMediaSessionMetadata(
    station: Station,
    parts?: { artist?: string; track?: string; coverUrl?: string },
  ): void {
    if (!('mediaSession' in navigator)) return;
    const title = parts?.track || station.name;
    const artist = parts?.artist || station.name;
    const artwork = parts?.coverUrl
      ? [{ src: parts.coverUrl, sizes: '300x300' }]
      : station.favicon
        ? [{ src: station.favicon, sizes: '512x512' }]
        : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: 'rrradio',
      artwork,
    });
  }
}

export function stateLabel(state: PlayerState): string {
  switch (state) {
    case 'idle':
      return 'Idle';
    case 'loading':
      return 'Loading…';
    case 'playing':
      return 'Playing';
    case 'paused':
      return 'Paused';
    case 'error':
      return 'Error';
  }
}
