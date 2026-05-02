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
  /** Favicon / initials block. */
  miniFav: HTMLElement;
  /** Station name. */
  miniName: HTMLElement;
  /** Status line (LIVE / TUNING… / PAUSED / error). */
  miniMeta: HTMLElement;
}

/** Replace the favicon block with a fresh image (and an initials
 *  fallback when the image fails to load) for the given station. */
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

  if (station.favicon) {
    const img = document.createElement('img');
    img.src = station.favicon;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener(
      'error',
      () => {
        img.remove();
        drawInitials();
      },
      { once: true },
    );
    refs.miniFav.append(img);
  } else {
    drawInitials();
  }
}

/** Render the mini-player for the given playback + wake state. Hides
 *  the bar when no station is selected; otherwise sets name, meta,
 *  art, and toggles `is-wake-bed` for the silent-bed dim style. */
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
  setMiniArt(refs, display);
  refs.mini.classList.toggle('is-wake-bed', isWakeBedActive(np, armedWake));
}
