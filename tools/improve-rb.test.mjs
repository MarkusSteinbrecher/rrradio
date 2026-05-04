import { describe, expect, it } from 'vitest';
import {
  computeCrossCountryDupes,
  computeDeadStreams,
  computeInternalDupes,
  computeMetadataAPIs,
} from './improve-rb.mjs';

const station = (overrides) => ({
  stationuuid: 'uuid-1',
  name: 'Sample',
  streamUrl: 'https://example/stream',
  votes: 0,
  duplicateOf: null,
  verdict: 'ok',
  verdictReason: '',
  probedAt: '2026-04-29T00:00:00.000Z',
  ...overrides,
});

describe('computeDeadStreams', () => {
  it('returns broken-network and broken-format stations', () => {
    const out = computeDeadStreams({
      stations: [
        station({ stationuuid: 'a', verdict: 'ok' }),
        station({ stationuuid: 'b', verdict: 'broken-network', verdictReason: 'ECONNREFUSED' }),
        station({ stationuuid: 'c', verdict: 'broken-format', verdictReason: 'no audio mime' }),
        station({ stationuuid: 'd', verdict: 'broken-mixed' }), // not dead, http-only
      ],
    });
    expect(out.map((s) => s.stationuuid)).toEqual(['b', 'c']);
    expect(out[0].verdictReason).toBe('ECONNREFUSED');
    expect(out[0].lastProbedAt).toBe('2026-04-29T00:00:00.000Z');
  });

  it('sorts by votes desc', () => {
    const out = computeDeadStreams({
      stations: [
        station({ stationuuid: 'low', verdict: 'broken-network', votes: 1 }),
        station({ stationuuid: 'high', verdict: 'broken-network', votes: 100 }),
        station({ stationuuid: 'mid', verdict: 'broken-network', votes: 10 }),
      ],
    });
    expect(out.map((s) => s.stationuuid)).toEqual(['high', 'mid', 'low']);
  });

  it('handles empty input', () => {
    expect(computeDeadStreams({ stations: [] })).toEqual([]);
    expect(computeDeadStreams({})).toEqual([]);
  });
});

describe('computeInternalDupes', () => {
  it('groups variants by canonical uuid', () => {
    const canonical = station({ stationuuid: 'A', name: 'FM4', votes: 1000 });
    const v1 = station({
      stationuuid: 'B',
      name: 'FM4 ORF HQ',
      streamUrl: 'https://example/fm4-aac',
      bitrate: 96,
      duplicateOf: 'A',
      votes: 5,
    });
    const v2 = station({
      stationuuid: 'C',
      name: 'FM4 ORF',
      streamUrl: 'https://example/fm4-mp3',
      bitrate: 192,
      duplicateOf: 'A',
      votes: 50,
    });
    const out = computeInternalDupes({ stations: [canonical, v1, v2] });
    expect(out).toHaveLength(1);
    expect(out[0].canonical.stationuuid).toBe('A');
    // Variants sorted by votes desc
    expect(out[0].variants.map((v) => v.stationuuid)).toEqual(['C', 'B']);
  });

  it('reports which fields differ in each variant', () => {
    const canonical = station({
      stationuuid: 'A',
      name: 'FM4',
      streamUrl: 'https://x/a',
      bitrate: 192,
      codec: 'MP3',
    });
    const v = station({
      stationuuid: 'B',
      name: 'FM4',
      streamUrl: 'https://x/b',
      bitrate: 96,
      codec: 'AAC',
      duplicateOf: 'A',
    });
    const out = computeInternalDupes({ stations: [canonical, v] });
    expect(out[0].variants[0].differs.sort()).toEqual(['bitrate', 'codec', 'url']);
  });

  it('skips variants whose canonical is not in the file', () => {
    const orphan = station({ stationuuid: 'B', duplicateOf: 'NOT-IN-FILE' });
    const out = computeInternalDupes({ stations: [orphan] });
    expect(out).toEqual([]);
  });

  it('sorts clusters by canonical votes desc', () => {
    const stations = [
      station({ stationuuid: 'A1', name: 'A', votes: 10 }),
      station({ stationuuid: 'A2', duplicateOf: 'A1' }),
      station({ stationuuid: 'B1', name: 'B', votes: 100 }),
      station({ stationuuid: 'B2', duplicateOf: 'B1' }),
    ];
    const out = computeInternalDupes({ stations });
    expect(out.map((c) => c.canonical.stationuuid)).toEqual(['B1', 'A1']);
  });
});

describe('computeMetadataAPIs', () => {
  const broadcasters = { orf: { name: 'ORF', country: 'AT', metadataUrl: 'https://api/' } };

  it('emits stations with explicit metadataUrl in the country', () => {
    const stations = [
      { stationuuid: 'fm4-uuid', name: 'FM4', broadcaster: 'orf', country: 'AT', metadataUrl: 'https://fm4/api' },
      { stationuuid: 'other', name: 'Other', broadcaster: 'orf', country: 'DE' }, // wrong country
      { stationuuid: 'no-md', name: 'NoMd', broadcaster: 'unknown', country: 'AT' },  // no metadataUrl
    ];
    const out = computeMetadataAPIs('AT', stations, broadcasters);
    expect(out).toHaveLength(1);
    expect(out[0].stationuuid).toBe('fm4-uuid');
    expect(out[0].metadataUrl).toBe('https://fm4/api');
  });

  it('inherits metadataUrl + country from the broadcaster', () => {
    const stations = [
      { stationuuid: 'oe1-uuid', name: 'Ö1', broadcaster: 'orf' }, // no country, no metadataUrl
    ];
    const out = computeMetadataAPIs('AT', stations, broadcasters);
    expect(out).toHaveLength(1);
    expect(out[0].metadataUrl).toBe('https://api/');
  });

  it('skips stations without a stationuuid (cant link to RB)', () => {
    const stations = [{ name: 'No UUID', broadcaster: 'orf', country: 'AT', metadataUrl: 'https://x' }];
    expect(computeMetadataAPIs('AT', stations, broadcasters)).toEqual([]);
  });
});

describe('computeCrossCountryDupes', () => {
  it('emits uuids appearing in multiple country files', () => {
    const out = computeCrossCountryDupes({
      DE: { stations: [station({ stationuuid: 'shared', name: 'Shared FM', votes: 100 })] },
      CH: { stations: [station({ stationuuid: 'shared', name: 'Shared FM', votes: 50 })] },
      AT: { stations: [station({ stationuuid: 'unique', name: 'Solo' })] },
    });
    expect(out).toHaveLength(1);
    expect(out[0].stationuuid).toBe('shared');
    expect(out[0].listedIn).toEqual(['CH', 'DE']);
  });

  it('primaryGuess picks the country with highest votes for that uuid', () => {
    const out = computeCrossCountryDupes({
      DE: { stations: [station({ stationuuid: 'x', name: 'X', votes: 50 })] },
      FR: { stations: [station({ stationuuid: 'x', name: 'X', votes: 200 })] },
    });
    expect(out[0].primaryGuess).toBe('FR');
  });

  it('handles empty input', () => {
    expect(computeCrossCountryDupes({})).toEqual([]);
  });
});
