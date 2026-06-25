// Stream-quality classification, ported verbatim from the iOS app's
// `StreamQuality.swift` so web and native Browse filters agree on what
// counts as Low / Medium / High. A 1–4 level is derived from codec +
// bitrate, then bucketed (levels 1–2 → low, 3 → medium, ≥4 → high).

export type QualityBucket = 'low' | 'medium' | 'high';

/** Derive a 1–4 stream-quality level from codec + bitrate.
 *  Mirrors rrradio-ios `streamQualityLevel(codec:bitrate:)`. */
export function streamQualityLevel(codec?: string | null, bitrate?: number | null): number {
  const c = (codec ?? '').trim().toLowerCase();

  // Lossless codecs are always the top tier, bitrate notwithstanding.
  if (c === 'flac' || c === 'alac' || c === 'wav' || c === 'pcm') return 4;

  // No usable bitrate → lowest tier.
  if (!bitrate || bitrate <= 0) return 1;

  if (c.includes('aac') || c.includes('opus')) {
    if (bitrate >= 128) return 4;
    if (bitrate >= 96) return 3;
    if (bitrate >= 64) return 2;
    return 1;
  }
  if (c.includes('mp3') || c.includes('mpeg')) {
    if (bitrate >= 192) return 4;
    if (bitrate >= 128) return 3;
    if (bitrate >= 96) return 2;
    return 1;
  }
  // Unknown codec — fall back to bitrate-only tiers.
  if (bitrate >= 192) return 4;
  if (bitrate >= 128) return 3;
  if (bitrate >= 96) return 2;
  return 1;
}

/** Map a 1–4 level to a Low/Medium/High bucket.
 *  Mirrors `streamQualityBucket(forLevel:)`. */
export function streamQualityBucket(level: number): QualityBucket {
  if (level <= 2) return 'low';
  if (level === 3) return 'medium';
  return 'high';
}

/** Convenience: bucket straight from a station's codec + bitrate. */
export function stationQualityBucket(s: {
  codec?: string | null;
  bitrate?: number | null;
}): QualityBucket {
  return streamQualityBucket(streamQualityLevel(s.codec, s.bitrate));
}
