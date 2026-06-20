import { describe, expect, it } from 'vitest';
import { streamQualityLevel } from './stream-quality.mjs';

describe('streamQualityLevel', () => {
  it('rates lossless codecs at the top tier regardless of bitrate', () => {
    for (const codec of ['FLAC', 'alac', 'WAV', 'pcm']) {
      expect(streamQualityLevel(codec, 0)).toBe(4);
      expect(streamQualityLevel(codec, undefined)).toBe(4);
      expect(streamQualityLevel(codec, 999)).toBe(4);
    }
  });

  it('returns the lowest tier when bitrate is missing or zero', () => {
    expect(streamQualityLevel('MP3', 0)).toBe(1);
    expect(streamQualityLevel('AAC', undefined)).toBe(1);
    expect(streamQualityLevel('MP3', null)).toBe(1);
    expect(streamQualityLevel(undefined, undefined)).toBe(1);
  });

  it('uses the efficient thresholds for AAC / Opus', () => {
    expect(streamQualityLevel('AAC', 128)).toBe(4);
    expect(streamQualityLevel('aac', 96)).toBe(3);
    expect(streamQualityLevel('AAC+', 64)).toBe(2);
    expect(streamQualityLevel('opus', 48)).toBe(1);
    expect(streamQualityLevel('OPUS', 96)).toBe(3);
  });

  it('uses the conservative thresholds for MP3 / MPEG / unknown', () => {
    expect(streamQualityLevel('MP3', 192)).toBe(4);
    expect(streamQualityLevel('mpeg', 128)).toBe(3);
    expect(streamQualityLevel('MP3', 96)).toBe(2);
    expect(streamQualityLevel('MP3', 64)).toBe(1);
    // Unknown codec falls through to the MP3 table.
    expect(streamQualityLevel('weird', 192)).toBe(4);
    expect(streamQualityLevel('', 128)).toBe(3);
  });

  it('orders the FM4 variants (192k MP3 best, 128k MP3 below)', () => {
    expect(streamQualityLevel('MP3', 192)).toBeGreaterThan(streamQualityLevel('MP3', 128));
  });

  it('is case- and whitespace-insensitive on codec', () => {
    expect(streamQualityLevel('  Flac ', 0)).toBe(4);
    expect(streamQualityLevel('  AaC ', 128)).toBe(4);
  });
});
