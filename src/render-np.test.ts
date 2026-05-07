/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SILENT_BED_ID } from './np-display';
import { NP_FRAGMENT, mountFragment } from './render-test-harness';
import { renderNowPlaying, type NowPlayingRefs } from './render-np';
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
    npProgramName: byId('np-program-name'),
    npProgramPre: byId('np-program-pre'),
    npPaneProgram: byId('np-pane-program'),
    npTags: byId('np-tags'),
    npBitrate: byId('np-bitrate'),
    npOrigin: byId('np-origin'),
    npListeners: byId('np-listeners'),
    npLiveText: byId('np-live-text'),
    npFormat: byId('np-format'),
    npTrackRow: byId('np-track-row'),
    npTrackTitle: byId('np-track-title'),
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
  it('writes name, tags, format, country, listeners, live text', () => {
    const refs = mountNp();
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npName.textContent).toBe('FM4');
    expect(refs.npTags.textContent).toBe('alternative · indie');
    expect(refs.npBitrate.textContent).toBe('AAC · 192 kbps');
    expect(refs.npOrigin.textContent).toBe('Austria');
    expect(refs.npListeners.textContent).toBe('1,234');
    expect(refs.npLiveText.textContent).toBe('Live · Streaming');
    expect(refs.npFormat.textContent).toBe('192 kbps · AAC');
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

describe('renderNowPlaying — program block', () => {
  it('shows program name when available', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      { station: fm4, state: 'playing', programName: 'Morning Show' },
      ctx(),
    );
    expect(refs.npProgramName.textContent).toBe('Morning Show');
    expect(refs.npProgramPre.hidden).toBe(false);
  });

  it('uses subtitle as the pane title when available', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      {
        station: fm4,
        state: 'playing',
        programName: 'Morning Show',
        programSubtitle: 'with Stuart Freeman',
      },
      ctx(),
    );
    expect(refs.npPaneProgram.title).toBe('with Stuart Freeman');
  });

  it('falls back to "Program" placeholder when no program', () => {
    const refs = mountNp();
    renderNowPlaying(refs, { station: fm4, state: 'playing' }, ctx());
    expect(refs.npProgramName.textContent).toBe('Program');
    expect(refs.npProgramPre.hidden).toBe(true);
    expect(refs.npPaneProgram.title).toBe('Program');
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

  it('shows track title + builds Spotify/Apple Music/YouTube Music search URLs', () => {
    const refs = mountNp();
    renderNowPlaying(
      refs,
      { station: fm4, state: 'playing', trackTitle: 'Radiohead - Pyramid Song' },
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
