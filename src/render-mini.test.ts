/// <reference lib="dom" />
import { afterEach, describe, expect, it } from 'vitest';
import { renderMiniPlayer, setMiniArt, type MiniRefs } from './render-mini';
import { MINI_FRAGMENT, setup } from './render-test-harness';
import type { NowPlaying, Station, WakeTo } from './types';
import { SILENT_BED_ID } from './np-display';

const IDS = {
  mini: 'mini',
  miniFav: 'mini-fav',
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
    renderMiniPlayer(refs, np, null);
    expect(refs.mini.hidden).toBe(true);
  });

  it('un-hides + sets name + status on play', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'playing' }, null);
    expect(refs.mini.hidden).toBe(false);
    expect(refs.miniName.textContent).toBe('FM4');
    expect(refs.miniMeta.textContent).toBe('192 KBPS · LIVE');
  });

  it('shows TUNING… while loading', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'loading' }, null);
    expect(refs.miniMeta.textContent).toBe('TUNING…');
  });

  it('shows PAUSED when paused', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'paused' }, null);
    expect(refs.miniMeta.textContent).toBe('PAUSED');
  });

  it('substitutes the armed station name during silent-bed playback', () => {
    const refs = mountMini();
    const silentBed: Station = { id: SILENT_BED_ID, name: 'Silent bed', streamUrl: '/silence.m4a' };
    const wake: WakeTo = {
      time: '07:30',
      stationId: 'fm4',
      station: fm4,
      armedAt: 1_700_000_000_000,
    };
    renderMiniPlayer(refs, { station: silentBed, state: 'playing' }, wake);
    expect(refs.miniName.textContent).toBe('Wake up at 07:30');
    expect(refs.mini.classList.contains('is-wake-bed')).toBe(true);
  });

  it('does NOT add is-wake-bed when not on silent bed', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'playing' }, null);
    expect(refs.mini.classList.contains('is-wake-bed')).toBe(false);
  });

  it('shows the track line when a trackTitle is present', () => {
    const refs = mountMini();
    renderMiniPlayer(
      refs,
      { station: fm4, state: 'playing', trackTitle: 'Aphex Twin · Xtal' },
      null,
    );
    expect(refs.miniTrack.hidden).toBe(false);
    expect(refs.miniTrack.textContent).toBe('Aphex Twin · Xtal');
  });

  it('hides the track line when no trackTitle', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'playing' }, null);
    expect(refs.miniTrack.hidden).toBe(true);
  });

  it('hides the track line when trackTitle is whitespace', () => {
    const refs = mountMini();
    renderMiniPlayer(refs, { station: fm4, state: 'playing', trackTitle: '   ' }, null);
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

  it('prefers coverUrl over the station favicon when both are present', () => {
    const refs = mountMini();
    setMiniArt(
      refs,
      { ...fm4, favicon: 'https://example.com/fm4.png' },
      'https://example.com/track-cover.jpg',
    );
    const img = refs.miniFav.querySelector('img');
    expect(img?.src).toBe('https://example.com/track-cover.jpg');
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
