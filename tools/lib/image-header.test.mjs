import { describe, expect, it } from 'vitest';
import { parseImageHeader, bucketForNp } from './image-header.mjs';

// Synthesised minimal headers for each format — just enough bytes for the
// parser to determine dimensions. Where a format requires more (e.g. WebP
// chunks), we hand-build the smallest valid byte sequence.

function pngHeader(width, height) {
  const b = new Uint8Array(24);
  // PNG magic
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length (13) — not used by the parser, fill for realism
  b[8] = 0; b[9] = 0; b[10] = 0; b[11] = 13;
  // "IHDR"
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  // width / height, big-endian u32
  b[16] = (width  >>> 24) & 0xff; b[17] = (width  >>> 16) & 0xff;
  b[18] = (width  >>>  8) & 0xff; b[19] =  width         & 0xff;
  b[20] = (height >>> 24) & 0xff; b[21] = (height >>> 16) & 0xff;
  b[22] = (height >>>  8) & 0xff; b[23] =  height         & 0xff;
  return b;
}

function jpegHeader(width, height) {
  // SOI (FFD8) then SOF0 (FFC0) with length 17, precision 8, h/w big-endian.
  const b = new Uint8Array(20);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  b[7] = (height >>> 8) & 0xff; b[8]  = height & 0xff;
  b[9] = (width  >>> 8) & 0xff; b[10] = width  & 0xff;
  return b;
}

function gifHeader(width, height) {
  const b = new Uint8Array(10);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
  b[6] =  width        & 0xff; b[7] = (width  >>> 8) & 0xff;
  b[8] =  height       & 0xff; b[9] = (height >>> 8) & 0xff;
  return b;
}

function icoHeader(width, height) {
  // One entry directory.
  const b = new Uint8Array(22);
  b.set([0, 0, 1, 0, 1, 0], 0);
  b[6]  = width  === 256 ? 0 : width;
  b[7]  = height === 256 ? 0 : height;
  return b;
}

function bmpHeader(width, height) {
  const b = new Uint8Array(26);
  b.set([0x42, 0x4d], 0); // "BM"
  // BITMAPINFOHEADER size (40) at offset 14
  b[14] = 40;
  // width LE at 18, height LE at 22
  b[18] =  width        & 0xff; b[19] = (width  >>> 8) & 0xff;
  b[22] =  height       & 0xff; b[23] = (height >>> 8) & 0xff;
  return b;
}

function webpVP8X(width, height) {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0);   // "RIFF"
  b.set([0x57, 0x45, 0x42, 0x50], 8);   // "WEBP"
  b.set([0x56, 0x50, 0x38, 0x58], 12);  // "VP8X"
  const w = width  - 1;
  const h = height - 1;
  b[24] =  w        & 0xff;
  b[25] = (w >>> 8) & 0xff;
  b[26] = (w >>> 16) & 0xff;
  b[27] =  h        & 0xff;
  b[28] = (h >>> 8) & 0xff;
  b[29] = (h >>> 16) & 0xff;
  return b;
}

const SVG_FIXED = new TextEncoder().encode(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="512" height="384"></svg>',
);
const SVG_VIEWBOX = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"></svg>',
);

describe('parseImageHeader', () => {
  it('reads PNG dimensions', () => {
    expect(parseImageHeader(pngHeader(512, 256))).toEqual({ format: 'png', width: 512, height: 256 });
  });

  it('reads JPEG dimensions from SOF0', () => {
    expect(parseImageHeader(jpegHeader(800, 600))).toEqual({ format: 'jpeg', width: 800, height: 600 });
  });

  it('reads GIF dimensions', () => {
    expect(parseImageHeader(gifHeader(128, 96))).toEqual({ format: 'gif', width: 128, height: 96 });
  });

  it('reads ICO dimensions and resolves 0 to 256', () => {
    expect(parseImageHeader(icoHeader(64, 64))).toEqual({ format: 'ico', width: 64, height: 64 });
    expect(parseImageHeader(icoHeader(256, 256))).toEqual({ format: 'ico', width: 256, height: 256 });
  });

  it('reads BMP dimensions', () => {
    expect(parseImageHeader(bmpHeader(96, 96))).toEqual({ format: 'bmp', width: 96, height: 96 });
  });

  it('reads WebP VP8X dimensions', () => {
    expect(parseImageHeader(webpVP8X(640, 480))).toEqual({ format: 'webp', width: 640, height: 480 });
  });

  it('reads SVG explicit width/height', () => {
    expect(parseImageHeader(SVG_FIXED)).toEqual({ format: 'svg', width: 512, height: 384 });
  });

  it('falls back to viewBox for SVG without explicit dims', () => {
    expect(parseImageHeader(SVG_VIEWBOX)).toEqual({ format: 'svg', width: 200, height: 200 });
  });

  it('returns null for random bytes', () => {
    expect(parseImageHeader(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]))).toBeNull();
  });
});

describe('bucketForNp', () => {
  it('flags large square as good', () => {
    expect(bucketForNp({ format: 'png', width: 512, height: 512 })).toBe('good');
  });

  it('flags 220px square as acceptable (not quite 256)', () => {
    expect(bucketForNp({ format: 'png', width: 220, height: 220 })).toBe('acceptable');
  });

  it('flags 64x64 favicons as poor', () => {
    expect(bucketForNp({ format: 'png', width: 64, height: 64 })).toBe('poor');
  });

  it('flags very wide banners as poor (gets cropped on NP)', () => {
    expect(bucketForNp({ format: 'png', width: 1200, height: 300 })).toBe('poor');
  });

  it('treats SVG as vector regardless of size', () => {
    expect(bucketForNp({ format: 'svg', width: 0, height: 0 })).toBe('vector');
    expect(bucketForNp({ format: 'svg', width: 32, height: 32 })).toBe('vector');
  });

  it('treats null probe as unknown', () => {
    expect(bucketForNp(null)).toBe('unknown');
  });
});
