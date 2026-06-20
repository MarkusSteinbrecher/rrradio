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
import { SILENT_BED_ID, displayStation, isWakeBedActive } from './np-display';
import { npFormatText, npLiveText, npStatusText } from './np-labels';
import { stationInitials } from './station-display';
import { urlDisplay } from './url';
import type { LyricsResult } from './lyrics';
import type { NowPlaying, WakeTo } from './types';

export interface NowPlayingRefs {
  body: HTMLElement;
  npName: HTMLElement;
  npStationLogo: HTMLImageElement;
  npTags: HTMLElement;
  npBitrate: HTMLElement;
  npOrigin: HTMLElement;
  npListeners: HTMLElement;
  npLiveText: HTMLElement;
  npFormat: HTMLElement;
  npTrackRow: HTMLElement;
  npTrackTitle: HTMLElement;
  /** Album-pane artist line (iOS parity) — hidden when no artist. */
  npTrackArtist: HTMLElement;
  /** Album-pane program/show line — hidden when no program. */
  npTrackProgram: HTMLElement;
  /** Album-pane status badge wrapper (carries the `data-state` that
   *  colours the dot) + its label span. */
  npTrackStatus: HTMLElement;
  npTrackStatusText: HTMLElement;
  npTrackCover: HTMLImageElement;
  /** Container the cover-fallback initials live in. */
  npTrackCoverFallback: HTMLElement;
  npTrackSpotify: HTMLAnchorElement;
  npTrackAppleMusic: HTMLAnchorElement;
  npTrackYoutubeMusic: HTMLAnchorElement;
  npTrackOpenInWrap: HTMLElement;
  npStream: HTMLAnchorElement;
  npStreamHost: HTMLElement;
  npHome: HTMLAnchorElement;
  npHomeHost: HTMLElement;
  npReportBroken: HTMLButtonElement;
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
  // iOS-parity split: the album title shows just the song (`trackName`)
  // with the artist on its own line below. Fall back to the combined
  // `trackTitle` when the metadata source didn't split them (e.g. the
  // wake-bed masquerade passes a single display string).
  const songTitle = (np.trackName ?? '').trim() || (np.trackTitle ?? '').trim();
  refs.npTrackTitle.textContent = hasTrack ? songTitle || '—' : '—';

  // Artist line — only shown when the metadata carried a real artist
  // (an "Artist - Track" split). News/talk/IDs leave it absent, so the
  // line collapses rather than echoing the station name (already the
  // big header above).
  const artist = (np.trackArtist ?? '').trim();
  refs.npTrackArtist.textContent = artist;
  refs.npTrackArtist.hidden = artist.length === 0;

  // Program/show line — the parent broadcast (e.g. "Morning Show").
  const program = (np.programName ?? '').trim();
  refs.npTrackProgram.textContent = program;
  refs.npTrackProgram.hidden = program.length === 0;

  // Status badge — "● LIVE / TUNING / PAUSED / ERROR"; the dot colour is
  // driven by data-state. Hidden (empty label) while idle.
  const status = npStatusText(np);
  refs.npTrackStatusText.textContent = status;
  refs.npTrackStatus.dataset.state = np.state;
  refs.npTrackStatus.hidden = status.length === 0;

  // Music-service search links only render once iTunes has confirmed
  // the title resolves to a real song (np.trackVerified === true).
  // While the lookup is in-flight (undefined) or after a confirmed
  // miss (false), we hide the open-in wrap entirely — the alternative
  // is sending users to empty Apple Music / Spotify / YT Music search
  // pages, which is the bug this gate fixes for news/talk stations.
  if (hasTrack && np.trackVerified === true) {
    const q = encodeURIComponent((np.trackTitle as string).trim());
    refs.npTrackSpotify.href = `https://open.spotify.com/search/${q}`;
    refs.npTrackAppleMusic.href = `https://music.apple.com/search?term=${q}`;
    refs.npTrackYoutubeMusic.href = `https://music.youtube.com/search?q=${q}`;
    refs.npTrackOpenInWrap.hidden = false;
  } else {
    refs.npTrackSpotify.removeAttribute('href');
    refs.npTrackAppleMusic.removeAttribute('href');
    refs.npTrackYoutubeMusic.removeAttribute('href');
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

  refs.npReportBroken.hidden = !s.id || s.id === SILENT_BED_ID;
  refs.npReportBroken.disabled = !s.id || s.id === SILENT_BED_ID;
}

/** Elements the lyrics pane writes to. The pane's *visibility* (and the
 *  Lyrics tab pill) is owned by main.ts's syncNpTabs — this render only
 *  fills content, so it never touches `np-lyrics-pane`'s own `hidden`. */
export interface LyricsPaneRefs {
  npLyricsText: HTMLElement;
  /** "No lyrics" line — only ever visible in the wide layout where the
   *  lyrics column shows even with nothing to display. */
  npLyricsEmpty: HTMLElement;
  /** iOS-parity header wrapper (title + artist), pinned above the body. */
  npLyricsHead: HTMLElement;
  npLyricsTitle: HTMLElement;
  npLyricsArtist: HTMLElement;
  npLyricsSource: HTMLAnchorElement;
  npLyricsSourceText: HTMLElement;
}

/** Render the Now Playing lyrics pane (iOS parity). Plain text wins over
 *  synced — current-line highlighting needs an elapsed-since-track-start
 *  estimate live radio can't give us, so synced lines are flattened. The
 *  header + source-credit link only surface when there's actual text;
 *  with no lyrics the pane collapses to the empty-state line (the Lyrics
 *  tab itself is hidden upstream, so that line only shows in the wide
 *  layout's always-on lyrics column). */
export function renderLyricsPane(
  refs: LyricsPaneRefs,
  lyrics: LyricsResult | null | undefined,
  track: Pick<NowPlaying, 'trackName' | 'trackTitle' | 'trackArtist'>,
): void {
  const text = lyrics?.plain || lyrics?.synced?.map((l) => l.text).join('\n') || '';
  refs.npLyricsText.textContent = text;
  const hasText = text !== '';
  refs.npLyricsEmpty.hidden = hasText;

  // Header track info comes from the live now-playing metadata — the same
  // song/artist split the album pane uses.
  const title = track.trackName?.trim() || track.trackTitle?.trim() || '';
  const artist = track.trackArtist?.trim() ?? '';
  refs.npLyricsTitle.textContent = title;
  refs.npLyricsArtist.textContent = artist;
  refs.npLyricsArtist.hidden = artist.length === 0;
  refs.npLyricsHead.hidden = !hasText || title.length === 0;

  // Source credit (LRCLIB / Lyrics.ovh) — only when we actually rendered text.
  const source = lyrics?.source;
  if (hasText && source) {
    refs.npLyricsSource.href = source.url;
    refs.npLyricsSourceText.textContent = `Lyrics via ${source.name}`;
    refs.npLyricsSource.hidden = false;
  } else {
    refs.npLyricsSource.hidden = true;
    refs.npLyricsSource.removeAttribute('href');
  }
}
