/**
 * Mini-player render module (audit #77 follow-up).
 *
 * Refs-based rather than module-globals — render functions take the
 * elements they touch via a typed `MiniRefs` interface so tests can
 * mount a small fragment of HTML, call render, and assert on the
 * resulting DOM. main.ts wires the production refs once at boot.
 */

import { displayStation, isWakeBedActive } from './np-display';
import { miniMetaText } from './np-labels';
import { faviconClass, stationInitials } from './station-display';
import type { NowPlaying, Station, WakeTo } from './types';

export interface MiniRefs {
  /** The clickable mini-player root (hidden when no station selected). */
  mini: HTMLElement;
  /** Station favicon / initials block (left — the station's identity). */
  miniFav: HTMLElement;
  /** Album cover-art slot (right, before the controls). Hidden when the
   *  track has no cover; a distinct element from the station favicon. */
  miniArt: HTMLElement;
  /** Station name. */
  miniName: HTMLElement;
  /** Track line (artist · title) — hidden when no track is identified. */
  miniTrack: HTMLElement;
  /** Status line (LIVE / TUNING… / PAUSED / error). */
  miniMeta: HTMLElement;
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

/** Render the mini-player for the given playback + wake state. Hides
 *  the bar when no station is selected; otherwise sets name, meta,
 *  track line, the two art slots (station favicon left, track cover
 *  right), and toggles `is-wake-bed` for the silent-bed dim style. */
export function renderMiniPlayer(
  refs: MiniRefs,
  np: NowPlaying,
  armedWake: WakeTo | null,
): void {
  if (!np.station.id) {
    refs.mini.hidden = true;
    return;
  }
  const display = displayStation(np, armedWake);
  refs.mini.hidden = false;
  refs.miniName.textContent = display.name;
  refs.miniMeta.textContent = miniMetaText(np);
  const track = np.trackTitle?.trim() ?? '';
  if (track) {
    refs.miniTrack.textContent = track;
    refs.miniTrack.hidden = false;
  } else {
    refs.miniTrack.textContent = '';
    refs.miniTrack.hidden = true;
  }
  // Left slot: always the station favicon. Right slot: the track-level
  // cover when we have one — but never during silent-bed wake playback
  // (the bed is silence, so there's no album art to show).
  setMiniArt(refs, display);
  const cover = isWakeBedActive(np, armedWake) ? undefined : np.coverUrl;
  setMiniCover(refs, cover);
  refs.mini.classList.toggle('is-wake-bed', isWakeBedActive(np, armedWake));
}
