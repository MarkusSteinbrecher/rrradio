/**
 * Pure label helpers for the Now Playing + Mini-Player chrome.
 * Extracted from `src/main.ts` so the strings are testable without
 * a DOM (audit #77 — split large modules).
 *
 * No DOM access, no module globals — every function maps a
 * NowPlaying / Station value to a string. The DOM-writing render
 * functions in main.ts call these and assign to `.textContent`.
 */

import { stateLabel } from './player';
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

/** Short status line under the mini-player station name.
 *  e.g. `LIVE`, `192 KBPS · LIVE`, `TUNING…`, `PAUSED`,
 *  `<error headline uppercased>`. */
export function miniMetaText(np: NowPlaying): string {
  switch (np.state) {
    case 'loading':
      return np.retry ? `${retryStatusText(np.retry).toUpperCase()}…` : 'TUNING…';
    case 'playing': {
      const bitrate = np.variant?.bitrate ?? np.station.bitrate;
      return bitrate ? `${bitrate} KBPS · LIVE` : 'LIVE';
    }
    case 'paused':
      return 'PAUSED';
    case 'error':
      return errorHeadline(np).toUpperCase();
    default:
      return stateLabel(np.state).toUpperCase();
  }
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
