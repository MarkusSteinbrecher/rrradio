/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SILENT_BED_ID } from './np-display';
import { NP_FRAGMENT, mountFragment } from './render-test-harness';
import {
  renderLyricsPane,
  renderNowPlaying,
  type LyricsPaneRefs,
  type NowPlayingRefs,
} from './render-np';
import type { Station, WakeTo } from './types';

function mountNp(): NowPlayingRefs {
  mountFragment(NP_FRAGMENT);
  const byId = (id: string): HTMLElement => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not in NP_FRAGMENT`);
    return el;
  };
  return {
    body: document.body,
    npName: byId('np-name'),
    npStationLogo: byId('np-station-logo') as HTMLImageElement,
    npStationLogoBtn: byId('np-station-logo-btn'),
    npBitrate: byId('np-bitrate'),
    npOrigin: byId('np-origin'),
    npListeners: byId('np-listeners'),
    npTrackRow: byId('np-track-row'),
    npTrackTitle: byId('np-track-title'),
    npTrackArtist: byId('np-track-artist'),
    npTrackProgram: byId('np-track-program'),
    npTrackStatus: byId('np-track-status'),
    npTrackStatusText: byId('np-track-status-text'),
    npTrackCover: byId('np-track-cover') as HTMLImageElement,
    npTrackCoverFallback: byId('np-track-cover-fallback'),
    npTrackSpotify: byId('np-track-spotify') as HTMLAnchorElement,
    npTrackAppleMusic: byId('np-track-apple-music') as HTMLAnchorElement,
    npTrackYoutubeMusic: byId('np-track-youtube-music') as HTMLAnchorElement,
    npTrackOpenInWrap: byId('np-track-open-in-wrap'),
    npStream: byId('np-stream') as HTMLAnchorElement,
    npStreamHost: byId('np-stream-host'),
    npHome: byId('np-home') as HTMLAnchorElement,
    npHomeHost: byId('np-home-host'),
    npReportBroken: byId('np-report-broken') as HTMLButtonElement,
    npFav: byId('np-fav'),
    npPlay: byId('np-play'),
  };
}

const fm4: Station = {
  id: 'fm4',
  name: 'FM4',
  streamUrl: 'https://example.com/fm4',
  bitrate: 192,
  codec: 'AAC',
  country: 'AT',
  tags: ['alternative', 'indie'],
  homepage: 'https://fm4.orf.at',
  listeners: 1234,
};

const ctx = (overrides: Partial<Parameters<typeof renderNowPlaying>[2]> = {}) => ({
  armedWake: null,
  isFavorite: () => false,
  onClearOpenIn: () => {},
  ...overrides,
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderNowPlaying — header + meta', () => {
  it('writes name, format, country, listeners', () => {
    const refs = mountNp();
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npName.textContent).toBe('FM4');
    expect(refs.npBitrate.textContent).toBe('AAC · 192 kbps');
    expect(refs.npOrigin.textContent).toBe('Austria');
    expect(refs.npListeners.textContent).toBe('1,234');
  });

  it('em-dashes when station has no name', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      { station: { id: '', name: '', streamUrl: '' }, state: 'idle' },
      ctx(),
    );
    expect(refs.npName.textContent).toBe('—');
    expect(refs.npOrigin.textContent).toBe('—');
    expect(refs.npListeners.textContent).toBe('—');
  });
});

describe('renderNowPlaying — album pane (artist / program / status)', () => {
  it('splits the song title + artist onto separate lines (prefers trackName)', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      {
        station: fm4,
        state: 'playing',
        trackTitle: 'Radiohead — Pyramid Song',
        trackName: 'Pyramid Song',
        trackArtist: 'Radiohead',
      },
      ctx(),
    );
    expect(refs.npTrackTitle.textContent).toBe('Pyramid Song');
    expect(refs.npTrackArtist.textContent).toBe('Radiohead');
    expect(refs.npTrackArtist.hidden).toBe(false);
  });

  it('hides the artist line when the metadata carries no artist split', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      { station: fm4, state: 'playing', trackTitle: 'BR24 Aktuell', trackName: 'BR24 Aktuell' },
      ctx(),
    );
    expect(refs.npTrackArtist.hidden).toBe(true);
    expect(refs.npTrackArtist.textContent).toBe('');
  });

  it('shows the program/show line when available, hides it otherwise', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      { station: fm4, state: 'playing', programName: 'Morning Show' },
      ctx(),
    );
    expect(refs.npTrackProgram.textContent).toBe('Morning Show');
    expect(refs.npTrackProgram.hidden).toBe(false);

    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npTrackProgram.hidden).toBe(true);
  });

  it('shows a status badge while active and hides it when idle', () => {
    const refs = mountNp();
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npTrackStatus.hidden).toBe(false);
    expect(refs.npTrackStatusText.textContent).toBe('Live');
    expect(refs.npTrackStatus.dataset.state).toBe('playing');

    renderNowPlaying(refs, { station: fm4, state: 'idle' }, ctx());
    expect(refs.npTrackStatus.hidden).toBe(true);
    expect(refs.npTrackStatusText.textContent).toBe('');
  });
});

describe('renderNowPlaying — track + open-in', () => {
  it('does not touch track row visibility (gh #84)', () => {
    // Track-row visibility is owned by main.ts's syncNpTabs (it
    // gates on the active NP tab + station presence). render-np
    // writes content into the row but must never toggle its
    // `hidden` attribute — touching it caused the cover to bleed
    // through the lyrics pane on pause.
    const refs = mountNp();
    refs.npTrackRow.hidden = true; // pretend syncNpTabs hid it (lyrics tab)
    renderNowPlaying(refs, { station: fm4, state: 'paused' }, ctx());
    expect(refs.npTrackRow.hidden).toBe(true);

    refs.npTrackRow.hidden = false; // pretend syncNpTabs showed it (now tab)
    renderNowPlaying(refs, { station: fm4, state: 'paused' }, ctx());
    expect(refs.npTrackRow.hidden).toBe(false);
  });

  it('shows track title + builds Spotify/Apple Music/YouTube Music URLs when iTunes verified', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      {
        station: fm4,
        state: 'playing',
        trackTitle: 'Radiohead - Pyramid Song',
        trackVerified: true,
      },
      ctx(),
    );
    expect(refs.npTrackTitle.textContent).toBe('Radiohead - Pyramid Song');
    expect(refs.npTrackOpenInWrap.hidden).toBe(false);
    expect(refs.npTrackSpotify.href).toContain('open.spotify.com/search/');
    expect(refs.npTrackSpotify.href).toContain(encodeURIComponent('Radiohead - Pyramid Song'));
    expect(refs.npTrackAppleMusic.href).toContain('music.apple.com/search?term=');
    expect(refs.npTrackYoutubeMusic.href).toContain('music.youtube.com/search?q=');
    expect(refs.npTrackYoutubeMusic.href).toContain(encodeURIComponent('Radiohead - Pyramid Song'));
  });

  it('hides music-service links while iTunes verification is pending (trackVerified undefined)', () => {
    // Mirrors the in-flight state right after a new ICY title appears
    // but before searchITunes returns. Title renders, links stay hidden.
    const refs = mountNp();
    const onClearOpenIn = vi.fn();
    renderNowPlaying(
      refs,
      { station: fm4, state: 'playing', trackTitle: 'BR24 Aktuell' },
      ctx({ onClearOpenIn }),
    );
    expect(refs.npTrackTitle.textContent).toBe('BR24 Aktuell');
    expect(refs.npTrackOpenInWrap.hidden).toBe(true);
    expect(refs.npTrackSpotify.hasAttribute('href')).toBe(false);
    expect(refs.npTrackAppleMusic.hasAttribute('href')).toBe(false);
    expect(refs.npTrackYoutubeMusic.hasAttribute('href')).toBe(false);
    expect(onClearOpenIn).toHaveBeenCalledTimes(1);
  });

  it('hides music-service links when iTunes confirms a miss (trackVerified false)', () => {
    // News/talk channels: ICY emits show names, iTunes returns 0
    // results. Title still renders, music-service links suppressed.
    const refs = mountNp();
    renderNowPlaying(
      refs,
      {
        station: fm4,
        state: 'playing',
        trackTitle: 'Nachrichten 12:00 Uhr',
        trackVerified: false,
      },
      ctx(),
    );
    expect(refs.npTrackTitle.textContent).toBe('Nachrichten 12:00 Uhr');
    expect(refs.npTrackOpenInWrap.hidden).toBe(true);
    expect(refs.npTrackAppleMusic.hasAttribute('href')).toBe(false);
  });

  it('clears open-in (and calls callback) when no track', () => {
    const refs = mountNp();
    const onClearOpenIn = vi.fn();
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx({ onClearOpenIn }));
    expect(refs.npTrackTitle.textContent).toBe('—');
    expect(refs.npTrackOpenInWrap.hidden).toBe(true);
    expect(onClearOpenIn).toHaveBeenCalledTimes(1);
  });

  it('writes initials into the cover fallback span', () => {
    const refs = mountNp();
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npTrackCoverFallback.textContent).toBe('F');
  });
});

describe('renderNowPlaying — favorite + play', () => {
  it('toggles is-fav class + aria-label by isFavorite predicate', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      { station: fm4, state: 'playing' },
      ctx({ isFavorite: () => true }),
    );
    expect(refs.npFav.classList.contains('is-fav')).toBe(true);
    expect(refs.npFav.getAttribute('aria-label')).toBe('Remove favorite');

    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npFav.classList.contains('is-fav')).toBe(false);
    expect(refs.npFav.getAttribute('aria-label')).toBe('Add favorite');
  });

  it('play button reflects state', () => {
    const refs = mountNp();
    renderNowPlaying(refs, { station: fm4, state: 'loading' }, ctx());
    expect(refs.npPlay.classList.contains('is-loading')).toBe(true);
    expect(refs.npPlay.getAttribute('aria-label')).toBe('Cancel');

    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npPlay.classList.contains('is-loading')).toBe(false);
    expect(refs.npPlay.getAttribute('aria-label')).toBe('Pause');

    renderNowPlaying(refs, { station: fm4, state: 'paused' }, ctx());
    expect(refs.npPlay.getAttribute('aria-label')).toBe('Play');
  });
});

describe('renderNowPlaying — source links', () => {
  it('shows stream URL host when present', () => {
    const refs = mountNp();
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npStream.hidden).toBe(false);
    expect(refs.npStream.href).toBe('https://example.com/fm4');
    expect(refs.npStreamHost.textContent).toBe('example.com/fm4');
  });

  it('shows homepage host when present', () => {
    const refs = mountNp();
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npHome.hidden).toBe(false);
    expect(refs.npHomeHost.textContent).toBe('fm4.orf.at');
  });

  it('hides source links when station has no homepage', () => {
    const refs = mountNp();
    const noHome = { ...fm4, homepage: undefined };
    renderNowPlaying(refs, { station: noHome, state: 'playing' }, ctx());
    expect(refs.npHome.hidden).toBe(true);
  });

  it('enables broken-station reporting only for real stations', () => {
    const refs = mountNp();
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npReportBroken.hidden).toBe(false);
    expect(refs.npReportBroken.disabled).toBe(false);

    renderNowPlaying(refs, { station: { id: '', name: '', streamUrl: '' }, state: 'idle' }, ctx());
    expect(refs.npReportBroken.hidden).toBe(true);
    expect(refs.npReportBroken.disabled).toBe(true);
  });
});

describe('renderNowPlaying — silent-bed wake masquerade', () => {
  const silentBed: Station = {
    id: SILENT_BED_ID,
    name: 'Silent bed',
    streamUrl: '/silence.m4a',
  };
  const wake: WakeTo = {
    time: '07:30',
    stationId: 'fm4',
    station: fm4,
    armedAt: 1_700_000_000_000,
  };

  it('substitutes the armed station name + sets is-wake-bed body class', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      { station: silentBed, state: 'playing' },
      ctx({ armedWake: wake }),
    );
    expect(refs.npName.textContent).toBe('Wake up at 07:30');
    expect(refs.body.classList.contains('is-wake-bed')).toBe(true);
  });

  it('clears is-wake-bed when no wake armed', () => {
    const refs = mountNp();
    refs.body.classList.add('is-wake-bed');
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.body.classList.contains('is-wake-bed')).toBe(false);
  });
});

function mountLyrics(): LyricsPaneRefs {
  mountFragment(NP_FRAGMENT);
  const byId = (id: string): HTMLElement => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not in NP_FRAGMENT`);
    return el;
  };
  return {
    npLyricsText: byId('np-lyrics-text'),
    npLyricsEmpty: byId('np-lyrics-empty'),
    npLyricsHead: byId('np-lyrics-head'),
    npLyricsTitle: byId('np-lyrics-title'),
    npLyricsArtist: byId('np-lyrics-artist'),
    npLyricsSource: byId('np-lyrics-source') as HTMLAnchorElement,
    npLyricsSourceText: byId('np-lyrics-source-text'),
  };
}

