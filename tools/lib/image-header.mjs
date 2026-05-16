/**
 * Minimal image-header parser — extracts {format, width, height} from the
 * first ~64 KB of an image file. Covers the formats present in our catalog
 * (PNG, JPEG, GIF, ICO, BMP, WebP, SVG) without pulling in a dependency.
 *
 * Returns `null` when the bytes don't match a known signature. Callers
 * decide what "unknown" means — typically a separate bucket from "poor".
 */

const TEXT = new TextDecoder('utf-8', { fatal: false });

/** @param {Uint8Array} buf */
export function parseImageHeader(buf) {
  if (!buf || buf.length < 4) return null;
  if (isPng(buf))  return parsePng(buf);
  if (isJpeg(buf)) return parseJpeg(buf);
  if (isGif(buf))  return parseGif(buf);
  if (isWebp(buf)) return parseWebp(buf);
  if (isBmp(buf))  return parseBmp(buf);
  if (isIco(buf))  return parseIco(buf);
  if (isSvg(buf))  return parseSvg(buf);
  return null;
}

// ── format detection ─────────────────────────────────────────────────────

function isPng(b) {
  return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
}
function isJpeg(b) { return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; }
function isGif(b) {
  return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
      && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;
}
function isWebp(b) {
  return b.length >= 12
      && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
}
function isBmp(b) { return b[0] === 0x42 && b[1] === 0x4d; }
function isIco(b) {
  return b.length >= 6 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0;
}
function isSvg(b) {
  // SVG can have a BOM, XML decl, comments, or doctype before the root.
  // Cheap check: decode the first ~512 bytes and look for the <svg tag.
  const head = TEXT.decode(b.subarray(0, Math.min(b.length, 512)));
  return /<svg[\s>]/i.test(head);
}

// ── per-format readers ───────────────────────────────────────────────────

function parsePng(b) {
  // IHDR is always the first chunk, starting at byte 16.
  if (b.length < 24) return null;
  return {
    format: 'png',
    width:  readU32BE(b, 16),
    height: readU32BE(b, 20),
  };
}

function parseJpeg(b) {
  // Walk the JFIF marker chain looking for a Start-Of-Frame (SOFn) segment.
  // SOFn ∈ {C0..CF} \ {C4, C8, CC}.
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    // Skip fill bytes (FF padding before a marker).
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) return null;
    const marker = b[i]; i++;
    if (marker === 0xd8 || marker === 0xd9) return null; // SOI/EOI — no SOF
    if (i + 1 >= b.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOF payload: length(2) + precision(1) + height(2) + width(2).
      // We don't need the rest of the segment, so don't bounds-check segLen.
      if (i + 7 > b.length) return null;
      return {
        format: 'jpeg',
        width:  readU16BE(b, i + 5),
        height: readU16BE(b, i + 3),
      };
    }
    const segLen = readU16BE(b, i);
    if (segLen < 2 || i + segLen > b.length) return null;
    i += segLen;
  }
  return null;
}

function parseGif(b) {
  if (b.length < 10) return null;
  return {
    format: 'gif',
    width:  readU16LE(b, 6),
    height: readU16LE(b, 8),
  };
}

function parseWebp(b) {
  // RIFF[..][..]WEBP{chunk-fourcc}[size]...
  if (b.length < 30) return null;
  const fourcc = TEXT.decode(b.subarray(12, 16));
  if (fourcc === 'VP8 ') {
    // Lossy: width/height at byte 26 (low 14 bits each).
    if (b.length < 30) return null;
    const w = readU16LE(b, 26) & 0x3fff;
    const h = readU16LE(b, 28) & 0x3fff;
    return { format: 'webp', width: w, height: h };
  }
  if (fourcc === 'VP8L') {
    // Lossless: 14-bit width-1, 14-bit height-1, packed.
    if (b.length < 25) return null;
    const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
    const w = 1 + (((b1 & 0x3f) << 8) | b0);
    const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { format: 'webp', width: w, height: h };
  }
  if (fourcc === 'VP8X') {
    // Extended: 24-bit width-1 at byte 24, 24-bit height-1 at byte 27.
    if (b.length < 30) return null;
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { format: 'webp', width: w, height: h };
  }
  return null;
}

