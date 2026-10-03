/// <reference lib="dom" />
import { afterEach, describe, expect, it } from 'vitest';
import { renderMiniPlayer, setMiniArt, setMiniCover, type MiniRefs } from './render-mini';
import { MINI_FRAGMENT, setup } from './render-test-harness';
import type { NowPlaying, Station } from './types';

const IDS = {
  mini: 'mini',
  miniFav: 'mini-fav',
  miniArt: 'mini-art',
  miniName: 'mini-name',
  miniTrack: 'mini-track',
  miniMeta: 'mini-meta',
} as const;

function mountMini(): MiniRefs {
  return setup(MINI_FRAGMENT, IDS) as MiniRefs;
}

const fm4: Station = {
  id: 'fm4',
  name: 'FM4',
  streamUrl: 'https://example.com/fm4',
  bitrate: 192,
  codec: 'AAC',
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderMiniPlayer', () => {
  it('hides the mini-player when no station is selected', () => {
    const refs = mountMini();
    const np: NowPlaying = { station: { id: '', name: '', streamUrl: '' }, state: 'idle' };
    renderMiniPlayer(refs, np);
    expect(refs.mini.hidden).toBe(true);
  });

  it('un-hides + sets name + status on play', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'playing' });
    expect(refs.mini.hidden).toBe(false);
    expect(refs.miniName.textContent).toBe('FM4');
    expect(refs.miniMeta.textContent).toBe('192 KBPS · LIVE');
  });

  it('shows TUNING… while loading', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'loading' });
    expect(refs.miniMeta.textContent).toBe('TUNING…');
  });

  it('shows PAUSED when paused', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'paused' });
    expect(refs.miniMeta.textContent).toBe('PAUSED');
  });

  it('shows the track line when a trackTitle is present', () => {
    const refs = mountMini();
    renderMiniPlayer(
      refs,
      { station: fm4, state: 'playing', trackTitle: 'Aphex Twin · Xtal' },
    );
    expect(refs.miniTrack.hidden).toBe(false);
    expect(refs.miniTrack.textContent).toBe('Aphex Twin · Xtal');
  });

  it('hides the track line when no trackTitle', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'playing' });
    expect(refs.miniTrack.hidden).toBe(true);
  });

  it('hides the track line when trackTitle is whitespace', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'playing', trackTitle: '   ' });
    expect(refs.miniTrack.hidden).toBe(true);
  });
});

describe('setMiniArt', () => {
  it('renders initials when no favicon', () => {
    const refs = mountMini();
    setMiniArt(refs, fm4);
    // Initials span lives directly inside #mini-fav.
    expect(refs.miniFav.textContent).toBe('F');
  });

  it('renders initials + frequency badge when frequency is set', () => {
    const refs = mountMini();
    setMiniArt(refs, { ...fm4, frequency: '102.7' });
    expect(refs.miniFav.textContent).toContain('F');
    expect(refs.miniFav.querySelector('.freq-mini')?.textContent).toBe('102.7');
  });

  it('renders an <img> when favicon is set', () => {
    const refs = mountMini();
    setMiniArt(refs, { ...fm4, favicon: 'https://example.com/fm4.png' });
    const img = refs.miniFav.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.src).toBe('https://example.com/fm4.png');
    expect(img?.referrerPolicy).toBe('no-referrer');
  });

  it('applies the deterministic broadcaster class', () => {
    const refs = mountMini();
    setMiniArt(refs, fm4);
    expect(refs.miniFav.className).toMatch(/^fav/);
  });

  it('clears prior content before rendering', () => {
    const refs = mountMini();
    refs.miniFav.append(document.createElement('span')); // stale content
    setMiniArt(refs, fm4);
    // Single child (the initials span).
    expect(refs.miniFav.children).toHaveLength(1);
  });
});

describe('setMiniCover', () => {
  it('hides the album slot when there is no cover', () => {
    const refs = mountMini();
    setMiniCover(refs, undefined);
    expect(refs.miniArt.hidden).toBe(true);
    expect(refs.miniArt.querySelector('img')).toBeNull();
  });

  it('shows the cover image when a coverUrl is present', () => {
    const refs = mountMini();
    setMiniCover(refs, 'https://example.com/track-cover.jpg');
    expect(refs.miniArt.hidden).toBe(false);
    const img = refs.miniArt.querySelector('img');
    expect(img?.src).toBe('https://example.com/track-cover.jpg');
    expect(img?.referrerPolicy).toBe('no-referrer');
  });

  it('clears a prior cover when called with no url', () => {
    const refs = mountMini();
    setMiniCover(refs, 'https://example.com/track-cover.jpg');
    setMiniCover(refs, undefined);
    expect(refs.miniArt.hidden).toBe(true);
    expect(refs.miniArt.children).toHaveLength(0);
  });
});

describe('renderMiniPlayer — station favicon + album cover slots', () => {
  const withFavicon: Station = { ...fm4, favicon: 'https://example.com/fm4.png' };

  it('keeps the station favicon on the left and shows the track cover on the right', () => {
    const refs = mountMini();
    renderMiniPlayer(
      refs,
      { station: withFavicon, state: 'playing', coverUrl: 'https://example.com/cover.jpg' },
    );
    // Left slot = station favicon (never the cover).
    expect(refs.miniFav.querySelector('img')?.src).toBe('https://example.com/fm4.png');
    // Right slot = album cover, visible.
    expect(refs.miniArt.hidden).toBe(false);
    expect(refs.miniArt.querySelector('img')?.src).toBe('https://example.com/cover.jpg');
  });

  it('hides the album slot when the track has no cover', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: withFavicon, state: 'playing' });
    expect(refs.miniFav.querySelector('img')?.src).toBe('https://example.com/fm4.png');
    expect(refs.miniArt.hidden).toBe(true);
  });
});
