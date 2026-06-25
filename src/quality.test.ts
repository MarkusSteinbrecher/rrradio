import { describe, it, expect } from 'vitest';
import { streamQualityLevel, streamQualityBucket, stationQualityBucket } from './quality';

describe('streamQualityLevel', () => {
  it('treats lossless codecs as top tier regardless of bitrate', () => {
    for (const c of ['flac', 'alac', 'wav', 'pcm', 'FLAC']) {
      expect(streamQualityLevel(c, undefined)).toBe(4);
      expect(streamQualityLevel(c, 32)).toBe(4);
    }
  });

  it('returns level 1 when bitrate is missing or non-positive', () => {
    expect(streamQualityLevel('mp3', undefined)).toBe(1);
    expect(streamQualityLevel('aac', 0)).toBe(1);
    expect(streamQualityLevel(undefined, undefined)).toBe(1);
  });

  it('tiers AAC / Opus at 128 / 96 / 64', () => {
    expect(streamQualityLevel('aac', 128)).toBe(4);
    expect(streamQualityLevel('aac', 127)).toBe(3);
    expect(streamQualityLevel('opus', 96)).toBe(3);
    expect(streamQualityLevel('aac', 64)).toBe(2);
    expect(streamQualityLevel('aac', 63)).toBe(1);
  });

  it('tiers MP3 / MPEG at 192 / 128 / 96', () => {
    expect(streamQualityLevel('mp3', 192)).toBe(4);
    expect(streamQualityLevel('mp3', 128)).toBe(3);
    expect(streamQualityLevel('mpeg', 96)).toBe(2);
    expect(streamQualityLevel('mp3', 95)).toBe(1);
  });

  it('falls back to bitrate-only tiers for an unknown codec', () => {
    expect(streamQualityLevel('weirdcodec', 192)).toBe(4);
    expect(streamQualityLevel('', 128)).toBe(3);
    expect(streamQualityLevel(undefined, 96)).toBe(2);
    expect(streamQualityLevel(undefined, 95)).toBe(1);
  });

  it('is case- and whitespace-insensitive on the codec', () => {
    expect(streamQualityLevel('  AAC ', 128)).toBe(4);
    expect(streamQualityLevel('MP3', 192)).toBe(4);
  });
});

describe('streamQualityBucket', () => {
  it('maps levels 1–2 → low, 3 → medium, ≥4 → high', () => {
    expect(streamQualityBucket(1)).toBe('low');
    expect(streamQualityBucket(2)).toBe('low');
    expect(streamQualityBucket(3)).toBe('medium');
    expect(streamQualityBucket(4)).toBe('high');
  });
});

describe('stationQualityBucket', () => {
  it('buckets straight from a station shape', () => {
    expect(stationQualityBucket({ codec: 'aac', bitrate: 128 })).toBe('high');
    expect(stationQualityBucket({ codec: 'mp3', bitrate: 128 })).toBe('medium');
    expect(stationQualityBucket({ codec: 'mp3', bitrate: 64 })).toBe('low');
    expect(stationQualityBucket({})).toBe('low');
  });
});
