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
  /** Favicon / cover-art / initials block. */
  miniFav: HTMLElement;
  /** Station name. */
  miniName: HTMLElement;
  /** Track line (artist · title) — hidden when no track is identified. */
  miniTrack: HTMLElement;
  /** Status line (LIVE / TUNING… / PAUSED / error). */
  miniMeta: HTMLElement;
}

/** Replace the art block with a fresh image (and an initials fallback
 *  when the image fails to load) for the given station. When `coverUrl`
 *  is supplied (a track has been identified), use it instead of the
 *  station favicon — the mini becomes a real player at that point.
 *  Falls back to favicon then initials if the cover fails to load. */
export function setMiniArt(refs: MiniRefs, station: Station, coverUrl?: string): void {
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

  const loadImg = (src: string, onFail: () => void): void => {
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
    refs.miniFav.append(img);
  };

  if (coverUrl) {
    // Cover → favicon → initials
    loadImg(coverUrl, () => {
      if (station.favicon) loadImg(station.favicon, drawInitials);
      else drawInitials();
    });
  } else if (station.favicon) {
    loadImg(station.favicon, drawInitials);
  } else {
    drawInitials();
  }
}

/** Render the mini-player for the given playback + wake state. Hides
 *  the bar when no station is selected; otherwise sets name, meta,
 *  track line, art, and toggles `is-wake-bed` for the silent-bed dim
 *  style. The art slot prefers `np.coverUrl` (track-level art) over
 *  the station favicon when both exist. */
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
  // Wake-bed playback substitutes the station and shouldn't show
  // a real cover (the bed is silence). Pass undefined cover so the
  // art falls back to the wake station's favicon.
  const cover = isWakeBedActive(np, armedWake) ? undefined : np.coverUrl;
  setMiniArt(refs, display, cover);
  refs.mini.classList.toggle('is-wake-bed', isWakeBedActive(np, armedWake));
}
