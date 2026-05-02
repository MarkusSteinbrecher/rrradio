/**
 * Now Playing render module (audit #77 follow-up).
 *
 * The biggest refs-based render in the app. Mirrors the mini-player
 * pattern: a `NowPlayingRefs` interface enumerates every element the
 * render writes to, and a small `NowPlayingContext` carries the
 * non-DOM dependencies (armed wake, favorite predicate, popup-clear
 * callback). main.ts wires production refs once at boot.
 */

import { countryName } from './country';
import { displayStation, isWakeBedActive } from './np-display';
import { npFormatText, npLiveText } from './np-labels';
import { stationInitials } from './station-display';
import { urlDisplay } from './url';
import type { NowPlaying, WakeTo } from './types';

export interface NowPlayingRefs {
  body: HTMLElement;
  npName: HTMLElement;
  npStationLogo: HTMLImageElement;
  npProgramName: HTMLElement;
  npProgramPre: HTMLElement;
  npPaneProgram: HTMLElement;
  npTags: HTMLElement;
  npBitrate: HTMLElement;
  npOrigin: HTMLElement;
  npListeners: HTMLElement;
  npLiveText: HTMLElement;
  npFormat: HTMLElement;
  npTrackRow: HTMLElement;
  npTrackTitle: HTMLElement;
  npTrackCover: HTMLImageElement;
  /** Container the cover-fallback initials live in. */
  npTrackCoverFallback: HTMLElement;
  npTrackSpotify: HTMLAnchorElement;
  npTrackAppleMusic: HTMLAnchorElement;
  npTrackOpenInWrap: HTMLElement;
  npStream: HTMLAnchorElement;
  npStreamHost: HTMLElement;
  npHome: HTMLAnchorElement;
  npHomeHost: HTMLElement;
  npFav: HTMLElement;
  npPlay: HTMLElement;
}

export interface NowPlayingContext {
  /** Currently armed wake (if any) — drives the silent-bed masquerade. */
  armedWake: WakeTo | null;
  /** Favorite predicate. main.ts wires this through to storage; tests
   *  pass a Set / stub so favorite-state can be asserted. */
  isFavorite: (id: string) => boolean;
  /** Side-effect: clear the open-in-music-app popup if it's open. The
   *  popup itself lives outside this render's scope; we just need to
   *  make sure it gets dismissed when the track row hides. */
  onClearOpenIn: () => void;
}

export function renderNowPlaying(
  refs: NowPlayingRefs,
  np: NowPlaying,
  ctx: NowPlayingContext,
): void {
  const s = displayStation(np, ctx.armedWake);
  const wakeBed = isWakeBedActive(np, ctx.armedWake);
  refs.npName.textContent = s.name || '—';
  refs.npTags.textContent = (s.tags ?? []).join(' · ');
  // is-wake-bed dims the cover/logo + overlays a small mute icon so
  // it's visually obvious the audio is silent right now.
  refs.body.classList.toggle('is-wake-bed', wakeBed);

  if (np.programName) {
    refs.npProgramName.textContent = np.programName;
    refs.npProgramPre.hidden = false;
    refs.npPaneProgram.title = np.programSubtitle || 'Program';
  } else {
    refs.npProgramName.textContent = 'Program';
    refs.npProgramPre.hidden = true;
    refs.npPaneProgram.title = 'Program';
  }

  if (s.favicon) {
    if (refs.npStationLogo.getAttribute('src') !== s.favicon) {
      refs.npStationLogo.src = s.favicon;
    }
    refs.npStationLogo.hidden = false;
    refs.npStationLogo.onerror = () => {
      refs.npStationLogo.hidden = true;
      refs.npStationLogo.removeAttribute('src');
    };
  } else {
    refs.npStationLogo.hidden = true;
    refs.npStationLogo.removeAttribute('src');
  }

  // Format: codec · bitrate, e.g. "MP3 · 192 kbps". Falls back to
  // whichever half is known, em-dash when neither.
  const fmtParts = [s.codec, s.bitrate ? `${s.bitrate} kbps` : ''].filter(Boolean);
  refs.npBitrate.textContent = fmtParts.length > 0 ? fmtParts.join(' · ') : '—';
  refs.npOrigin.textContent = s.country ? countryName(s.country) : '—';
  refs.npListeners.textContent = s.listeners ? s.listeners.toLocaleString() : '—';
  refs.npLiveText.textContent = npLiveText(np);
  refs.npFormat.textContent = npFormatText(s);

  // On-air block — content is always written (em-dashes when empty);
  // visibility is owned by main.ts's syncNpTabs (which gates on the
  // active NP tab + whether a station is loaded). Touching `hidden`
  // here used to fight syncNpTabs and let the cover bleed through
  // the lyrics pane on pause (gh #84).
  const hasTrack = !!np.trackTitle && np.trackTitle.trim().length > 0;
  refs.npTrackTitle.textContent = hasTrack ? (np.trackTitle as string) : '—';

  if (hasTrack) {
    const q = encodeURIComponent((np.trackTitle as string).trim());
    refs.npTrackSpotify.href = `https://open.spotify.com/search/${q}`;
    refs.npTrackAppleMusic.href = `https://music.apple.com/search?term=${q}`;
    refs.npTrackOpenInWrap.hidden = false;
  } else {
    refs.npTrackSpotify.removeAttribute('href');
    refs.npTrackAppleMusic.removeAttribute('href');
    refs.npTrackOpenInWrap.hidden = true;
    ctx.onClearOpenIn();
  }

  refs.npTrackCoverFallback.textContent = stationInitials(s.name || '');

  const coverSrc = np.coverUrl || s.favicon || '';
  if (coverSrc) {
    if (refs.npTrackCover.getAttribute('src') !== coverSrc) {
      refs.npTrackCover.src = coverSrc;
    }
    refs.npTrackCover.hidden = false;
    refs.npTrackCover.onerror = () => {
      refs.npTrackCover.hidden = true;
      refs.npTrackCover.removeAttribute('src');
    };
  } else {
    refs.npTrackCover.hidden = true;
    refs.npTrackCover.removeAttribute('src');
  }

  const fav = ctx.isFavorite(s.id);
  refs.npFav.classList.toggle('is-fav', !!s.id && fav);
  refs.npFav.setAttribute('aria-label', fav ? 'Remove favorite' : 'Add favorite');

  refs.npPlay.classList.toggle('is-loading', np.state === 'loading');
  refs.npPlay.setAttribute(
    'aria-label',
    np.state === 'playing' ? 'Pause' : np.state === 'loading' ? 'Cancel' : 'Play',
  );

  const stream = urlDisplay(s.streamUrl);
  if (stream) {
    refs.npStream.hidden = false;
    refs.npStream.href = stream.href;
    refs.npStream.title = stream.href;
    refs.npStreamHost.textContent = stream.host;
  } else {
    refs.npStream.hidden = true;
  }

  const home = urlDisplay(s.homepage);
  if (home) {
    refs.npHome.hidden = false;
    refs.npHome.href = home.href;
    refs.npHome.title = home.href;
    refs.npHomeHost.textContent = home.host;
  } else {
    refs.npHome.hidden = true;
  }
}
