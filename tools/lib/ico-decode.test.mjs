import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { decodeIco, looksLikeIco } from './ico-decode.mjs';

// Build a single-frame ICO container around one image blob.
function wrapIco(blob, w, h, bpp) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = w >= 256 ? 0 : w;
  entry[1] = h >= 256 ? 0 : h;
  entry[2] = 0; // palette colour count
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(bpp, 6);
  entry.writeUInt32LE(blob.length, 8);
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, blob]);
}

// A 2×2 32bpp BI_RGB DIB frame: top-left red, top-right green,
// bottom-left blue, bottom-right transparent. DIB rows are bottom-up.
function dib2x2_32() {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(2, 4); // biWidth
  header.writeInt32LE(4, 8); // biHeight = 2× (XOR + AND)
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bpp
  header.writeUInt32LE(0, 16); // BI_RGB
  // XOR bitmap, BGRA, bottom row first.
  const xor = Buffer.from([
    // image row 1 (bottom): blue, transparent
    255, 0, 0, 255, /* blue */ 0, 0, 0, 0 /* transparent */,
    // image row 0 (top): red, green
    0, 0, 255, 255, /* red */ 0, 255, 0, 255 /* green */,
  ]);
  // AND mask: 2 rows, 4-byte aligned, all opaque (ignored for 32bpp w/ alpha).
  const mask = Buffer.alloc(8);
  return Buffer.concat([header, xor, mask]);
}

describe('looksLikeIco', () => {
  it('accepts an icon header and rejects PNG', () => {
    expect(looksLikeIco(Buffer.from([0, 0, 1, 0, 1, 0]))).toBe(true);
    expect(looksLikeIco(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe('decodeIco — PNG-in-ICO', () => {
  it('returns the embedded PNG bytes, decodable by sharp', async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const ico = wrapIco(png, 64, 64, 32);
    const res = decodeIco(ico);
    expect(res?.kind).toBe('png');
    const meta = await sharp(res.bytes).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
  });
});

describe('decodeIco — 32bpp DIB', () => {
  it('decodes to top-down RGBA with the alpha channel preserved', () => {
    const ico = wrapIco(dib2x2_32(), 2, 2, 32);
    const res = decodeIco(ico);
    expect(res?.kind).toBe('raw');
    expect(res.width).toBe(2);
    expect(res.height).toBe(2);
    expect(res.channels).toBe(4);
    const px = (x, y) => Array.from(res.data.subarray((y * 2 + x) * 4, (y * 2 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([255, 0, 0, 255]); // red
    expect(px(1, 0)).toEqual([0, 255, 0, 255]); // green
    expect(px(0, 1)).toEqual([0, 0, 255, 255]); // blue
    expect(px(1, 1)).toEqual([0, 0, 0, 0]); // transparent
  });

  it('produces something sharp can re-encode to WebP', async () => {
    const ico = wrapIco(dib2x2_32(), 2, 2, 32);
    const res = decodeIco(ico);
    const webp = await sharp(res.data, {
      raw: { width: res.width, height: res.height, channels: 4 },
    })
      .webp()
      .toBuffer();
    expect(webp.length).toBeGreaterThan(0);
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe('webp');
  });
});

describe('decodeIco — rejects junk', () => {
  it('returns null for non-ICO bytes', () => {
    expect(decodeIco(Buffer.from([1, 2, 3, 4, 5, 6]))).toBe(null);
  });
});
