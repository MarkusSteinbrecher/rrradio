import { describe, it, expect } from 'vitest';
import {
  classifyStream,
  classifyHttps,
  classifyIcy,
  createClassifiers,
  failureClass,
  toObservation,
} from './probe-classify.mjs';
import { normaliseObservation } from './observations.mjs';

const MANIFEST = {
  fetchers: {
    grrif: { program: true },
    'soma-fm': { selfContained: true },
    wdr: {},
  },
  wireableBroadcasters: ['ard'],
};

describe('classifyStream', () => {
  it('is ok for an audio content-type', () => {
    expect(classifyStream({ status: 200, contentType: 'audio/mpeg' })).toEqual({ v: 'ok', d: 'audio/mpeg' });
  });

  it('accepts HLS manifests and octet-stream as audio-like', () => {
    expect(classifyStream({ status: 200, contentType: 'application/vnd.apple.mpegurl' }).v).toBe('ok');
    expect(classifyStream({ status: 200, contentType: 'application/octet-stream' }).v).toBe('ok');
  });

  it('warns on a non-audio content-type', () => {
    expect(classifyStream({ status: 200, contentType: 'text/html' })).toEqual({
      v: 'warn',
      d: 'content-type "text/html"',
    });
    expect(classifyStream({ status: 200, contentType: '' })).toEqual({ v: 'warn', d: 'content-type "?"' });
  });

  it('is bad on a 4xx/5xx status or a transport error', () => {
    expect(classifyStream({ status: 404 })).toEqual({ v: 'bad', d: 'HTTP 404' });
    expect(classifyStream({ status: 503 })).toEqual({ v: 'bad', d: 'HTTP 503' });
    expect(classifyStream({ status: 'failed', errorToken: 'timeout' })).toEqual({ v: 'bad', d: 'timeout' });
  });
});

describe('classifyHttps', () => {
  it('is ok only for https', () => {
    expect(classifyHttps('https://x/y')).toEqual({ v: 'ok' });
    expect(classifyHttps('HTTPS://x/y')).toEqual({ v: 'ok' });
    expect(classifyHttps('http://x/y')).toEqual({ v: 'bad', d: 'http (mixed content)' });
    expect(classifyHttps(null).v).toBe('bad');
  });
});

describe('classifyIcy', () => {
  it('is na for HLS', () => {
    expect(classifyIcy({ status: 200 }, 'hls').v).toBe('na');
  });

  it('ranks seen title > advertised metaint > nothing', () => {
    expect(classifyIcy({ icySeen: true, metaintAdvertised: true }, 'AAC').v).toBe('ok');
    expect(classifyIcy({ icySeen: false, metaintAdvertised: true }, 'AAC').v).toBe('warn');
    expect(classifyIcy({ icySeen: false, metaintAdvertised: false }, 'AAC').v).toBe('bad');
  });
});

describe('failureClass', () => {
  it.each(['HTTP 404', 'HTTP 410', 'dns', 'refused', 'no-url'])('%s is hard', (detail) => {
    expect(failureClass(detail)).toBe('hard');
  });

  it.each([
    'timeout',
    'HTTP 401',
    'HTTP 403',
    'HTTP 429',
    'HTTP 400',
    'HTTP 451',
    'HTTP 500',
    'HTTP 502',
    'HTTP 503',
    'reset',
    'tls',
    'network',
  ])('%s is soft', (detail) => {
    expect(failureClass(detail)).toBe('soft');
  });

  it('treats an unknown or missing detail as soft', () => {
    expect(failureClass('something new')).toBe('soft');
    expect(failureClass(null)).toBe('soft');
  });

  it('has no class for a non-bad verdict', () => {
    expect(failureClass({ v: 'ok', d: 'audio/mpeg' })).toBeNull();
    expect(failureClass({ v: 'warn', d: 'content-type "text/html"' })).toBeNull();
    expect(failureClass({ v: 'na' })).toBeNull();
    expect(failureClass({ v: 'bad', d: 'dns' })).toBe('hard');
    expect(failureClass({ v: 'bad' })).toBe('soft');
  });
});

