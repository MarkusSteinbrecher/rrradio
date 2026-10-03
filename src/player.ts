import Hls from 'hls.js';
import {
  MAX_RETRY_ATTEMPTS,
  hasStreamVariants,
  playbackPlan,
  retryDelayMs,
  type PlanEntry,
  type QualityPref,
} from './stream-select';
import type { NowPlaying, PlayerState, Station, StreamRetry, StreamVariant } from './types';

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
 * `audio.play()` returns a promise the browser may reject for two
 * benign reasons we treat as "paused, not broken":
 *   - NotAllowedError: autoplay blocked because there was no user
 *     gesture yet (SPA auto-load after a /station/<id>/ refresh).
 *   - AbortError: the user (or app) called pause() / load() / a new
 *     src assignment before the play() promise resolved. The pause
 *     button hit before the stream is actually playing trips this.
 *
 * Anything else is a real load failure and surfaces as state: 'error'.
 */
function isPlayCancellation(err: DOMException): boolean {
  return err.name === 'NotAllowedError' || err.name === 'AbortError';
}

/**
 * Wraps a single HTMLAudioElement with:
 *  - HLS support via hls.js (where native HLS is unavailable)
 *  - Media Session API (lock-screen + Bluetooth controls on mobile)
 *  - A simple state machine + subscribe() for UI updates
 *
 * Reconnection follows the Stream-retry policy in
 * docs/spec/contracts/playback-state-machine.md: a failed / stalled
 * stream is rebuilt with 1s/2s/4s backoff, and once a variant's budget
 * is spent the player advances down the station's variant plan
 * (`streams[]`, ADR 001) before surfacing `error` (#95, #623).
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

  /** Variant-selection + retry-ladder state (see stream-select.ts). */
  private qualityPref: QualityPref = 'best';
  /** Fills in catalog fields (notably `streams[]`) for a station record
   *  that came from storage — favorites / recents saved before variants
   *  shipped carry only `streamUrl`. Identity by default. */
  private hydrate: (s: Station) => Station = (s) => s;
  /** Failures that retrying can't fix (region-locked streams): skip the
   *  ladder and go straight to `error`. */
  private isPermanentFailure: (s: Station) => boolean = () => false;
  private plan: PlanEntry[] = [];
  private planIndex = 0;
  private retryAttempt = 0;
  /** Automatic retry is armed by play() and disarmed by
   *  pause / stop / exhaustion (Stream-retry policy, eligibility). */
  private retryArmed = false;
  private retryTimer: number | undefined;
  private healthyTimer: number | undefined;
  /** True from a failure (or a quality switch) until the rebuilt source
   *  plays — teardown's own `pause` event must not read as a user pause. */
  private rebuilding = false;
  /** Bumped on every source load; a failure is counted once per load
   *  even though the browser reports it twice (error event + rejected
   *  play() promise). */
  private loadSeq = 0;
  private failedSeq = -1;
  private static readonly HEALTHY_RESET_MS = 5 * 60 * 1000;

  /** `audio` is optional so tests can inject a controlled element with
   *  a mocked .play(). In normal use we construct a new HTMLAudioElement. */
  constructor(audio?: HTMLAudioElement) {
    this.audio = audio ?? new Audio();
    this.audio.preload = 'none';
    this.bindAudio(this.audio);
    this.setupMediaSession();
  }

  /** Wire the app-level hooks. main.ts calls this once at boot. */
  configure(opts: {
    qualityPref?: QualityPref;
    hydrate?: (s: Station) => Station;
    isPermanentFailure?: (s: Station) => boolean;
  }): void {
    if (opts.qualityPref) this.qualityPref = opts.qualityPref;
    if (opts.hydrate) this.hydrate = opts.hydrate;
    if (opts.isPermanentFailure) this.isPermanentFailure = opts.isPermanentFailure;
  }

  private bindAudio(el: HTMLAudioElement): void {
    el.addEventListener('playing', () => this.onPlaying());
    el.addEventListener('pause', () => {
      // Ignore the pause event that fires when we tear down the source
      // (station switch, retry rebuild, quality switch).
      if (this.current.state !== 'idle' && !this.rebuilding) this.update({ state: 'paused' });
    });
    el.addEventListener('waiting', () => this.update({ state: 'loading' }));
    el.addEventListener('error', () => this.handleAudioError(el.error));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** Current player state. Read-only — mutations go through play() /
   *  pause() etc. */
  getCurrent(): NowPlaying {
    return this.current;
  }

  async play(station: Station): Promise<void> {
    // Always teardown + reconnect, even if the same station is "paused".
    // Live streams can't actually be resumed from a buffered position, and
    // an HTMLAudioElement that's been paused for a while can silently
    // refuse to deliver audio when .play() is called again — the user
    // sees the play button but hears nothing. Fresh connection every time
    // is the only reliable behaviour for live audio.
    this.teardown();
    return this.playInternal(station, this.current.station.id === station.id);
  }

  /** Translate a media-element error event into the retry ladder. */
  private handleAudioError(err: MediaError | null): void {
    if (err?.code === 3 && this.tryRecoverDecode()) return;
    this.failCurrent(audioErrorMessage(err));
  }

  /** A live HLS stream can hit a one-off MEDIA_ERR_DECODE mid-play (a
   *  bad segment, a splice in the broadcaster's encoder) that a fresh
   *  media pipeline plays straight through — BBC Radio 4 logged ~28/week
   *  of these (#666) on a playlist identical in shape to the BBC stations
   *  that don't. Recover once (hls.js: recoverMediaError, which re-opens
   *  MSE; native: rebuild the current variant) before the error enters
   *  the retry ladder. At most one attempt per station per
   *  DECODE_RETRY_WINDOW_MS, so a truly undecodable stream falls through
   *  to the ladder on the second strike instead of looping. */
  private lastDecodeRecovery = 0;
  private lastDecodeRecoveryStation = '';
  private static readonly DECODE_RETRY_WINDOW_MS = 30_000;

  private tryRecoverDecode(): boolean {
    const station = this.current.station;
    if (!station.id || !this.retryArmed) return false;
    const now = Date.now();
    if (
      station.id === this.lastDecodeRecoveryStation &&
      now - this.lastDecodeRecovery < AudioPlayer.DECODE_RETRY_WINDOW_MS
    ) {
      return false;
    }
    this.lastDecodeRecovery = now;
    this.lastDecodeRecoveryStation = station.id;
    if (this.hls) {
      this.hls.recoverMediaError();
      void this.audio.play().catch(() => undefined);
    } else {
      this.update({ state: 'loading' });
      this.rebuild();
    }
    return true;
  }

  /** Resolve the variant plan for `station` and reset the retry budget. */
  private startPlan(station: Station): void {
    this.cancelRetry();
    this.plan = playbackPlan(station, this.qualityPref);
    this.planIndex = 0;
    this.retryAttempt = 0;
    this.retryArmed = true;
  }

  private async playInternal(
    station: Station,
    sameStation: boolean,
  ): Promise<void> {
    station = this.hydrate(station);
    this.playGeneration += 1;
    this.startPlan(station);
    // Preserve trackTitle + coverUrl when re-playing the same station so
    // the on-air line and cover don't snap to "—" during the loading flash.
    // Reset them when switching stations. Routed through update() so the
    // single state-machine path stamps loadingSince correctly and any
    // pending deferred-exit timer from a previous loading transition is
    // cancelled (see audit #74).
    this.update({
      station,
      state: 'loading',
      trackTitle: sameStation ? this.current.trackTitle : undefined,
      trackName: sameStation ? this.current.trackName : undefined,
      trackArtist: sameStation ? this.current.trackArtist : undefined,
      trackVerified: sameStation ? this.current.trackVerified : undefined,
      coverUrl: sameStation ? this.current.coverUrl : undefined,
      errorMessage: undefined,
      variant: this.plan[0]?.variant,
      retry: undefined,
    });

    await this.loadVariant();
  }

  /** Point the audio element at the current plan entry and play it.
   *  Shared by the first load, retry rebuilds and quality switches. */
  private async loadVariant(): Promise<void> {
    const seq = ++this.loadSeq;
    const station = this.current.station;
    const url = this.plan[this.planIndex]?.url ?? station.streamUrl;
    const isHls = /\.m3u8(\?|$)/i.test(url);

    if (isHls && !this.audio.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
      this.hls = new Hls();
      // hls.js reports fatal network / media errors here, not on the
      // <audio> element — route them into the same retry ladder.
      this.hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || seq !== this.loadSeq) return;
        // A fatal media error (e.g. bufferAppendError) gets the one-shot
        // decode recovery first; anything else goes to the retry ladder.
        const media = data.type === Hls.ErrorTypes.MEDIA_ERROR;
        if (media && this.tryRecoverDecode()) return;
        this.failCurrent(media ? 'Cannot decode stream' : 'Network error', seq);
      });
      this.hls.loadSource(url);
      this.hls.attachMedia(this.audio);
    } else {
      this.audio.src = url;
    }

    try {
      await this.audio.play();
      if (seq !== this.loadSeq) return;
      this.updateMediaSessionMetadata(station);
      this.startWatchdog();
    } catch (err) {
      // A newer load (station switch, retry rebuild) superseded this
      // one; its own play() owns the state now.
      if (seq !== this.loadSeq) return;
      // NotAllowedError: SPA auto-loads a station from the URL on a
      // /station/<id>/ page reload before any user gesture; browser
      // refuses autoplay. AbortError: the user (or app) called pause()
      // before play() resolved — common when tapping the pause button
      // immediately after opening a station, before the stream is
      // actually playing. Both are paused-not-broken outcomes; the
      // stream URL is already set up on the audio element so the
      // user just hits play to resume.
      if (err instanceof DOMException && isPlayCancellation(err)) {
        this.rebuilding = false;
        this.update({ state: 'paused', errorMessage: undefined, retry: undefined });
        return;
      }
      this.failCurrent(String(err), seq);
    }
  }

  /** A load failed or stalled. Walk the retry ladder: back off and
   *  rebuild the same variant up to MAX_RETRY_ATTEMPTS times, then
   *  advance to the next variant in the plan, and only surface `error`
   *  once the last variant is spent. Counted once per load (`seq`). */
  private failCurrent(message: string, seq: number = this.loadSeq): void {
    if (seq !== this.loadSeq || seq === this.failedSeq) return;
    this.failedSeq = seq;
    this.stopWatchdog();
    this.clearHealthyTimer();
    const station = this.current.station;
    if (!station.id || !this.retryArmed || this.isPermanentFailure(station)) {
      this.giveUp(message);
      return;
    }
    this.retryAttempt += 1;
    if (this.retryAttempt > MAX_RETRY_ATTEMPTS) {
      if (this.planIndex + 1 >= this.plan.length) {
        this.giveUp(message);
        return;
      }
      // This variant's budget is spent — fall back to the next one now.
      this.planIndex += 1;
      this.retryAttempt = 0;
      this.rebuilding = true;
      this.update({
        state: 'loading',
        variant: this.plan[this.planIndex].variant,
        retry: this.retryInfo(),
      });
      this.rebuild();
      return;
    }
    this.rebuilding = true;
    this.update({ state: 'loading', retry: this.retryInfo() });
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      this.rebuild();
    }, retryDelayMs(this.retryAttempt));
  }

  private giveUp(message: string): void {
    this.retryArmed = false;
    this.cancelRetry();
    this.update({ state: 'error', errorMessage: message, retry: undefined });
  }

  private retryInfo(): StreamRetry {
    return {
      attempt: this.retryAttempt,
      maxAttempts: MAX_RETRY_ATTEMPTS,
      planIndex: this.planIndex,
      planLength: this.plan.length,
    };
  }

  /** Tear the source down and load the current plan entry afresh — a
   *  rebuild, not a bare play(), per the Stream-retry policy. */
  private rebuild(): void {
    this.rebuilding = true;
    this.teardownSource();
    void this.loadVariant();
  }

  private onPlaying(): void {
    this.rebuilding = false;
    this.update({ state: 'playing', retry: undefined });
    // Budget reset: after 5 minutes of healthy playback a later hiccup
    // gets a fresh set of attempts.
    this.clearHealthyTimer();
    this.healthyTimer = window.setTimeout(() => {
      this.healthyTimer = undefined;
      this.retryAttempt = 0;
    }, AudioPlayer.HEALTHY_RESET_MS);
  }

  /** Cancel a pending retry rebuild + the healthy-reset timer. Leaves
   *  the armed flag alone (play() re-arms, pause()/stop() disarm). */
  private cancelRetry(): void {
    if (this.retryTimer !== undefined) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.clearHealthyTimer();
    this.rebuilding = false;
  }

  private clearHealthyTimer(): void {
    if (this.healthyTimer !== undefined) {
      window.clearTimeout(this.healthyTimer);
      this.healthyTimer = undefined;
    }
  }

  /** Change the global best / data preference. Re-plays the current
   *  station on the newly chosen variant when it is playing or loading
   *  and the start variant actually differs; otherwise the next play()
   *  picks it up. */
  setQualityPref(pref: QualityPref): void {
    if (pref === this.qualityPref) return;
    this.qualityPref = pref;
    const station = this.current.station;
    if (!station.id || !hasStreamVariants(station)) return;
    const prevUrl = this.plan[this.planIndex]?.url;
    this.plan = playbackPlan(station, pref);
    this.planIndex = 0;
    const next = this.plan[0];
    if (next.url === prevUrl) return;
    if (this.current.state === 'playing' || this.current.state === 'loading') {
      this.cancelRetry();
      this.retryAttempt = 0;
      this.update({ state: 'loading', variant: next.variant, retry: undefined });
      this.rebuild();
    } else {
      this.update({ variant: next.variant });
    }
  }

  getQualityPref(): QualityPref {
    return this.qualityPref;
  }

  /** The variant currently loaded: its URL, position in the playback
   *  plan, and catalog record (absent for a single-stream station). */
  currentVariant(): { url: string; planIndex: number; variant?: StreamVariant } | null {
    const entry = this.plan[this.planIndex];
    if (!entry) return null;
    return { url: entry.url, planIndex: this.planIndex, variant: entry.variant };
  }

  pause(): void {
    const wasRebuilding = this.rebuilding;
    this.retryArmed = false;
    this.cancelRetry();
    this.audio.pause();
    this.stopWatchdog();
    // Paused mid-retry: the element may already be paused (no event), so
    // set the state explicitly.
    if (wasRebuilding) this.update({ state: 'paused', retry: undefined });
  }

  /** Stop playback completely and reset to idle. Tears down the audio
   *  source and clears the current-station record so the next caller
   *  starts from a clean slate. */
  stop(): void {
    this.retryArmed = false;
    this.teardown();
    this.plan = [];
    this.update({
      station: { id: '', name: '', streamUrl: '' },
      state: 'idle',
      trackTitle: undefined,
      trackVerified: undefined,
      coverUrl: undefined,
      errorMessage: undefined,
      variant: undefined,
      retry: undefined,
    });
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

  /** 0..1, clamped. iOS ignores this (audio.volume is read-only there)
   *  but Android + desktop honor it. */
  setVolume(v: number): void {
    this.audio.volume = Math.max(0, Math.min(1, v));
  }

  getVolume(): number {
    return this.audio.volume;
  }

  private teardown(): void {
    this.cancelRetry();
    this.teardownSource();
  }

  /** Release the current source (hls instance + element src) without
   *  touching retry bookkeeping — used by teardown() and rebuild(). */
  private teardownSource(): void {
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
      // error. Hand it to the retry ladder, which rebuilds the source.
      this.stallTicks = 0;
      this.failCurrent('Stream stalled');
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
      /** Set by main.ts after iTunes Search confirms the title
       *  resolves to a real song. `undefined` while the lookup is
       *  in-flight (or skipped); render-np uses === true so undefined
       *  hides the music-service links until verification arrives. */
      trackVerified?: boolean;
    },
  ): void {
    this.update({
      trackTitle,
      trackName: parts?.track,
      trackArtist: parts?.artist,
      coverUrl: parts?.coverUrl,
      trackVerified: parts?.trackVerified,
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
