import { describe, expect, it } from 'vitest';
import { normalizeStreamUrl, streamHost, normalizeHomepage } from './dedupe-normalize.mjs';

describe('normalizeStreamUrl', () => {
  it('treats http and https of the same host+path as one stream', () => {
    expect(normalizeStreamUrl('http://drive.uber.radio/uber/crbeethoven/icecast.audio'))
      .toBe(normalizeStreamUrl('https://drive.uber.radio/uber/crbeethoven/icecast.audio'));
  });

  it('drops www and trailing slash', () => {
    expect(normalizeStreamUrl('https://www.example.com/stream/'))
      .toBe(normalizeStreamUrl('http://example.com/stream'));
  });

  it('drops query noise by default', () => {
    expect(normalizeStreamUrl('https://h.com/s.mp3?ref=radiobrowser'))
      .toBe(normalizeStreamUrl('https://h.com/s.mp3'));
  });

  it('keeps query when dropQuery is false (channel selectors)', () => {
    const opts = { dropQuery: false };
    expect(normalizeStreamUrl('https://eilo.org/streamer.php?ch=techno', opts))
      .not.toBe(normalizeStreamUrl('https://eilo.org/streamer.php?ch=trance', opts));
  });

  it('falls back to a trimmed lowercase string for unparseable input', () => {
    expect(normalizeStreamUrl('  NOT A URL ')).toBe('not a url');
    expect(normalizeStreamUrl('')).toBe('');
  });
});

describe('streamHost', () => {
  it('returns the bare host', () => {
    expect(streamHost('https://www.Example.com:8000/x')).toBe('example.com:8000');
    expect(streamHost('garbage')).toBe('');
  });
});

describe('normalizeHomepage', () => {
  it('host-only by default', () => {
    expect(normalizeHomepage('https://www.br.de/radio/index.html')).toBe('br.de');
  });

  it('includes path and strips index pages when asked', () => {
    expect(normalizeHomepage('https://www.br.de/radio/index.html', { includePath: true }))
      .toBe('br.de/radio');
    expect(normalizeHomepage('https://br.de/radio/', { includePath: true })).toBe('br.de/radio');
  });

  it('empty for no host', () => {
    expect(normalizeHomepage('not-a-url')).toBe('');
  });
});
