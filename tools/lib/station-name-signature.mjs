// Noise tokens stripped before forming a station-name signature: delivery
// format, codec, and bitrate markers that vary between feeds of the same
// station but carry no identity.
export const NAME_NOISE_TOKENS = new Set([
  'live', 'online', 'web', 'radio', 'fm', 'am', 'stream', 'streaming',
  'hd', 'hq', 'sd', 'stereo', 'mono', 'official',
  'hls', 'http', 'https', 'm3u8',
  'mp3', 'aac', 'aacp', 'flac', 'ogg', 'opus',
  '32', '48', '56', '64', '80', '96', '112', '128', '160', '192', '224', '256', '320',
  '32k', '48k', '56k', '64k', '80k', '96k', '112k', '128k', '160k', '192k', '224k', '256k', '320k',
  'kbps', 'kbit', 'kbits',
]);

/**
 * Tokenise a station name into identity-bearing, noise-stripped tokens.
 *
 * Unicode-aware: we keep letters and numbers of *every* script (`\p{L}\p{N}`)
 * rather than only `[a-z0-9]`. Stripping non-ASCII used to collapse distinct
 * non-Latin channels of one broadcaster onto their shared Latin brand token
 * (e.g. every "BRTV北京…广播" → "brtv"), silently over-merging them in the
 * dedupe DB. A space is inserted at ASCII↔non-ASCII boundaries so a Latin
 * brand prefix tokenises apart from the localized name ("BRTV北京新闻" →
 * `brtv` + `北京新闻`).
 *
 * @param {string} name
 * @returns {string[]} tokens in source order, noise tokens removed
 */
export function nameTokens(name) {
  const normalised = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop Latin combining diacritics
    .replace(/\b([a-z]+[a-z0-9]*\d[a-z0-9]*)live\b/g, '$1 live') // br24live → br24 live
    .replace(/([a-z0-9])([^\x00-\x7f])/g, '$1 $2') // ASCII↔non-ASCII boundary
    .replace(/([^\x00-\x7f])([a-z0-9])/g, '$1 $2') // (brand prefix splits from script)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!normalised) return [];
  return normalised.split(' ').filter((t) => t && !NAME_NOISE_TOKENS.has(t));
}

/**
 * Order-independent signature: noise-stripped tokens, sorted, joined.
 * Two names with the same identity tokens in any order share a signature.
 */
export function nameSignature(name) {
  return [...nameTokens(name)].sort().join(' ');
}

/**
 * Channel-discriminator signature: the pure-digit identity tokens of a name,
 * sorted and joined. Stops fuzzy stream signals (e.g. streamFingerprint) from
 * bridging different numbered channels of one broadcaster — "SRF 3" (`3`) must
 * not merge with "SRF 4 News" (`4`) just because a mislabelled RB entry shares
 * their stream path. Built on `nameTokens`, so a digit embedded in a brand
 * token is NOT a discriminator ("BR24" → '', "1LIVE" → '') and bitrate-like
 * numbers (already noise-stripped) never leak in.
 */
export function numberSignature(name) {
  return nameTokens(name).filter((t) => /^\d+$/.test(t)).sort().join(' ');
}
