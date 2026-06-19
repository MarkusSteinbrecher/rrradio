import { describe, expect, it } from 'vitest';
import {
  contentHash8,
  isLocalFavicon,
  stripFaviconVersion,
  withFaviconVersion,
} from './favicon-version.mjs';

describe('isLocalFavicon', () => {
  it('matches rrradio-hosted stations/ paths', () => {
    expect(isLocalFavicon('stations/grrif.png')).toBe(true);
    expect(isLocalFavicon('stations/grrif.png?v=a1b2c3d4')).toBe(true);
  });

  it('rejects remote URLs and empties', () => {
    expect(isLocalFavicon('https://orf.at/logo.png')).toBe(false);
    expect(isLocalFavicon('//cdn.example/logo.png')).toBe(false);
    expect(isLocalFavicon('favicons/grrif-76-abcd1234.webp')).toBe(false);
    expect(isLocalFavicon(undefined)).toBe(false);
    expect(isLocalFavicon('')).toBe(false);
  });
});

describe('contentHash8', () => {
  it('is an 8-char hex digest derived from the bytes', () => {
    const h = contentHash8(Buffer.from('hello'));
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e...
    expect(h).toBe('2cf24dba');
  });

  it('changes when the bytes change', () => {
    expect(contentHash8(Buffer.from('logo-v1'))).not.toBe(
      contentHash8(Buffer.from('logo-v2')),
    );
  });
});

describe('withFaviconVersion', () => {
  it('appends a ?v= query to a bare path', () => {
    expect(withFaviconVersion('stations/grrif.png', 'a1b2c3d4')).toBe(
      'stations/grrif.png?v=a1b2c3d4',
    );
  });

  it('is idempotent — re-versioning replaces, never stacks', () => {
    const once = withFaviconVersion('stations/grrif.png', 'a1b2c3d4');
    const twice = withFaviconVersion(once, 'eeee0000');
    expect(twice).toBe('stations/grrif.png?v=eeee0000');
  });

  it('preserves an unrelated query while swapping v', () => {
    expect(withFaviconVersion('stations/x.png?foo=bar', 'a1b2c3d4')).toBe(
      'stations/x.png?foo=bar&v=a1b2c3d4',
    );
  });
});

describe('stripFaviconVersion', () => {
  it('removes the v query, leaving the on-disk path', () => {
    expect(stripFaviconVersion('stations/grrif.png?v=a1b2c3d4')).toBe(
      'stations/grrif.png',
    );
  });

  it('is a no-op on un-versioned paths', () => {
    expect(stripFaviconVersion('stations/grrif.png')).toBe('stations/grrif.png');
  });

  it('keeps other query params intact', () => {
    expect(stripFaviconVersion('stations/x.png?foo=bar&v=abcd1234')).toBe(
      'stations/x.png?foo=bar',
    );
    expect(stripFaviconVersion('stations/x.png?foo=bar')).toBe('stations/x.png?foo=bar');
  });

  it('passes through non-strings', () => {
    expect(stripFaviconVersion(undefined)).toBe(undefined);
  });
});
