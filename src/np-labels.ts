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
import type { NowPlaying, Station } from './types';

/** Short status line under the mini-player station name.
 *  e.g. `LIVE`, `192 KBPS · LIVE`, `TUNING…`, `PAUSED`,
 *  `<error message uppercased>`. */
export function miniMetaText(np: NowPlaying): string {
  switch (np.state) {
    case 'loading':
      return 'TUNING…';
    case 'playing':
      return np.station.bitrate ? `${np.station.bitrate} KBPS · LIVE` : 'LIVE';
    case 'paused':
      return 'PAUSED';
    case 'error':
      return np.errorMessage ? np.errorMessage.toUpperCase() : 'ERROR';
    default:
      return stateLabel(np.state).toUpperCase();
  }
}

/** "Live · Streaming" / "Tuning" / "Paused" / "Standby" / error
 *  message — drives the small "live" pill on the Now Playing view. */
export function npLiveText(np: NowPlaying): string {
  switch (np.state) {
    case 'loading':
      return 'Tuning';
    case 'playing':
      return 'Live · Streaming';
    case 'paused':
      return 'Paused';
    case 'error':
      return np.errorMessage ?? 'Error';
    default:
      return 'Standby';
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
