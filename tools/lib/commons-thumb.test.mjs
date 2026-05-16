import { describe, expect, it } from 'vitest';
import { commonsSvgToPngThumb } from './commons-thumb.mjs';

describe('commonsSvgToPngThumb', () => {
  it('transforms a Commons SVG URL into its 500px PNG thumb', () => {
    const input = 'https://upload.wikimedia.org/wikipedia/commons/0/07/Logo_Radio_Wien.svg';
    const expected = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Logo_Radio_Wien.svg/500px-Logo_Radio_Wien.svg.png';
    expect(commonsSvgToPngThumb(input)).toBe(expected);
  });

  it('preserves percent-encoded umlauts in the filename', () => {
    const input = 'https://upload.wikimedia.org/wikipedia/commons/9/99/Logo_Radio_Ober%C3%B6sterreich.svg';
    const expected = 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Logo_Radio_Ober%C3%B6sterreich.svg/500px-Logo_Radio_Ober%C3%B6sterreich.svg.png';
    expect(commonsSvgToPngThumb(input)).toBe(expected);
  });

  it('honours a custom size override', () => {
    const input = 'https://upload.wikimedia.org/wikipedia/commons/0/07/Logo_Radio_Wien.svg';
    expect(commonsSvgToPngThumb(input, 1000)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Logo_Radio_Wien.svg/1000px-Logo_Radio_Wien.svg.png',
    );
  });

  it('leaves non-Commons URLs untouched', () => {
    const input = 'https://example.com/some-logo.svg';
    expect(commonsSvgToPngThumb(input)).toBe(input);
  });

  it('leaves non-SVG Commons URLs untouched (we only need to rasterise SVG)', () => {
    const input = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Radio_Flamingo_Logo.png';
    expect(commonsSvgToPngThumb(input)).toBe(input);
  });

  it('leaves already-transformed thumb URLs untouched (idempotent)', () => {
    const input = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Logo_Radio_Wien.svg/500px-Logo_Radio_Wien.svg.png';
    // The thumb URL has /thumb/ in front of the hash, so the SVG-pattern
    // regex won't match — returns the input unchanged.
    expect(commonsSvgToPngThumb(input)).toBe(input);
  });
});