const lrclib = { name: 'LRCLIB', url: 'https://lrclib.net' };
const track = { trackName: 'Pyramid Song', trackArtist: 'Radiohead' };

describe('renderLyricsPane', () => {
  it('renders plain lyrics + iOS-parity header + source credit', () => {
    const refs = mountLyrics();
    renderLyricsPane(refs, { plain: 'Line one\nLine two', source: lrclib }, track);
    expect(refs.npLyricsText.textContent).toBe('Line one\nLine two');
    expect(refs.npLyricsEmpty.hidden).toBe(true);
    expect(refs.npLyricsHead.hidden).toBe(false);
    expect(refs.npLyricsTitle.textContent).toBe('Pyramid Song');
    expect(refs.npLyricsArtist.textContent).toBe('Radiohead');
    expect(refs.npLyricsArtist.hidden).toBe(false);
    expect(refs.npLyricsSource.hidden).toBe(false);
    expect(refs.npLyricsSource.getAttribute('href')).toBe('https://lrclib.net');
    expect(refs.npLyricsSourceText.textContent).toBe('Lyrics via LRCLIB');
  });

  it('flattens synced lyrics to text when there is no plain text', () => {
    const refs = mountLyrics();
    renderLyricsPane(
      refs,
      {
        synced: [
          { ts: 0, text: 'First line' },
          { ts: 1200, text: 'Second line' },
        ],
        source: lrclib,
      },
      track,
    );
    expect(refs.npLyricsText.textContent).toBe('First line\nSecond line');
    expect(refs.npLyricsEmpty.hidden).toBe(true);
  });

  it('shows the empty-state and clears header + source when there are no lyrics', () => {
    const refs = mountLyrics();
    // Seed a populated pane, then reset — mirrors switching from a track
    // with lyrics to one without (resetLyrics passes null).
    renderLyricsPane(refs, { plain: 'something', source: lrclib }, track);
    renderLyricsPane(refs, null, { trackName: '', trackArtist: '' });
    expect(refs.npLyricsText.textContent).toBe('');
    expect(refs.npLyricsEmpty.hidden).toBe(false);
    expect(refs.npLyricsHead.hidden).toBe(true);
    expect(refs.npLyricsSource.hidden).toBe(true);
    expect(refs.npLyricsSource.hasAttribute('href')).toBe(false);
  });

  it('hides the artist line when the track carries no artist split', () => {
    const refs = mountLyrics();
    renderLyricsPane(
      refs,
      { plain: 'la la la', source: { name: 'Lyrics.ovh', url: 'https://lyrics.ovh' } },
      { trackName: 'Some Track' },
    );
    expect(refs.npLyricsArtist.hidden).toBe(true);
    expect(refs.npLyricsArtist.textContent).toBe('');
    // Head still shows — there's a title to head.
    expect(refs.npLyricsHead.hidden).toBe(false);
    expect(refs.npLyricsSourceText.textContent).toBe('Lyrics via Lyrics.ovh');
  });

  it('keeps the source link hidden when lyrics carry no source', () => {
    const refs = mountLyrics();
    renderLyricsPane(refs, { plain: 'orphan lyrics' }, track);
    expect(refs.npLyricsText.textContent).toBe('orphan lyrics');
    expect(refs.npLyricsSource.hidden).toBe(true);
    expect(refs.npLyricsSource.hasAttribute('href')).toBe(false);
  });

  it('falls back to trackTitle for the header when trackName is absent', () => {
    const refs = mountLyrics();
    renderLyricsPane(
      refs,
      { plain: 'words', source: lrclib },
      { trackTitle: 'Artist - Song', trackArtist: 'Artist' },
    );
    expect(refs.npLyricsTitle.textContent).toBe('Artist - Song');
  });
});
