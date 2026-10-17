/**
 * Pure label helpers for the Now Playing + Mini-Player chrome.
 * Extracted from `src/main.ts` so the strings are testable without
 * a DOM (audit #77 — split large modules).
 *
 * No DOM access, no module globals — every function maps a
 * NowPlaying / Station value to a string. The DOM-writing render
 * functions in main.ts call these and assign to `.textContent`.
 */

import type { NowPlaying, Station, StreamRetry } from './types';

/** What the player is doing while an automatic retry runs (#95):
 *  `Reconnecting 2/3`, or `Trying backup stream` right after the ladder
 *  fell back to the next stream variant. */
export function retryStatusText(retry: StreamRetry): string {
  if (retry.attempt === 0) return 'Trying backup stream';
  return `Reconnecting ${retry.attempt}/${retry.maxAttempts}`;
}

/** The error line: the listener-facing headline (#98), falling back to
 *  the raw reason, then a bare "Error". */
export function errorHeadline(np: NowPlaying): string {
  return np.errorView?.headline ?? np.errorMessage ?? 'Error';
}

/** Mini-player state line (iOS `MiniPlayerView.stateLine`), uppercased the
 *  way the iOS mono caption renders it: `STANDBY` (or the station's country
 *  code while idle), `LOADING…`, `LIVE`, `PAUSED`, or the error phrase
 *  trimmed to the part before an em-dash so it fits the strip
 *  ("Switzerland only — region-locked…" → "SWITZERLAND ONLY"). Web keeps its
 *  auto-retry wording (#95) while loading. */
export function miniMetaText(np: NowPlaying): string {
  switch (np.state) {
    case 'loading':
      return np.retry ? `${retryStatusText(np.retry).toUpperCase()}…` : 'LOADING…';
    case 'playing':
      return 'LIVE';
    case 'paused':
      return 'PAUSED';
    case 'error': {
      const message = errorHeadline(np);
      const dash = message.indexOf(' — ');
      return (dash > 0 ? message.slice(0, dash) : message).toUpperCase();
    }
    default:
      return np.station.country?.toUpperCase() || 'STANDBY';
  }
}

/** Mini-player track line (iOS `trackLine`): `"<artist> - <title>"`, the
 *  title alone, or the combined `trackTitle` when the fetcher gave no split.
 *  Suppressed while loading so a stale track never shows under "Loading". */
export function miniTrackLine(np: NowPlaying): string | undefined {
  if (np.state === 'loading') return undefined;
  const title = np.trackName?.trim();
  const artist = np.trackArtist?.trim();
  if (title) return artist ? `${artist} - ${title}` : title;
  return np.trackTitle?.trim() || undefined;
}

/** Mini-player program line (iOS `programInfoLine`): program name and
 *  subtitle joined with " . ", or undefined when neither is set. */
export function miniProgramLine(np: NowPlaying): string | undefined {
  const parts = [np.programName?.trim(), np.programSubtitle?.trim()].filter(
    (v): v is string => !!v,
  );
  return parts.length > 0 ? parts.join(' . ') : undefined;
}

/** "Live · Streaming" / "Tuning" / "Paused" / "Standby" / error
 *  message — drives the small "live" pill on the Now Playing view. */
export function npLiveText(np: NowPlaying): string {
  switch (np.state) {
    case 'loading':
      return np.retry ? retryStatusText(np.retry) : 'Tuning';
    case 'playing':
      return 'Live · Streaming';
    case 'paused':
      return 'Paused';
    case 'error':
      return errorHeadline(np);
    default:
      return 'Standby';
  }
}

/** Compact status word for the Album-pane status badge (iOS parity:
 *  the "● LIVE / PAUSED / …" line under the track title). Empty string
 *  when idle — the badge hides itself rather than showing "Standby"
 *  inside the album art block. The dot colour is driven separately off
 *  `np.state` (a `data-state` attribute in render-np). */
export function npStatusText(np: NowPlaying): string {
  switch (np.state) {
    case 'loading':
      return np.retry ? retryStatusText(np.retry) : 'Tuning';
    case 'playing':
      return 'Live';
    case 'paused':
      return 'Paused';
    case 'error':
      return errorHeadline(np);
    default:
      return '';
  }
}

/** Combined bitrate + codec descriptor, or `—` when neither is known.
 *  e.g. `192 kbps · AAC`, `128 kbps`, `MP3`, `—`. */
export function npFormatText(s: Station): string {
  const parts: string[] = [];
  if (s.bitrate) parts.push(`${s.bitrate} kbps`);
  if (s.codec) parts.push(s.codec);
  return parts.length > 0 ? parts.join(' · ') : '—';
}
