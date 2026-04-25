import Hls from 'hls.js';
import type { NowPlaying, PlayerState, Station } from './types';

type Listener = (state: NowPlaying) => void;

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

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.crossOrigin = 'anonymous';

    this.audio.addEventListener('playing', () => this.update({ state: 'playing' }));
    this.audio.addEventListener('pause', () => {
      // Ignore the pause event that fires when we tear down the source
      if (this.current.state !== 'idle') this.update({ state: 'paused' });
    });
    this.audio.addEventListener('waiting', () => this.update({ state: 'loading' }));
    this.audio.addEventListener('error', () => {
      this.update({ state: 'error', errorMessage: 'Stream error' });
    });

    this.setupMediaSession();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  async play(station: Station): Promise<void> {
    if (this.current.station.id === station.id && this.current.state === 'paused') {
      await this.audio.play();
      return;
    }

    this.teardown();
    this.current = { station, state: 'loading' };
    this.emit();

    const url = station.streamUrl;
    const isHls = /\.m3u8(\?|$)/i.test(url);

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
    } catch (err) {
      this.update({ state: 'error', errorMessage: String(err) });
    }
  }

  pause(): void {
    this.audio.pause();
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

  private teardown(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  /**
   * Push a best-effort current-track string from a side-channel
   * metadata reader (ICY, station JSON, etc.). Pass `undefined` to
   * clear. Re-renders subscribers and updates the lock-screen
   * Media Session metadata so iOS / Android show the song.
   */
  setTrackTitle(
    trackTitle: string | undefined,
    parts?: { artist?: string; track?: string; coverUrl?: string },
  ): void {
    this.update({ trackTitle, coverUrl: parts?.coverUrl });
    this.updateMediaSessionMetadata(this.current.station, parts);
  }

  private update(patch: Partial<NowPlaying>): void {
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
