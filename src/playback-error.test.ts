import { describe, expect, it } from 'vitest';
import { classifyPlaybackError, playbackErrorView, REGION_LOCK_SUFFIX } from './playback-error';

describe('classifyPlaybackError (#98)', () => {
  it.each([
    ['Network error', 'unreachable'],
    ['Stream stalled', 'unreachable'],
    ['Playback aborted', 'unreachable'],
    ['Stream error', 'unreachable'],
    ['Cannot decode stream', 'format'],
    ['NotSupportedError: The element has no supported sources.', 'format'],
    ['Not a public stream', 'not-public'],
    ['TypeError: something odd', 'unknown'],
    [undefined, 'unknown'],
  ] as const)('%s → %s', (message, kind) => {
    expect(classifyPlaybackError(message, true)).toBe(kind);
  });

  it('offline wins over the raw reason', () => {
    expect(classifyPlaybackError('Network error', false)).toBe('offline');
    expect(classifyPlaybackError('Cannot decode stream', false)).toBe('offline');
  });

  it('a region lock wins even offline (it is a catalog fact)', () => {
    const msg = `Switzerland only — ${REGION_LOCK_SUFFIX}`;
    expect(classifyPlaybackError(msg, true)).toBe('region');
    expect(classifyPlaybackError(msg, false)).toBe('region');
  });
});

describe('playbackErrorView', () => {
  it('region keeps the specific message as the hint', () => {
    const msg = `Switzerland only — ${REGION_LOCK_SUFFIX}`;
    expect(playbackErrorView(msg, true)).toEqual({
      kind: 'region',
      headline: 'Not available in your region',
      hint: msg,
    });
  });

  it('never shows the raw browser exception', () => {
    const raw = 'NotSupportedError: The element has no supported sources.';
    const view = playbackErrorView(raw, true);
    expect(view.headline).not.toContain('NotSupportedError');
    expect(view.hint).not.toContain('NotSupportedError');
  });

  it('every kind has a headline and a hint', () => {
    for (const msg of ['Network error', 'Cannot decode stream', 'Not a public stream', 'x']) {
      for (const online of [true, false]) {
        const view = playbackErrorView(msg, online);
        expect(view.headline.length).toBeGreaterThan(0);
        expect(view.hint.length).toBeGreaterThan(0);
      }
    }
  });
});
