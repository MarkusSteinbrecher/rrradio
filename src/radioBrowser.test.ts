import { describe, expect, it } from 'vitest';
import { normalizeStreamUrl } from './radioBrowser';

describe('normalizeStreamUrl', () => {
  it('forces https on http URLs (collapses RB http+https duplicates)', () => {
    expect(normalizeStreamUrl('http://stream.example.com/live')).toBe(
      'https://stream.example.com/live',
    );
  });

  it('lowercases the host', () => {
    expect(normalizeStreamUrl('https://Stream.Example.COM/Live')).toBe(
      'https://stream.example.com/Live',
    );
  });

  it('preserves the path (different paths = different streams)', () => {
    expect(normalizeStreamUrl('https://example.com/aac/96')).toBe(
      'https://example.com/aac/96',
    );
    expect(normalizeStreamUrl('https://example.com/mp3/128')).toBe(
      'https://example.com/mp3/128',
    );
  });

  it('drops the default port for the matching scheme', () => {
    expect(normalizeStreamUrl('http://example.com:80/live')).toBe('https://example.com/live');
    expect(normalizeStreamUrl('https://example.com:443/live')).toBe(
      'https://example.com/live',
    );
  });

  it('preserves non-default ports', () => {
    expect(normalizeStreamUrl('http://example.com:8000/live')).toBe(
      'https://example.com:8000/live',
    );
  });

  it('drops a trailing slash on root paths only', () => {
    expect(normalizeStreamUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeStreamUrl('https://example.com/live/')).toBe(
      'https://example.com/live/',
    );
  });

  it('falls back to lowercased trim for malformed URLs', () => {
    expect(normalizeStreamUrl('  NOT a URL  ')).toBe('not a url');
  });

  it('collapses http+https sibling URLs to the same key', () => {
    const a = normalizeStreamUrl('http://stream.otvoreni.hr/otvoreni');
    const b = normalizeStreamUrl('https://stream.otvoreni.hr/otvoreni');
    expect(a).toBe(b);
  });
});
