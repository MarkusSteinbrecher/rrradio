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
  /** Bitrate in kbps when known (Radio Browser bitrate field) */
  bitrate?: number;
  /** Audio codec when known, e.g. "MP3", "AAC" (Radio Browser codec field) */
  codec?: string;
  /** Approximate listener count — derived from Radio Browser clickcount */
  listeners?: number;
  /** Display-only "FM" frequency. Real RB stations rarely have one, so we
   * derive a deterministic pseudo-frequency in the 87.5–108.0 MHz range
   * from the station id so the tuner-dial visualization always has a target. */
  frequency?: string;
  /** Optional key into the metadata-fetcher registry (src/builtins.ts).
   *  Built-in stations declare which fetcher to use ("grrif", "fm4", "br"). */
  metadata?: string;
  /** Optional per-station URL passed to the fetcher (some fetchers, e.g.
   *  the BR radioplayer.json reader, need to know which channel to query). */
  metadataUrl?: string;
}

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface NowPlaying {
  station: Station;
  state: PlayerState;
  /** Best-effort current track title. Often unavailable on web. */
  trackTitle?: string;
  /** Optional cover-art URL for the current track (when the metadata
   *  source provides one — e.g. Grrif's covers.json). */
  coverUrl?: string;
  errorMessage?: string;
}
