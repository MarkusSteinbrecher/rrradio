/**
 * Listener-facing wording for a final playback error (#98).
 *
 * The player keeps the raw reason in `NowPlaying.errorMessage` (MediaError
 * label, watchdog reason, play() rejection, or main.ts's region-lock
 * override) because telemetry and broken-station reports want the precise
 * cause. The chrome shows a headline + hint from this module instead.
 *
 * Pure: no DOM, no globals. `online` is passed in by the caller.
 */

export type PlaybackErrorKind =
  | 'offline'
  | 'region'
  | 'not-public'
  | 'format'
  | 'unreachable'
  | 'unknown';

export interface PlaybackErrorView {
  kind: PlaybackErrorKind;
  /** Short status line: the NP badge and (uppercased) the mini-player. */
  headline: string;
  /** One sentence telling the listener what to do next. */
  hint: string;
}

/** Suffix main.ts appends to the region-lock override message. */
export const REGION_LOCK_SUFFIX = 'region-locked by the broadcaster.';

export function classifyPlaybackError(
  message: string | undefined,
  online: boolean,
): PlaybackErrorKind {
  const m = message ?? '';
  // A region lock is a catalog fact, so it wins over connectivity.
  if (m.includes(REGION_LOCK_SUFFIX)) return 'region';
  if (!online) return 'offline';
  if (m === 'Not a public stream') return 'not-public';
  if (m === 'Cannot decode stream' || /NotSupportedError/.test(m)) return 'format';
  if (
    m === 'Network error' ||
    m === 'Stream stalled' ||
    m === 'Playback aborted' ||
    m === 'Stream error'
  ) {
    return 'unreachable';
  }
  return 'unknown';
}

export function playbackErrorView(
  message: string | undefined,
  online: boolean,
): PlaybackErrorView {
  const kind = classifyPlaybackError(message, online);
  switch (kind) {
    case 'region':
      return {
        kind,
        headline: 'Not available in your region',
        // "Switzerland only — region-locked by the broadcaster."
        hint: message as string,
      };
    case 'offline':
      return {
        kind,
        headline: "You're offline",
        hint: 'Playback starts again when your connection is back.',
      };
    case 'not-public':
      // MediaError 4 is ambiguous: browsers raise it for a dead URL (404,
      // refused connection) as well as for a session-locked stream, so
      // the wording covers both.
      return {
        kind,
        headline: "Can't reach this stream",
        hint: "It may be down, or only play in the broadcaster's own player. Try again later, or report it.",
      };
    case 'format':
      return {
        kind,
        headline: "Can't play this stream",
        hint: "Your browser can't play this stream's format. Try another browser, or report it.",
      };
    case 'unreachable':
      return {
        kind,
        headline: 'Station not reachable',
        hint: "The stream isn't responding right now. Try again in a moment.",
      };
    default:
      return {
        kind,
        headline: "Can't play this station",
        hint: 'Try again, or report it if it keeps failing.',
      };
  }
}