function parseBmp(b) {
  if (b.length < 26) return null;
  // BITMAPINFOHEADER: width(4 LE) and height(4 LE, signed) at byte 18 and 22.
  const w = readI32LE(b, 18);
  const h = readI32LE(b, 22);
  return { format: 'bmp', width: Math.abs(w), height: Math.abs(h) };
}

function parseIco(b) {
  // Header: reserved(2) type(2) count(2). Then a directory of 16-byte entries.
  // Each entry: w(1) h(1) ncolors(1) reserved(1) planes(2) bpp(2) size(4) offset(4).
  // 0 means "256". Pick the largest entry — that's the "best" representation.
  if (b.length < 22) return null;
  const count = readU16LE(b, 4);
  let best = { w: 0, h: 0 };
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    if (off + 16 > b.length) break;
    const w = b[off] === 0 ? 256 : b[off];
    const h = b[off + 1] === 0 ? 256 : b[off + 1];
    if (w * h > best.w * best.h) best = { w, h };
  }
  if (best.w === 0) return null;
  return { format: 'ico', width: best.w, height: best.h };
}

function parseSvg(b) {
  // SVG is a vector format — "dimensions" are nominal. Read width/height
  // attributes if literal, fall back to viewBox. Anything goes; we return
  // 0/0 to signal "vector — scales".
  const head = TEXT.decode(b.subarray(0, Math.min(b.length, 4096)));
  const m = /<svg\b([^>]*)>/i.exec(head);
  if (!m) return { format: 'svg', width: 0, height: 0 };
  const attrs = m[1];
  const w = parseSvgLength(/\bwidth\s*=\s*"([^"]+)"/i.exec(attrs)?.[1]);
  const h = parseSvgLength(/\bheight\s*=\s*"([^"]+)"/i.exec(attrs)?.[1]);
  if (w && h) return { format: 'svg', width: w, height: h };
  const vb = /\bviewBox\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { format: 'svg', width: parts[2], height: parts[3] };
    }
  }
  // Vector with no nominal size — scales to whatever the layout demands.
  return { format: 'svg', width: 0, height: 0 };
}

function parseSvgLength(raw) {
  if (!raw) return 0;
  const m = /^(\d+(?:\.\d+)?)(?:px)?/i.exec(raw.trim());
  return m ? Math.round(parseFloat(m[1])) : 0;
}

// ── byte helpers ─────────────────────────────────────────────────────────

function readU16BE(b, o) { return (b[o] << 8) | b[o + 1]; }
function readU32BE(b, o) {
  return (b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
}
function readU16LE(b, o) { return b[o] | (b[o + 1] << 8); }
function readI32LE(b, o) {
  const u = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
  return u | 0; // coerce to signed
}

// ── quality bucket ───────────────────────────────────────────────────────

/**
 * Bucket a probed image for NP-page suitability.
 *  good       — fills the 220px (×2 retina = 440px) frame cleanly, square-ish
 *  acceptable — visible at native size, no blur, slight non-square OK
 *  poor       — too small to fill the frame, or extreme aspect (gets cropped)
 *  vector     — SVG, always crisp
 *  unknown    — unsupported/unparseable
 */
export function bucketForNp(probe) {
  if (!probe) return 'unknown';
  if (probe.format === 'svg') return 'vector';
  const w = probe.width, h = probe.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'unknown';
  const min = Math.min(w, h);
  const aspect = w / h;
  const squareIsh = aspect >= 0.9 && aspect <= 1.1;
  const tolerable = aspect >= 0.7 && aspect <= 1.4;
  if (min >= 256 && squareIsh) return 'good';
  if (min >= 128 && tolerable) return 'acceptable';
  if (min >= 96 && squareIsh) return 'acceptable';
  return 'poor';
}
