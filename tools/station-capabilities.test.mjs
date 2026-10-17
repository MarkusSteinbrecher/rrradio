import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_POLL_PRIORITIES,
  METADATA_STRATEGIES,
  buildStationCapabilities,
  buildStationCapabilitiesPayload,
} from './station-capabilities.mjs';
import { effectiveMetadataKey, tritonMount } from './lib/url-pattern-fetchers.mjs';

const manifest = {
  fetchers: {
    api: {
      broadcaster: 'test',
      schedule: true,
      program: true,
      providerCover: true,
      selfContained: false,
      notes: 'test fetcher',
    },
    triton: {
      broadcaster: null,
      schedule: false,
      program: false,
      providerCover: true,
      selfContained: true,
      notes: 'URL-pattern fetcher',
    },
    trackOnly: {
      broadcaster: 'test',
      schedule: false,
      program: false,
      providerCover: false,
      selfContained: false,
      notes: 'track-only fetcher',
    },
  },
};

describe('station capabilities', () => {
  it('classifies native metadata strategy and polling priority without probing streams', () => {
    const result = buildStationCapabilities([
      { id: 'api-station', status: 'working', metadata: 'api', metadataUrl: 'https://api.example/live', streamUrl: 'https://example.test/live.mp3' },
      { id: 'icy-station', status: 'icy-only', streamUrl: 'https://example.test/live.mp3' },
      { id: 'hls-station', status: 'icy-only', codec: 'HLS', streamUrl: 'https://example.test/live.m3u8' },
      { id: 'stream-station', status: 'stream-only', streamUrl: 'https://example.test/live.mp3' },
    ], manifest);

    expect(result.stations).toEqual([
      {
        id: 'api-station',
        status: 'working',
        metadataKey: 'api',
        metadataUrl: 'https://api.example/live',
        metadataStrategy: 'api',
        backgroundPollPriority: 'normal',
        hasProgram: true,
        hasSchedule: true,
        hasProviderCover: true,
      },
      {
        id: 'icy-station',
        status: 'icy-only',
        metadataKey: null,
        metadataUrl: null,
        metadataStrategy: 'icy',
        backgroundPollPriority: 'low',
        hasProgram: false,
        hasSchedule: false,
        hasProviderCover: false,
      },
      {
        id: 'hls-station',
        status: 'icy-only',
        metadataKey: null,
        metadataUrl: null,
        metadataStrategy: 'hls',
        backgroundPollPriority: 'low',
        hasProgram: false,
        hasSchedule: false,
        hasProviderCover: false,
      },
      {
        id: 'stream-station',
        status: 'stream-only',
        metadataKey: null,
        metadataUrl: null,
        metadataStrategy: 'none',
        backgroundPollPriority: 'never',
        hasProgram: false,
        hasSchedule: false,
        hasProviderCover: false,
      },
    ]);
  });

  it('includes fixed count buckets so native clients can validate the artifact quickly', () => {
    const result = buildStationCapabilities([
      { id: 'a', status: 'working', metadata: 'api', streamUrl: 'https://example.test/a.mp3' },
      { id: 'b', status: 'working', metadata: 'missing', streamUrl: 'https://example.test/b.mp3' },
      { id: 'c', status: 'stream-only', streamUrl: 'https://example.test/c.mp3' },
    ], manifest);

    expect(Object.keys(result.counts.byMetadataStrategy)).toEqual(METADATA_STRATEGIES);
    expect(Object.keys(result.counts.byBackgroundPollPriority)).toEqual(BACKGROUND_POLL_PRIORITIES);
    expect(result.counts).toMatchObject({
      stations: 3,
      knownFetcherStations: 1,
      unknownFetcherStations: 1,
      byMetadataStrategy: { api: 1, icy: 1, hls: 0, none: 1 },
      byBackgroundPollPriority: { normal: 1, low: 1, never: 1 },
    });
  });

  it('builds the stable artifact wrapper around per-station capabilities', () => {
    const payload = buildStationCapabilitiesPayload(
      [{ id: 'a', status: 'stream-only', streamUrl: 'https://example.test/a.mp3' }],
      manifest,
      {
        generatedAt: '2026-05-22T00:00:00.000Z',
        schema: 'test schema',
        sourceCatalog: 'public/test.json',
        sourceManifest: 'src/fetchers.json',
      },
    );

    expect(payload).toMatchObject({
      $schema: 'test schema',
      generatedAt: '2026-05-22T00:00:00.000Z',
      sourceCatalog: 'public/test.json',
      sourceManifest: 'src/fetchers.json',
      counts: { stations: 1 },
      stations: [{ id: 'a', metadataStrategy: 'none', backgroundPollPriority: 'never' }],
    });
  });

  it('wires *.streamtheworld.com streams to the URL-pattern Triton fetcher (#233)', () => {
    const result = buildStationCapabilities([
      { id: 'triton', status: 'stream-only', streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/KKMGFM.mp3' },
      { id: 'triton-sc', status: 'stream-only', streamUrl: 'https://18393.live.streamtheworld.com/CONCIERTO_SC' },
      { id: 'keyed', status: 'working', metadata: 'api', streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/X.mp3' },
      { id: 'lookalike', status: 'stream-only', streamUrl: 'https://notstreamtheworld.com/KKMGFM.mp3' },
    ], manifest);

    expect(result.stations.map((s) => [s.id, s.metadataKey, s.metadataStrategy, s.backgroundPollPriority, s.hasProviderCover])).toEqual([
      ['triton', 'triton', 'api', 'normal', true],
      ['triton-sc', 'triton', 'api', 'normal', true],
      ['keyed', 'api', 'api', 'normal', true],
      ['lookalike', null, 'none', 'never', false],
    ]);
    expect(result.counts.knownFetcherStations).toBe(3);
  });
});

describe('url-pattern fetchers', () => {
  it('mirrors tritonMount() from src/triton.ts', () => {
    expect(tritonMount('https://playerservices.streamtheworld.com/api/livestream-redirect/HRT_RADIO1AAC.aac')).toBe('HRT_RADIO1AAC');
    expect(tritonMount('https://x.live.streamtheworld.com/CONCIERTO_SC')).toBe('CONCIERTO');
    expect(tritonMount('https://x.live.streamtheworld.com/BONTONAAC.aac;stream')).toBe('BONTONAAC');
    expect(tritonMount('https://STREAMTHEWORLD.COM/A.mp3')).toBe('A');
    expect(tritonMount('https://evilstreamtheworld.com/A.mp3')).toBeNull();
    expect(tritonMount('https://x.streamtheworld.com/')).toBeNull();
    expect(tritonMount('not a url')).toBeNull();
  });

  it('prefers the catalog metadata key over URL patterns', () => {
    const url = 'https://x.live.streamtheworld.com/KKMGFM.mp3';
    expect(effectiveMetadataKey({ metadata: 'bbc', streamUrl: url })).toBe('bbc');
    expect(effectiveMetadataKey({ streamUrl: url })).toBe('triton');
    expect(effectiveMetadataKey({ streamUrl: 'https://example.test/a.mp3' })).toBeNull();
  });
});
