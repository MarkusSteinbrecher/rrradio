/**
 * "What station should the chrome show right now?" — pure reducer
 * over `(np, armedWake)` for the silent-bed wake masquerade. While
 * the silent bed is the active audio source, both the mini-player and
 * the Now Playing view present the armed wake station instead, so the
 * UI never reads "Silent bed". Extracted from main.ts (audit #77).
 *
 * The silent-bed id is the contract — main.ts owns the constant and
 * passes it through. Production calls use `SILENT_BED_ID`; tests pass
 * a literal so they don't depend on main.ts at all.
 */

import type { NowPlaying, Station, WakeTo } from './types';

/** The id main.ts uses for its silent wake-bed station. Exported so
 *  callers don't have to repeat the literal. */
export const SILENT_BED_ID = '__wake_silent_bed__';

/** Returns the station the chrome should *display* — usually
 *  `np.station`, but during silent-bed playback we substitute the
 *  armed wake station with a synthesized "Wake up at HH:MM" name. */
export function displayStation(
  np: NowPlaying,
  armedWake: WakeTo | null,
  silentBedId: string = SILENT_BED_ID,
): Station {
  if (np.station.id === silentBedId && armedWake?.station) {
    return {
      ...armedWake.station,
      name: `Wake up at ${armedWake.time}`,
    };
  }
  return np.station;
}

/** True iff the silent bed is the active audio source AND a wake is
 *  armed — drives the dimming + mute-overlay style. */
export function isWakeBedActive(
  np: NowPlaying,
  armedWake: WakeTo | null,
  silentBedId: string = SILENT_BED_ID,
): boolean {
  return np.station.id === silentBedId && armedWake !== null;
}
