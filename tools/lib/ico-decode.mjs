/**
 * Minimal ICO/CUR decoder for the favicon pipeline.
 *
 * sharp/libvips cannot decode ICO, yet ~8% of the catalog's remote favicons
 * are `.ico` (broadcasters still serve `/favicon.ico`). This picks the best
 * frame in the icon directory — largest area, then highest colour depth —
 * and returns something sharp can ingest directly:
 *
 *   - PNG-in-ICO → { kind: 'png', bytes }                 (modern 256px icons)
 *   - DIB frame  → { kind: 'raw', width, height, channels: 4, data }  (RGBA)
 *
 * DIB support covers the BI_RGB depths that appear in real favicons —
 * 32 / 24 / 8 / 4 / 1 bpp — including the trailing 1-bit AND transparency
 * mask. Anything exotic (BI_BITFIELDS, RLE, JPEG-in-ICO, truncated data)
 * returns `null`, and the caller ships no variant for that station so the
 * client falls back to the original `favicon` URL.
 */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** @param {Uint8Array} b */
export function looksLikeIco(b) {
  // reserved(0,0) type(1=icon,2=cursor) count>0
  return (
    b.length >= 6 &&
    b[0] === 0 &&
    b[1] === 0 &&
    (b[2] === 1 || b[2] === 2) &&
    b[3] === 0 &&
    (b[4] | (b[5] << 8)) > 0
  );
}

/**
 * @param {Buffer|Uint8Array} buf
 * @returns {{kind:'png', bytes:Buffer}
 *          | {kind:'raw', width:number, height:number, channels:4, data:Buffer}
 *          | null}
 */
export function decodeIco(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (!looksLikeIco(b)) return null;
  const count = b.readUInt16LE(4);

  // Pick the best entry: largest pixel area, ties broken by colour depth.
  let best = null;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    if (o + 16 > b.length) break;
    const w = b[o] === 0 ? 256 : b[o];
    const h = b[o + 1] === 0 ? 256 : b[o + 1];
    const bpp = b.readUInt16LE(o + 6);
    const size = b.readUInt32LE(o + 8);
    const offset = b.readUInt32LE(o + 12);
    if (offset + size > b.length || size === 0) continue;
    const score = w * h * 1000 + bpp; // area dominates, depth breaks ties
    if (!best || score > best.score) best = { w, h, bpp, size, offset, score };
  }
  if (!best) return null;

  const frame = b.subarray(best.offset, best.offset + best.size);

  // PNG-in-ICO: hand the embedded PNG straight to sharp.
  if (frame.length >= 8 && PNG_SIG.every((v, i) => frame[i] === v)) {
    return { kind: 'png', bytes: Buffer.from(frame) };
  }

  return decodeDib(frame, best.w, best.h);
}

/**
 * Decode a BITMAPINFOHEADER DIB frame (no BITMAPFILEHEADER) to top-down RGBA.
 * `dirW`/`dirH` come from the icon directory entry and win when the header's
 * own dimensions look wrong (the DIB height doubles to cover the AND mask).
 */
function decodeDib(frame, dirW, dirH) {
  if (frame.length < 40) return null;
  const headerSize = frame.readUInt32LE(0);
  if (headerSize < 40) return null; // BITMAPCOREHEADER etc. — not seen in favicons
  const biWidth = frame.readInt32LE(4);
  const biHeightField = frame.readInt32LE(8);
  const bpp = frame.readUInt16LE(14);
  const compression = frame.readUInt32LE(16);
  if (compression !== 0) return null; // only BI_RGB; skip BITFIELDS/RLE/JPEG/PNG
  let clrUsed = frame.readUInt32LE(32);

  const width = biWidth || dirW;
  // ICO DIB height encodes XOR+AND stacked, so it is twice the real height.
  const topDown = biHeightField < 0;
  const absH = Math.abs(biHeightField);
  const height = absH === dirH ? absH : Math.floor(absH / 2) || dirH;
  if (width <= 0 || height <= 0 || width > 1024 || height > 1024) return null;

  // Palette (BGRA, 4 bytes each) for indexed depths.
  const hasPalette = bpp <= 8;
  if (hasPalette && clrUsed === 0) clrUsed = 1 << bpp;
  const paletteOffset = headerSize;
  const paletteBytes = hasPalette ? clrUsed * 4 : 0;
  const xorOffset = paletteOffset + paletteBytes;

  const rowStride = (((width * bpp + 31) >> 5) << 2); // 4-byte aligned
  const xorSize = rowStride * height;
  if (xorOffset + xorSize > frame.length) return null;

  // AND mask: 1bpp, 4-byte-aligned rows, immediately after the XOR bitmap.
  const maskStride = (((width + 31) >> 5) << 2);
  const maskOffset = xorOffset + xorSize;
  const hasMask = maskOffset + maskStride * height <= frame.length;

  const out = Buffer.alloc(width * height * 4);

  const readPixel =
    bpp === 32
      ? (rowBase, x) => {
          const p = rowBase + x * 4;
          return [frame[p + 2], frame[p + 1], frame[p], frame[p + 3]]; // BGRA→RGBA
        }
      : bpp === 24
        ? (rowBase, x) => {
            const p = rowBase + x * 3;
            return [frame[p + 2], frame[p + 1], frame[p], 255];
          }
        : (rowBase, x) => {
            const idx = readIndex(frame, rowBase, x, bpp);
            const pe = paletteOffset + idx * 4;
            return [frame[pe + 2], frame[pe + 1], frame[pe], 255];
          };

  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y; // DIB rows are bottom-up
    const rowBase = xorOffset + srcY * rowStride;
    const dstRow = y * width * 4;
    for (let x = 0; x < width; x++) {
      const [r, g, bl, a] = readPixel(rowBase, x);
      const d = dstRow + x * 4;
      out[d] = r;
      out[d + 1] = g;
      out[d + 2] = bl;
      out[d + 3] = a;
      if (a !== 255) anyAlpha = true;
    }
  }

  // Apply the 1-bit AND mask (1 = transparent). For 32bpp icons that already
  // carry a real alpha channel we leave it alone; many such icons ship a
  // junk all-opaque AND mask that would otherwise erase nothing anyway.
  if (hasMask && !(bpp === 32 && anyAlpha)) {
    for (let y = 0; y < height; y++) {
      const srcY = topDown ? y : height - 1 - y;
      const mRow = maskOffset + srcY * maskStride;
      const dstRow = y * width * 4;
      for (let x = 0; x < width; x++) {
        const bit = (frame[mRow + (x >> 3)] >> (7 - (x & 7))) & 1;
        if (bit) out[dstRow + x * 4 + 3] = 0;
      }
    }
  }

  return { kind: 'raw', width, height, channels: 4, data: out };
}

function readIndex(frame, rowBase, x, bpp) {
  if (bpp === 8) return frame[rowBase + x];
  if (bpp === 4) {
    const byte = frame[rowBase + (x >> 1)];
    return (x & 1) === 0 ? byte >> 4 : byte & 0x0f;
  }
  // bpp === 1
  const byte = frame[rowBase + (x >> 3)];
  return (byte >> (7 - (x & 7))) & 1;
}
