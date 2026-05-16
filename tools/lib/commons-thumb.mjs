/**
 * Transform a Wikimedia Commons SVG URL into its auto-rasterised PNG
 * thumbnail URL. iOS' `UIImage(data:)` and vanilla Android Coil don't
 * decode SVG; Wikimedia's `/thumb/.../<size>px-<file>.svg.png` endpoint
 * rasterises any Commons SVG on demand and serves it through their CDN,
 * so every client renders the logo identically with no client-side dep
 * and no per-file build step.
 *
 * Size policy: Wikimedia enforces a per-file allow-list of thumb widths
 * (the set the Commons File: page exposes in its srcset). 500 is on
 * that list for every SVG we've shipped so far — empirically verified
 * against 20 catalog rows. If a future SVG rejects 500, the
 * probe-logos report will flag the row as HTTP 400 and curation
 * re-runs through `wiki-logos`.
 */

/** @param {string} url  @param {number} [size=500] */
export function commonsSvgToPngThumb(url, size = 500) {
  const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/(.+\.svg)$/i.exec(url);
  if (!m) return url;
  const [, base, h1, h2, file] = m;
  return `${base}/thumb/${h1}/${h2}/${file}/${size}px-${file}.png`;
}
