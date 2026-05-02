import { describe, expect, it } from 'vitest';
import { safeUrl, urlDisplay } from './url';

describe('safeUrl', () => {
  it('accepts http URLs', () => {
    expect(safeUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('accepts https URLs', () => {
    expect(safeUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  it('rejects javascript: scheme', () => {
    expect(safeUrl('javascript:alert(1)')).toBe(null);
  });

  it('rejects data: scheme', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe(null);
  });

  it('rejects file: scheme', () => {
    expect(safeUrl('file:///etc/passwd')).toBe(null);
  });

  it('rejects blob: scheme', () => {
    expect(safeUrl('blob:https://example.com/abc')).toBe(null);
  });

  it('rejects unparseable URLs', () => {
    expect(safeUrl('not a url')).toBe(null);
  });

  it('rejects empty / null / undefined', () => {
    expect(safeUrl('')).toBe(null);
    expect(safeUrl(null)).toBe(null);
    expect(safeUrl(undefined)).toBe(null);
  });

  it('canonicalizes the URL via URL.toString()', () => {
    expect(safeUrl('HTTPS://Example.COM')).toBe('https://example.com/');
  });
});

describe('urlDisplay', () => {
  it('strips leading www.', () => {
    expect(urlDisplay('https://www.example.com/')).toEqual({
      host: 'example.com',
      href: 'https://www.example.com/',
    });
  });

  it('omits trailing slash on root path', () => {
    expect(urlDisplay('https://example.com/')?.host).toBe('example.com');
  });

  it('appends non-root paths to host', () => {
    expect(urlDisplay('https://example.com/about')?.host).toBe('example.com/about');
  });

  it('returns null for unsafe schemes', () => {
    expect(urlDisplay('javascript:alert(1)')).toBe(null);
  });

  it('returns null for empty / null input', () => {
    expect(urlDisplay('')).toBe(null);
    expect(urlDisplay(null)).toBe(null);
    expect(urlDisplay(undefined)).toBe(null);
  });

  it('exposes both host (display) and href (link target)', () => {
    const r = urlDisplay('https://www.example.com/path');
    expect(r).toEqual({
      host: 'example.com/path',
      href: 'https://www.example.com/path',
    });
  });
});
