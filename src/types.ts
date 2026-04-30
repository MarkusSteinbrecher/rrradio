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
  /** Optional [latitude, longitude] for map placement. Sourced from
   *  Radio Browser (geo_lat / geo_long); rounded to 4 decimal places
   *  (~10m precision, plenty for a station map). */
  geo?: [number, number];
  /** Curation status from data/stations.yaml. Only the three publishable
   *  values reach the runtime catalog (build-catalog filters the rest):
   *  - `working`     — full per-broadcaster fetcher: stream + ICY + cover
   *  - `icy-only`    — stream + ICY-over-fetch metadata, no broadcaster API
   *  - `stream-only` — stream confirmed, no metadata source
   *  Drives the row capability badges. Absent on RB long-tail / custom adds. */
  status?: 'working' | 'icy-only' | 'stream-only';
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
  /** Optional show / program currently on this station — i.e. the
   *  parent broadcast that bundles the songs (e.g. "Morning Show"
   *  on FM4). Separate from per-track info because programs change
   *  every hour or two while tracks change every few minutes. */
  programName?: string;
  programSubtitle?: string;
  errorMessage?: string;
}

/** A single armed wake-to-radio setting. v1 supports one at a time and
 *  no recurrence — once it fires (or the user disarms it), the entry
 *  is cleared. Time is local 24h "HH:MM"; we resolve to the next
 *  occurrence in JS so the same value works whether the user arms it
 *  in the morning or at night. */
export interface WakeTo {
  /** "HH:MM" 24h, local time. */
  time: string;
  /** Station to switch to + fade up at fire time. */
  stationId: string;
  /** Persisted snapshot of the station so the wake works even if
   *  BUILTIN_STATIONS is still loading at fire time. */
  station: Station;
  /** Epoch ms when the alarm was armed — used to disambiguate "today"
   *  vs "tomorrow" when the user arms a time that's already passed. */
  armedAt: number;
}
