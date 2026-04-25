export interface Station {
  id: string;
  name: string;
  streamUrl: string;
  /** Optional homepage URL for attribution / "more info" links */
  homepage?: string;
  /** Optional country code (ISO 3166-1 alpha-2) */
  country?: string;
  /** Optional comma-or-array tags from Radio Browser, e.g. ["jazz", "ambient"] */
  tags?: string[];
  /** Optional artwork URL */
  favicon?: string;
}

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface NowPlaying {
  station: Station;
  state: PlayerState;
  /** Best-effort current track title. Often unavailable on web. */
  trackTitle?: string;
  errorMessage?: string;
}
