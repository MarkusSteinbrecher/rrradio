import { describe, expect, it } from 'vitest';
import { miniMetaText, miniProgramLine, miniTrackLine, npFormatText, npLiveText, npStatusText } from './np-labels';
import type { NowPlaying, Station } from './types';

const baseStation: Station = {
  id: 'fm4',
  name: 'FM4',
  streamUrl: 'https://example.com/stream',
};

function np(overrides: Partial<NowPlaying> & { state: NowPlaying['state'] }): NowPlaying {
  return { ...overrides, station: { ...baseStation, ...(overrides.station ?? {}) } };
}

describe('miniMetaText', () => {
  it('loading → LOADING… (iOS stateLine)', () => {
    expect(miniMetaText(np({ state: 'loading' }))).toBe('LOADING…');
  });

  it('playing without bitrate → LIVE', () => {
    expect(miniMetaText(np({ state: 'playing' }))).toBe('LIVE');
  });

  it('playing with bitrate still reads LIVE (iOS parity — no bitrate)', () => {
    expect(
      miniMetaText(np({ state: 'playing', station: { ...baseStation, bitrate: 192 } })),
    ).toBe('LIVE');
  });

  it('paused → PAUSED', () => {
    expect(miniMetaText(np({ state: 'paused' }))).toBe('PAUSED');
  });

  it('error with message → message uppercased', () => {
    expect(
      miniMetaText(np({ state: 'error', errorMessage: 'connection refused' })),
    ).toBe('CONNECTION REFUSED');
  });

  it('error with a listener-facing view → headline uppercased (#98)', () => {
    expect(
      miniMetaText(
        np({
          state: 'error',
          errorMessage: 'Network error',
          errorView: { kind: 'unreachable', headline: 'Station not reachable', hint: '…' },
        }),
      ),
    ).toBe('STATION NOT REACHABLE');
  });

  it('error phrase is trimmed before an em-dash so it fits the strip', () => {
    expect(
      miniMetaText(
        np({ state: 'error', errorMessage: 'Switzerland only — region-locked by the broadcaster.' }),
      ),
    ).toBe('SWITZERLAND ONLY');
  });

  it('error without message → ERROR', () => {
    expect(miniMetaText(np({ state: 'error' }))).toBe('ERROR');
  });

  it('idle → the station country, else STANDBY', () => {
    expect(miniMetaText(np({ state: 'idle' }))).toBe('STANDBY');
    expect(miniMetaText(np({ state: 'idle', station: { ...baseStation, country: 'at' } }))).toBe('AT');
    expect(miniMetaText(np({ state: 'idle', station: { ...baseStation, country: undefined } }))).toBe(
      'STANDBY',
    );
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

  it('error with a listener-facing view → headline, not the raw reason (#98)', () => {
    expect(
      npLiveText(
        np({
          state: 'error',
          errorMessage: 'NotSupportedError: The element has no supported sources.',
          errorView: { kind: 'format', headline: "Can't play this stream", hint: '…' },
        }),
      ),
    ).toBe("Can't play this stream");
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

describe('retry state (#95)', () => {
  const retry = { attempt: 2, maxAttempts: 3, planIndex: 0, planLength: 2 };
  const fallback = { attempt: 0, maxAttempts: 3, planIndex: 1, planLength: 2 };

  it('says Reconnecting n/max while a retry is pending', () => {
    expect(npStatusText(np({ state: 'loading', retry }))).toBe('Reconnecting 2/3');
    expect(npLiveText(np({ state: 'loading', retry }))).toBe('Reconnecting 2/3');
    expect(miniMetaText(np({ state: 'loading', retry }))).toBe('RECONNECTING 2/3…');
  });

  it('says Trying backup stream right after falling back to the next variant', () => {
    expect(npStatusText(np({ state: 'loading', retry: fallback }))).toBe('Trying backup stream');
    expect(miniMetaText(np({ state: 'loading', retry: fallback }))).toBe('TRYING BACKUP STREAM…');
  });

  it('plain loading still reads Tuning', () => {
    expect(npStatusText(np({ state: 'loading' }))).toBe('Tuning');
  });

});

describe('miniTrackLine (iOS trackLine)', () => {
  it('joins the split artist + title with " - "', () => {
    expect(miniTrackLine(np({ state: 'playing', trackArtist: 'Aphex Twin', trackName: 'Xtal' }))).toBe(
      'Aphex Twin - Xtal',
    );
  });
  it('falls back to the title alone, then the combined trackTitle', () => {
    expect(miniTrackLine(np({ state: 'playing', trackName: 'Xtal' }))).toBe('Xtal');
    expect(miniTrackLine(np({ state: 'playing', trackTitle: 'Aphex Twin — Xtal' }))).toBe('Aphex Twin — Xtal');
  });
  it('is suppressed while loading and when blank', () => {
    expect(miniTrackLine(np({ state: 'loading', trackName: 'Xtal' }))).toBeUndefined();
    expect(miniTrackLine(np({ state: 'playing', trackTitle: '   ' }))).toBeUndefined();
  });
});

describe('miniProgramLine (iOS programInfoLine)', () => {
  it('joins program name + subtitle with " . "', () => {
    expect(miniProgramLine(np({ state: 'playing', programName: 'Morning Show', programSubtitle: 'with Ana' }))).toBe(
      'Morning Show . with Ana',
    );
  });
  it('uses whichever part exists, else undefined', () => {
    expect(miniProgramLine(np({ state: 'playing', programSubtitle: ' with Ana ' }))).toBe('with Ana');
    expect(miniProgramLine(np({ state: 'playing', programName: '  ' }))).toBeUndefined();
  });
});
