import { describe, it, expect } from 'vitest';
import { edgeProbe, edgeProbeMany, toEdgeObservation, DEFAULT_BASE } from './edge-probe.mjs';

const ANSWER = { url: 'https://s.example/a.mp3', s: 200, ct: 'audio/mpeg', o: 'ok', c: null, d: 'audio/mpeg', ms: 412 };

/** A fetch stub that records calls and answers with a canned response. */
function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('edgeProbe', () => {
  it('GETs the admin endpoint with the bearer token and returns the answer', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(ANSWER));
    const out = await edgeProbe('https://s.example/a.mp3?x=1&y=2', { token: 't0k', fetchImpl });
    expect(out).toEqual({ ...ANSWER });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DEFAULT_BASE}/api/admin/probe?url=${encodeURIComponent('https://s.example/a.mp3?x=1&y=2')}`);
    expect(calls[0].init.headers.Authorization).toBe('Bearer t0k');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('honours a custom base and strips its trailing slash', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(ANSWER));
    await edgeProbe('https://s.example/a', { base: 'https://edge.test/', token: 't', fetchImpl });
    expect(calls[0].url.startsWith('https://edge.test/api/admin/probe?url=')).toBe(true);
  });

  it('returns null on 401 (and any other non-2xx)', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
    expect(await edgeProbe('https://s.example/a', { token: 'bad', fetchImpl })).toBeNull();
    const { fetchImpl: f500 } = stubFetch(() => jsonResponse({}, 500));
    expect(await edgeProbe('https://s.example/a', { token: 't', fetchImpl: f500 })).toBeNull();
  });

  it('returns null without a token and never calls fetch', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(ANSWER));
    expect(await edgeProbe('https://s.example/a', { fetchImpl })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null on timeout', async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    expect(await edgeProbe('https://s.example/a', { token: 't', timeoutMs: 20, fetchImpl })).toBeNull();
  });

  it('returns null on bad JSON or a body that is not a verdict', async () => {
    const { fetchImpl: broken } = stubFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('nope'); } }));
    expect(await edgeProbe('https://s.example/a', { token: 't', fetchImpl: broken })).toBeNull();
    const { fetchImpl: odd } = stubFetch(() => jsonResponse({ hello: 'world' }));
    expect(await edgeProbe('https://s.example/a', { token: 't', fetchImpl: odd })).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fetchImpl = async () => { throw new TypeError('fetch failed'); };
    expect(await edgeProbe('https://s.example/a', { token: 't', fetchImpl })).toBeNull();
  });

  it('normalises a bad answer that arrived without a class to soft', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse({ url: 'u', s: 503, ct: null, o: 'bad', d: 'HTTP 503', ms: 9 }));
    expect(await edgeProbe('https://s.example/a', { token: 't', fetchImpl })).toMatchObject({ o: 'bad', c: 'soft', d: 'HTTP 503' });
  });
});

describe('edgeProbeMany', () => {
  const urls = Array.from({ length: 10 }, (_, i) => `https://s.example/${i}`);

  it('answers every URL, keyed by URL, and never exceeds the concurrency bound', async () => {
    let inflight = 0;
    let peak = 0;
    const fetchImpl = async (url) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 2));
      inflight -= 1;
      const target = decodeURIComponent(url.split('url=')[1]);
      return jsonResponse({ ...ANSWER, url: target });
    };
    const out = await edgeProbeMany(urls, { token: 't', fetchImpl }, { concurrency: 3 });
    expect(out.size).toBe(10);
    expect(out.get('https://s.example/7')?.url).toBe('https://s.example/7');
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('asks at most `max` URLs and leaves the rest out of the map', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(ANSWER));
    const out = await edgeProbeMany(urls, { token: 't', fetchImpl }, { max: 4 });
    expect(calls).toHaveLength(4);
    expect(out.size).toBe(4);
    expect(out.has('https://s.example/3')).toBe(true);
    expect(out.has('https://s.example/4')).toBe(false);
  });

  it('asks a duplicate URL once and records a failed question as null', async () => {
    const { fetchImpl, calls } = stubFetch((url) => (url.includes('%2F1') ? jsonResponse({}, 502) : jsonResponse(ANSWER)));
    const out = await edgeProbeMany(['https://s.example/0', 'https://s.example/0', 'https://s.example/1'], { token: 't', fetchImpl });
    expect(calls).toHaveLength(2);
    expect(out.get('https://s.example/0')).toMatchObject({ o: 'ok' });
    expect(out.get('https://s.example/1')).toBeNull();
  });

  it('handles an empty list', async () => {
    const out = await edgeProbeMany([], { token: 't', fetchImpl: async () => jsonResponse(ANSWER) });
    expect(out.size).toBe(0);
  });
});

describe('toEdgeObservation', () => {
  it('builds a normalised stream row from the edge vantage', () => {
    const row = toEdgeObservation('de-xyz', { ...ANSWER, s: 404, ct: null, o: 'bad', c: 'hard', d: 'HTTP 404', ms: 88 }, '2026-09-06T06:00:00.123Z');
    expect(row).toEqual({
      id: 'de-xyz',
      at: '2026-09-06T06:00:00Z',
      v: 'edge',
      f: 'stream',
      o: 'bad',
      c: 'hard',
      s: 404,
      ct: null,
      ms: 88,
      d: 'HTTP 404',
      icy: 'na',
      r: false,
    });
  });

  it('drops the class on a non-bad answer', () => {
    const row = toEdgeObservation('x', ANSWER, '2026-09-06T06:00:00Z');
    expect(row.c).toBeNull();
    expect(row.ct).toBe('audio/mpeg');
  });
});
