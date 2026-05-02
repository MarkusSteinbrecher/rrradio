import { describe, expect, it } from 'vitest';
import { miniMetaText, npFormatText, npLiveText } from './np-labels';
import type { NowPlaying, Station } from './types';

const baseStation: Station = {
  id: 'fm4',
  name: 'FM4',
  streamUrl: 'https://example.com/stream',
};

function np(overrides: Partial<NowPlaying> & { state: NowPlaying['state'] }): NowPlaying {
  return {
    station: { ...baseStation, ...(overrides.station ?? {}) },
    state: overrides.state,
    errorMessage: overrides.errorMessage,
  };
}

describe('miniMetaText', () => {
  it('loading → TUNING…', () => {
    expect(miniMetaText(np({ state: 'loading' }))).toBe('TUNING…');
  });

  it('playing without bitrate → LIVE', () => {
    expect(miniMetaText(np({ state: 'playing' }))).toBe('LIVE');
  });

  it('playing with bitrate → "<n> KBPS · LIVE"', () => {
    expect(
      miniMetaText(np({ state: 'playing', station: { ...baseStation, bitrate: 192 } })),
    ).toBe('192 KBPS · LIVE');
  });

  it('paused → PAUSED', () => {
    expect(miniMetaText(np({ state: 'paused' }))).toBe('PAUSED');
  });

  it('error with message → message uppercased', () => {
    expect(
      miniMetaText(np({ state: 'error', errorMessage: 'connection refused' })),
    ).toBe('CONNECTION REFUSED');
  });

  it('error without message → ERROR', () => {
    expect(miniMetaText(np({ state: 'error' }))).toBe('ERROR');
  });

  it('idle falls back to player.stateLabel uppercased', () => {
    expect(miniMetaText(np({ state: 'idle' }))).toBe('IDLE');
  });
});

describe('npLiveText', () => {
  it('loading → Tuning', () => {
    expect(npLiveText(np({ state: 'loading' }))).toBe('Tuning');
  });

  it('playing → Live · Streaming', () => {
    expect(npLiveText(np({ state: 'playing' }))).toBe('Live · Streaming');
  });

  it('paused → Paused', () => {
    expect(npLiveText(np({ state: 'paused' }))).toBe('Paused');
  });

  it('error with message → message verbatim (mixed case)', () => {
    expect(
      npLiveText(np({ state: 'error', errorMessage: 'Network down' })),
    ).toBe('Network down');
  });

  it('error without message → Error', () => {
    expect(npLiveText(np({ state: 'error' }))).toBe('Error');
  });

  it('idle → Standby', () => {
    expect(npLiveText(np({ state: 'idle' }))).toBe('Standby');
  });
});

describe('npFormatText', () => {
  it('bitrate + codec', () => {
    expect(npFormatText({ ...baseStation, bitrate: 192, codec: 'AAC' })).toBe('192 kbps · AAC');
  });

  it('bitrate only', () => {
    expect(npFormatText({ ...baseStation, bitrate: 128 })).toBe('128 kbps');
  });

  it('codec only', () => {
    expect(npFormatText({ ...baseStation, codec: 'MP3' })).toBe('MP3');
  });

  it('neither → em dash', () => {
    expect(npFormatText(baseStation)).toBe('—');
  });
});
