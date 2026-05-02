import { describe, expect, it } from 'vitest';
import { parseStreamTitle } from './icyMetadata';

describe('parseStreamTitle', () => {
  it('splits on the first " - " into artist and track', () => {
    expect(parseStreamTitle('Pet Shop Boys - Liberation')).toEqual({
      artist: 'Pet Shop Boys',
      track: 'Liberation',
      raw: 'Pet Shop Boys - Liberation',
    });
  });

  it('preserves dashes that are inside the track title', () => {
    // Only the FIRST " - " separates artist + track; the rest belongs
    // to the title (e.g. "Artist - Track - Remix").
    expect(parseStreamTitle('Daft Punk - One More Time - Edit')).toEqual({
      artist: 'Daft Punk',
      track: 'One More Time - Edit',
      raw: 'Daft Punk - One More Time - Edit',
    });
  });

  it('returns track-only when there is no separator', () => {
    expect(parseStreamTitle('NDR Info - Die Nachrichten für den Norden - ndr.de/info'))
      .toMatchObject({ artist: 'NDR Info' });
    // Bare brand string with no dash → track only
    expect(parseStreamTitle('Wir sind der Westen.')).toEqual({
      track: 'Wir sind der Westen.',
      raw: 'Wir sind der Westen.',
    });
  });

  it('trims whitespace around artist and track', () => {
    expect(parseStreamTitle('  ABBA  -  Dancing Queen  ')).toEqual({
      artist: 'ABBA',
      track: 'Dancing Queen',
      raw: 'ABBA  -  Dancing Queen',
    });
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(parseStreamTitle('')).toBeNull();
    expect(parseStreamTitle('   ')).toBeNull();
  });

  it('does not split when the dash is at the very beginning', () => {
    // "- Track Name" → no artist
    expect(parseStreamTitle('- Track Name')).toEqual({
      track: '- Track Name',
      raw: '- Track Name',
    });
  });

  it('does not split when the dash is at the very end', () => {
    expect(parseStreamTitle('Artist - ')).toEqual({
      track: 'Artist -',
      raw: 'Artist -',
    });
  });
});