describe('toObservation', () => {
  const station = { id: 'de-dlf' };

  it('builds a normalisable ok row', () => {
    const row = toObservation({
      station,
      facets: { stream: { v: 'ok', d: 'audio/mpeg' }, icy: { v: 'warn' } },
      probe: { status: 200, contentType: 'AUDIO/MPEG', ms: 412.6 },
      at: '2026-09-04T05:12:03.123Z',
    });
    expect(normaliseObservation(row)).toEqual({
      id: 'de-dlf',
      at: '2026-09-04T05:12:03Z',
      v: 'gha',
      f: 'stream',
      o: 'ok',
      c: null,
      s: 200,
      ct: 'audio/mpeg',
      ms: 413,
      d: 'audio/mpeg',
      icy: 'warn',
      r: false,
    });
  });

  it('carries the failure class and the retry flag on a soft bad row', () => {
    const row = toObservation({
      station,
      facets: { stream: { v: 'bad', d: 'timeout' }, icy: { v: 'na' } },
      probe: { status: 'failed', errorToken: 'timeout', ms: 16004 },
      at: '2026-09-04T05:12:03Z',
      retried: true,
    });
    expect(normaliseObservation(row)).toMatchObject({
      o: 'bad',
      c: 'soft',
      s: null,
      ct: null,
      ms: 16004,
      d: 'timeout',
      icy: 'na',
      r: true,
    });
  });

  it('classes an HTTP 404 as hard and keeps the numeric status', () => {
    const row = toObservation({
      station,
      facets: { stream: { v: 'bad', d: 'HTTP 404' } },
      probe: { status: 404, contentType: 'text/html', ms: 88 },
      at: '2026-09-04T05:12:03Z',
    });
    expect(normaliseObservation(row)).toMatchObject({ o: 'bad', c: 'hard', s: 404, icy: 'na', r: false });
  });
});

describe('createClassifiers', () => {
  const c = createClassifiers(MANIFEST);

  it('knows which metadata keys exist', () => {
    expect(c.classifyFetcher('grrif')).toEqual({ v: 'ok', d: 'grrif' });
    expect(c.classifyFetcher('nope')).toEqual({ v: 'bad', d: 'unknown key "nope"' });
    expect(c.classifyFetcher(null)).toEqual({ v: 'na', d: 'generic' });
  });

  it('reports program capability from the manifest', () => {
    expect(c.classifyProgram('grrif')).toEqual({ v: 'ok' });
    expect(c.classifyProgram('wdr').v).toBe('warn');
    expect(c.classifyProgram(null)).toEqual({ v: 'na' });
  });

  it('treats a slug metadataUrl as proxied, not as a URL to probe', () => {
    expect(c.isMetadataSlug('groovesalad', 'soma-fm')).toBe(true);
    expect(c.isMetadataSlug('https://somafm.com/x.json', 'soma-fm')).toBe(false);
    expect(c.classifyMetadataApi('groovesalad', null, 'soma-fm', 'soma-fm')).toEqual({
      v: 'ok',
      d: 'slug=groovesalad (proxied)',
    });
  });

  it('classifies a declared metadata endpoint from its probe', () => {
    expect(c.classifyMetadataApi('https://x/y', { status: 200, contentType: 'application/json' }, 'grrif', 'grrif'))
      .toEqual({ v: 'ok' });
    expect(c.classifyMetadataApi('https://x/y', { status: 500 }, 'grrif', 'grrif')).toEqual({
      v: 'bad',
      d: 'HTTP 500',
    });
    expect(c.classifyMetadataApi('https://x/y', { status: 'failed', errorToken: 'dns' }, 'grrif', 'grrif').d).toBe('dns');
    expect(c.classifyMetadataApi('https://x/y', { status: 200, contentType: 'text/plain' }, 'wdr', 'wdr').v).toBe('ok');
    expect(c.classifyMetadataApi('https://x/y', { status: 200, contentType: 'text/plain' }, 'grrif', 'grrif').v).toBe('warn');
  });

  it('handles a missing metadataUrl by fetcher and broadcaster', () => {
    expect(c.classifyMetadataApi(null, null, 'soma-fm', 'soma-fm').v).toBe('ok');
    expect(c.classifyMetadataApi(null, null, null, 'ard').v).toBe('warn');
    expect(c.classifyMetadataApi(null, null, null, 'grrif')).toEqual({ v: 'na', d: 'not declared' });
  });
});
