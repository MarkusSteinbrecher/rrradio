/**
 * Mini-player render module (audit #77 follow-up).
 *
 * Refs-based rather than module-globals — render functions take the
 * elements they touch via a typed `MiniRefs` interface so tests can
 * mount a small fragment of HTML, call render, and assert on the
 * resulting DOM. main.ts wires the production refs once at boot.
 */

import { miniMetaText, miniProgramLine, miniTrackLine } from './np-labels';
import { faviconClass, flagEmoji, stationInitials } from './station-display';
import type { NowPlaying, Station } from './types';

/**
 * Mirrors the iOS strip (`MiniPlayerView.swift`): leading favicon (+ list
 * badge) · metadata lines · sleep glyph · album thumb · play/pause.
 */
export interface MiniRefs {
  /** The clickable mini-player root (hidden when no station selected). */
  mini: HTMLElement;
  /** Station favicon / initials block (left — the station's identity). */
  miniFav: HTMLElement;
  /** "Playing from list" badge overlaid on the favicon (iOS
   *  `stationListBadge`) — shown while a station-list queue drives playback. */
  miniBadge: HTMLElement;
  /** Album cover-art slot (right, before the controls). Hidden when the
   *  track has no cover; a distinct element from the station favicon. */
  miniArt: HTMLElement;
  /** Station name. */
  miniName: HTMLElement;
  /** Country flag emoji trailing the name (iOS `stationTitleLine`). */
  miniFlag: HTMLElement;
  /** Track line (`artist - title`) — hidden when no track is identified. */
  miniTrack: HTMLElement;
  /** Program line (`program . subtitle`) — hidden when there's no program. */
  miniProgram: HTMLElement;
  /** State-line wrapper (live dot + text). Shown only when there is neither
   *  a track nor a program line, as on iOS. */
  miniState: HTMLElement;
  /** State-line text (STANDBY / LOADING… / LIVE / PAUSED / error). */
  miniMeta: HTMLElement;
  /** Sleep-timer glyph (iOS `moon.zzz.fill`), shown while a timer is armed. */
  miniSleep: HTMLElement;
  /** Play/pause control — labelled per state, disabled while loading. */
  miniToggle: HTMLElement;
}

/** Playback context the mini shows that isn't part of `NowPlaying`. */
export interface MiniContext {
  /** A sleep timer is armed. */
  sleepArmed?: boolean;
  /** Playback is driven by a station-list queue. */
  fromList?: boolean;
}
/** Append an `<img src>` into `container`, calling `onFail` (e.g. draw a
 *  fallback or hide the slot) if the image errors. Shared by the favicon
 *  and cover-art slots. */
function loadImg(container: HTMLElement, src: string, onFail: () => void): void {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener(
    'error',
    () => {
      img.remove();
      onFail();
    },
    { once: true },
  );
  container.append(img);
}

/** Draw the station favicon (or an initials / frequency fallback) into the
 *  left art slot. Always the station's identity — the album cover art lives
 *  in its own slot (`setMiniCover`), iOS-parity. */
export function setMiniArt(refs: MiniRefs, station: Station): void {
  refs.miniFav.replaceChildren();
  refs.miniFav.className = faviconClass(station.id);

  const drawInitials = (): void => {
    const span = document.createElement('span');
    span.textContent = stationInitials(station.name);
    refs.miniFav.append(span);
    if (station.frequency) {
      const freq = document.createElement('span');
      freq.className = 'freq-mini';
      freq.textContent = station.frequency;
      refs.miniFav.append(freq);
    }
  };

  if (station.favicon) loadImg(refs.miniFav, station.favicon, drawInitials);
  else drawInitials();
}

/** Fill the right-hand album slot with the current track's cover art, or
 *  hide it when there's no track-level artwork. iOS parity: the album thumb
 *  only appears once we actually know what's playing. Hides again if the
 *  cover URL fails to load rather than leaving a broken/empty box. */
export function setMiniCover(refs: MiniRefs, coverUrl?: string): void {
  refs.miniArt.replaceChildren();
  if (!coverUrl) {
    refs.miniArt.hidden = true;
    return;
  }
  refs.miniArt.hidden = false;
  loadImg(refs.miniArt, coverUrl, () => {
    refs.miniArt.hidden = true;
  });
}

/** Show `text` in `el`, or hide it when there's nothing to show. */
function setLine(el: HTMLElement, text: string | undefined): void {
  el.textContent = text ?? '';
  el.hidden = !text;
}

/** Render the mini-player for the given playback state. Hides the bar
 *  when no station is selected; otherwise fills the iOS line stack —
 *  name + flag, track line, then the program line or (when there is
 *  neither a track nor a program) the state line — plus the two art
 *  slots (station favicon left, track cover right) and the controls. */
export function renderMiniPlayer(refs: MiniRefs, np: NowPlaying, ctx: MiniContext = {}): void {
  if (!np.station.id) {
    refs.mini.hidden = true;
    return;
  }
  const display = np.station;
  refs.mini.hidden = false;
  refs.miniName.textContent = display.name;
  setLine(refs.miniFlag, flagEmoji(display.country) || undefined);

  const track = miniTrackLine(np);
  const program = miniProgramLine(np);
  setLine(refs.miniTrack, track);
  setLine(refs.miniProgram, program);
  refs.miniMeta.textContent = miniMetaText(np);
  refs.miniState.hidden = !!track || !!program;

  refs.miniSleep.hidden = !ctx.sleepArmed;
  refs.miniBadge.hidden = !ctx.fromList;

  const playing = np.state === 'playing';
  refs.miniToggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  refs.miniToggle.setAttribute('aria-disabled', String(np.state === 'loading'));

  // Left slot: always the station favicon. Right slot: the track-level
  // cover when we have one.
  setMiniArt(refs, display);
  setMiniCover(refs, np.coverUrl);
}
