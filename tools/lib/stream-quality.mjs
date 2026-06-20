/**
 * Stream quality meter — the canonical 1–4 level derived from a stream's
 * `codec` + `bitrate`, per the published contract in
 * `docs/spec/contracts/catalog-schema.md` ("Stream quality model").
 *
 * This is the build-tools (`.mjs`) source of the thresholds. The catalog
 * collapse (`catalog-dedupe.mjs`) uses it to order a station's stream
 * variants best→worst and to bucket each into a `best`/`balanced`/`data`
 * tier. The web app re-derives the same meter for display; until a shared
 * `src/quality.ts` lands on `main` (it currently lives on the desktop
 * branch), this `.mjs` IS the single source of the level table — keep the
 * thresholds identical to the spec table if either side changes.
 *
 * Levels (rendered as filled bars elsewhere):
 *   4  lossless, or high-bitrate lossy
 *   3  good
 *   2  ok
 *   1  low / unknown bitrate
 */

/**
 * @param {string|null|undefined} codec
 * @param {number|null|undefined} bitrate kbps
 * @returns {1|2|3|4}
 */
export function streamQualityLevel(codec, bitrate) {
  const c = String(codec ?? '').trim().toLowerCase();

  // Lossless codecs are always the top tier, bitrate notwithstanding.
  if (c === 'flac' || c === 'alac' || c === 'wav' || c === 'pcm') return 4;

  const b = Number(bitrate);
  if (!Number.isFinite(b) || b <= 0) return 1; // no usable bitrate → lowest tier

  // AAC / Opus are more efficient — they hit a given perceptual quality at a
  // lower bitrate than MP3, so their thresholds sit lower.
  if (c.includes('aac') || c.includes('opus')) {
    if (b >= 128) return 4;
    if (b >= 96) return 3;
    if (b >= 64) return 2;
    return 1;
  }

  // MP3/MPEG and any other/unknown codec share the conservative thresholds.
  if (b >= 192) return 4;
  if (b >= 128) return 3;
  if (b >= 96) return 2;
  return 1;
}
