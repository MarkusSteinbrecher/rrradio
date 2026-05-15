/**
 * Worker integration tests. The Worker is a single default export with
 * `fetch(req, env)` — we call it directly with stub Request and Env
 * objects instead of running it under wrangler. Upstream fetches
 * (GoatCounter, BBC, broadcaster proxies) are intercepted via a
 * `globalThis.fetch` stub so tests are hermetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import type { Env } from './index';

const ENV: Env = {
  GOATCOUNTER_SITE: 'test.goatcounter.com',
  GOATCOUNTER_TOKEN: 'gc-token',
  ADMIN_TOKEN: 'admin-token',
  ALLOWED_ORIGIN: 'https://rrradio.org',
};

interface UpstreamCall {
  url: string;
  /** Headers passed to fetch(). Read directly from init — wrapping in
   *  `new Request()` strips forbidden headers (Origin, Referer) that
   *  the Cloudflare Worker runtime allows but Node's Fetch impl does
   *  not. */
  headers: Record<string, string>;
  method: string;
}
type FetchStub = (call: UpstreamCall) => Promise<Response>;

function flattenHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

function stubFetch(handler: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const headers =
        input instanceof Request
          ? Object.fromEntries(input.headers.entries())
          : flattenHeaders(init?.headers);
      const method = (input instanceof Request ? input.method : init?.method) ?? 'GET';
      return handler({ url, headers, method });
    }),
  );
}

function gcHits(
  items: Array<{
    path: string;
    count: number;
    title?: string;
    event?: boolean;
    stats?: Array<{ day: string; daily: number }>;
  }>,
) {
  return new Response(JSON.stringify({ hits: items, total: items.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://worker.test${path}`, init), ENV);
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(() => {
  // Default: fail any upstream fetch unless the test explicitly stubs.
  stubFetch(async (c) => {
    throw new Error(`Unstubbed upstream fetch: ${c.url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CORS', () => {
  it('OPTIONS returns 204 with CORS headers', async () => {
    const res = await call('/api/totals', {
      method: 'OPTIONS',
      headers: { Origin: 'https://rrradio.org' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://rrradio.org');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('echoes the allowed origin when origin matches', async () => {
    const res = await call('/api/totals', {
      method: 'OPTIONS',
      headers: { Origin: 'https://rrradio.org' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://rrradio.org');
  });

  it('falls back to the configured allowed origin when origin differs', async () => {
    const res = await call('/api/totals', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://rrradio.org');
  });

  it('public endpoints respond with Access-Control-Allow-Origin: *', async () => {
    stubFetch(async () => gcHits([{ path: 'play: Test FM', count: 5 }]));
    const res = await call('/api/public/top-stations');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects POST with 405', async () => {
    const res = await call('/api/totals', { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('allows public broken-station report preflight for POST', async () => {
    const res = await call('/api/public/report-broken', {
      method: 'OPTIONS',
      headers: { Origin: 'https://rrradio.org' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

describe('admin auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await call('/api/totals');
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 when bearer token is wrong', async () => {
    const res = await call('/api/totals', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when ADMIN_TOKEN is unset on the env', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/api/totals', {
        headers: { Authorization: 'Bearer admin-token' },
      }),
      { ...ENV, ADMIN_TOKEN: '' },
    );
    expect(res.status).toBe(401);
  });

  it('passes auth with the correct bearer token', async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ total: 100, total_events: 50 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await call('/api/totals', {
      headers: { Authorization: 'Bearer admin-token' },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.total).toBe(100);
    expect(body.range_days).toBe(7);
  });
});

describe('public endpoints', () => {
  it('GET /api/public/top-stations returns shaped payload (no auth)', async () => {
    stubFetch(async () =>
      gcHits([
        { path: 'play: Alpha FM', count: 10 },
        { path: 'play: Beta FM', count: 5 },
        { path: 'tab/browse', count: 3 }, // ignored — wrong prefix
      ]),
    );
    const res = await call('/api/public/top-stations?limit=5');
    expect(res.status).toBe(200);
    const body = await json<{
      items: Array<{ name: string; count: number; series: number[] }>;
      total: number;
      range_days: number;
      days: string[];
    }>(res);
    // `days` is built from `new Date()` so we can't assert the literal
    // values; just shape + counts + zeroed series (no per-day stats in
    // the stub, so every day is zero).
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ name: 'Alpha FM', count: 10 });
    expect(body.items[1]).toMatchObject({ name: 'Beta FM', count: 5 });
    expect(body.items[0].series).toBeInstanceOf(Array);
    expect(body.items[0].series.length).toBe(body.days.length);
    expect(body.items[0].series.every((v: number) => v === 0)).toBe(true);
    expect(body.total).toBe(15);
    expect(body.range_days).toBe(7);
    expect(body.days).toHaveLength(8); // 7-day window = today + 7 prior days
  });

  it('GET /api/public/top-stations zero-fills the series and maps stats by day', async () => {
    // Synthesize a daily breakdown for one of two hits. GC omits days
    // with zero events; the worker should fill those slots with 0 and
    // align by date so the series length matches `days`.
    const today = new Date();
    const day = (offset: number): string => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    stubFetch(async () =>
      gcHits([
        {
          path: 'play: Alpha FM',
          count: 12,
          stats: [
            { day: day(0), daily: 5 }, // today
            { day: day(3), daily: 7 }, // 3 days ago
            // GC would normally omit zero-event days; we test that fill.
          ],
        },
        { path: 'play: Beta FM', count: 0 }, // no stats at all
      ]),
    );
    const res = await call('/api/public/top-stations?days=7&limit=5');
    const body = await json<{
      items: Array<{ name: string; count: number; series: number[] }>;
      days: string[];
    }>(res);
    expect(body.days[body.days.length - 1]).toBe(day(0));
    expect(body.days[body.days.length - 1 - 3]).toBe(day(3));
    expect(body.items[0].name).toBe('Alpha FM');
    // today and (today-3) should be the only non-zero slots
    const nonZero = body.items[0].series
      .map((v, i) => ({ v, i }))
      .filter((e) => e.v > 0);
    expect(nonZero).toEqual([
      { i: body.days.length - 1 - 3, v: 7 },
      { i: body.days.length - 1, v: 5 },
    ]);
    // Hit with no stats → fully zero-filled series matching `days`.
    expect(body.items[1].series.length).toBe(body.days.length);
    expect(body.items[1].series.every((v) => v === 0)).toBe(true);
  });

  it('clamps days to [1,90]', async () => {
    stubFetch(async () => gcHits([]));
    const res = await call('/api/public/top-stations?days=999');
    const body = await json(res);
    expect(body.range_days).toBe(90);
  });

  it('GET /api/public/totals proxies GC totals', async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ total: 1234, total_events: 567 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await call('/api/public/totals?days=30');
    expect(res.status).toBe(200);
    const body = await json<{ total: number; range_days: number }>(res);
    expect(body.total).toBe(1234);
    expect(body.range_days).toBe(30);
  });

  it('GET /api/public/locations stitches per-day GC calls into a series', async () => {
    // The worker now hits /stats/locations once per day in the window
    // (GC has no daily=true on /stats/locations but accepts start+end).
    // Stub returns different per-country counts per day so the series
    // assertions are meaningful.
    const today = new Date();
    const day = (offset: number): string => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    // Build a per-day fixture: oldest → newest, 8 days for days=7.
    // CH grows linearly; DE has one big spike; FR appears on day 5 only.
    const fixture: Record<string, { stats: Array<{ id: string; name: string; count: number }>; total: number }> = {};
    for (let i = 0; i <= 7; i++) {
      const d = day(7 - i); // oldest first
      fixture[d] = {
        stats: [
          { id: 'CH', name: 'Switzerland', count: i + 1 },
          { id: 'DE', name: 'Germany', count: i === 3 ? 100 : 5 },
          ...(i === 5 ? [{ id: 'FR', name: 'France', count: 7 }] : []),
        ],
        total: 0,
      };
      fixture[d].total = fixture[d].stats.reduce((s, x) => s + x.count, 0);
    }
    stubFetch(async ({ url }) => {
      const u = new URL(url);
      if (!u.pathname.endsWith('/stats/locations')) {
        throw new Error(`unexpected upstream: ${u.pathname}`);
      }
      const start = u.searchParams.get('start');
      const end = u.searchParams.get('end');
      expect(start).toBe(end); // single-day query
      const data = fixture[start ?? ''] ?? { stats: [], total: 0 };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = await call('/api/public/locations?days=7');
    expect(res.status).toBe(200);
    const body = await json<{
      items: Array<{ code: string; name: string; count: number; series: number[] }>;
      total: number;
      range_days: number;
      days: string[];
    }>(res);
    expect(body.range_days).toBe(7);
    expect(body.days).toHaveLength(8);
    const ch = body.items.find((i) => i.code === 'CH');
    const de = body.items.find((i) => i.code === 'DE');
    const fr = body.items.find((i) => i.code === 'FR');
    expect(ch).toBeDefined();
    expect(de).toBeDefined();
    expect(fr).toBeDefined();
    // CH series: 1..8 across the 8 days. Sum = 36.
    expect(ch!.series).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ch!.count).toBe(36);
    // DE series: 5 every day except day index 3 = 100. Sum = 5*7 + 100 = 135.
    expect(de!.series).toEqual([5, 5, 5, 100, 5, 5, 5, 5]);
    expect(de!.count).toBe(135);
    // FR series: 0 everywhere except day index 5 = 7. Sum = 7.
    expect(fr!.series[5]).toBe(7);
    expect(fr!.count).toBe(7);
    expect(fr!.series.filter((v) => v > 0)).toHaveLength(1);
    // Items ordered by total count desc.
    expect(body.items[0].code).toBe('DE');
    expect(body.items[1].code).toBe('CH');
    expect(body.items[2].code).toBe('FR');
  });

  it('POST /api/public/report-broken records a structured GoatCounter event', async () => {
    const calls: UpstreamCall[] = [];
    stubFetch(async (call) => {
      calls.push(call);
      return new Response(null, { status: 204 });
    });

    const res = await call('/api/public/report-broken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://rrradio.org' },
      body: JSON.stringify({
        stationId: 'fm4',
        stationName: 'FM4',
        streamUrl: 'https://example.com/live.mp3?token=private',
        platform: 'web',
        appVersion: 'abc123',
        reason: 'MediaError: network',
        source: 'manual',
      }),
    });

    expect(res.status).toBe(202);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin).toBe('https://test.goatcounter.com');
    expect(url.pathname).toBe('/count');
    expect(url.searchParams.get('p')).toBe('report-broken: FM4');
    expect(url.searchParams.get('e')).toBe('1');
    expect(url.searchParams.get('t')).toContain('station=fm4');
    expect(url.searchParams.get('t')).toContain('host=example.com');
    expect(url.searchParams.get('t')).not.toContain('token=private');
  });

  it('POST /api/public/report-broken rejects missing station id', async () => {
    const res = await call('/api/public/report-broken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationName: 'No ID' }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe('stationId required');
  });

  it('returns 404 for unknown public paths', async () => {
    const res = await call('/api/public/nope');
    expect(res.status).toBe(404);
  });

  it('GET /api/public/region surfaces the CF-IPCountry country code', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/api/public/region', {
        headers: { 'CF-IPCountry': 'de' },
      }),
      ENV,
    );
    expect(res.status).toBe(200);
    const body = await json<{ country: string | null }>(res);
    expect(body.country).toBe('DE');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('GET /api/public/region returns null for unknown / Tor / missing geo', async () => {
    for (const header of [undefined, 'XX', 'T1', '']) {
      const headers: Record<string, string> = {};
      if (header !== undefined) headers['CF-IPCountry'] = header;
      const res = await worker.fetch(
        new Request('https://worker.test/api/public/region', { headers }),
        ENV,
      );
      const body = await json<{ country: string | null }>(res);
      expect(body.country).toBeNull();
    }
  });
});

describe('proxy allowlist', () => {
  it('rejects URL not on allowlist with 403', async () => {
    const res = await call(
      `/api/public/proxy?url=${encodeURIComponent('https://evil.example/data')}`,
    );
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.error).toBe('host not allowed');
  });

  it('rejects missing url= param with 403', async () => {
    const res = await call('/api/public/proxy');
    expect(res.status).toBe(403);
  });

  it('forwards an allowlisted URL (Antenne)', async () => {
    let observedUrl: string | undefined;
    stubFetch(async (c) => {
      observedUrl = c.url;
      return new Response(JSON.stringify({ data: [{ track: 'x' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = await call(
      `/api/public/proxy?url=${encodeURIComponent('https://www.antenne.de/api/metadata/now')}`,
    );
    expect(res.status).toBe(200);
    const body = await json<{ data: Array<{ track: string }> }>(res);
    expect(body.data[0].track).toBe('x');
    expect(observedUrl).toBe('https://www.antenne.de/api/metadata/now');
  });

  it('forwards an allowlisted Radio Bremen URL', async () => {
    stubFetch(async () =>
      new Response('{"epg":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const url =
      'https://www.bremenzwei.de/foo~ajax_ajaxType-epg.json';
    const res = await call(`/api/public/proxy?url=${encodeURIComponent(url)}`);
    expect(res.status).toBe(200);
  });

  it('rejects partial-match attempts (host but wrong path)', async () => {
    // hr1.de host with a path that is not under the allowed pattern.
    // Pattern requires the host root (`/`), which always matches; the
    // *Bremen Radio* and *SR* patterns are stricter — verify those.
    const url = 'https://www.sr.de/sr/epg/somethingElse';
    const res = await call(`/api/public/proxy?url=${encodeURIComponent(url)}`);
    expect(res.status).toBe(403);
  });

  it('returns 502 when upstream fails', async () => {
    stubFetch(async () => new Response('upstream down', { status: 500 }));
    const res = await call(
      `/api/public/proxy?url=${encodeURIComponent('https://www.antenne.de/api/metadata/now')}`,
    );
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error).toBe('upstream');
    expect(body.status).toBe(500);
  });
});

describe('BBC proxy routing', () => {
  it('matches /api/public/bbc/schedule/<service> and spoofs origin', async () => {
    let observedUrl: string | undefined;
    let observedOrigin: string | undefined;
    stubFetch(async (c) => {
      observedUrl = c.url;
      observedOrigin = c.headers.Origin;
      return new Response('{"data":[]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = await call('/api/public/bbc/schedule/bbc_world_service');
    expect(res.status).toBe(200);
    expect(observedUrl).toBe(
      'https://rms.api.bbc.co.uk/v2/experience/inline/schedules/bbc_world_service',
    );
    expect(observedOrigin).toBe('https://www.bbc.co.uk');
  });

  it('matches /api/public/bbc/play/<service>', async () => {
    let observedUrl: string | undefined;
    stubFetch(async (c) => {
      observedUrl = c.url;
      return new Response('{"data":{}}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = await call('/api/public/bbc/play/bbc_radio_one');
    expect(res.status).toBe(200);
    expect(observedUrl).toContain('/v2/experience/inline/play/bbc_radio_one');
  });

  it('rejects unknown BBC sub-path with 404', async () => {
    const res = await call('/api/public/bbc/something_else/bbc_radio_one');
    expect(res.status).toBe(404);
  });

  it('rejects service slugs with disallowed characters', async () => {
    // The regex requires [a-z0-9_]+ so uppercase / dots / slashes fall through.
    const res = await call('/api/public/bbc/play/Bad-Slug.Foo');
    expect(res.status).toBe(404);
  });

  it('returns 502 when BBC upstream fails', async () => {
    stubFetch(async () => new Response('forbidden', { status: 403 }));
    const res = await call('/api/public/bbc/play/bbc_radio_one');
    expect(res.status).toBe(502);
  });
});

describe('GoatCounter error handling', () => {
  it('returns 502 with upstream detail when GC upstream errors', async () => {
    stubFetch(async () =>
      new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }),
    );
    const res = await call('/api/totals', {
      headers: { Authorization: 'Bearer admin-token' },
    });
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error).toBe('fetch failed');
    expect(body.message).toContain('429');
  });

  it('returns 502 when GC fetch throws (network error)', async () => {
    stubFetch(async () => {
      throw new Error('connection refused');
    });
    const res = await call('/api/totals', {
      headers: { Authorization: 'Bearer admin-token' },
    });
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.message).toContain('connection refused');
  });
});

describe('admin endpoints', () => {
  const auth = { Authorization: 'Bearer admin-token' };
  type ListBody = { items: Array<{ label: string; title?: string; count: number }> };

  it('/api/top-stations filters hits by play: prefix', async () => {
    stubFetch(async () =>
      gcHits([
        { path: 'play: Alpha', count: 10 },
        { path: 'tab/browse', count: 5 },
        { path: 'play: Beta', count: 3 },
      ]),
    );
    const res = await call('/api/top-stations', { headers: auth });
    expect(res.status).toBe(200);
    const body = await json<ListBody>(res);
    expect(body.items.map((i) => i.label)).toEqual(['Alpha', 'Beta']);
  });

  it('/api/errors filters hits by error: prefix', async () => {
    stubFetch(async () =>
      gcHits([
        { path: 'error: Alpha', count: 2, title: 'NetworkError' },
        { path: 'play: Alpha', count: 50 }, // not an error
      ]),
    );
    const res = await call('/api/errors', { headers: auth });
    const body = await json<ListBody>(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].label).toBe('Alpha');
    expect(body.items[0].title).toBe('NetworkError');
  });

  it('/api/tabs filters hits by tab/ prefix', async () => {
    stubFetch(async () =>
      gcHits([
        { path: 'tab/browse', count: 30 },
        { path: 'tab/fav', count: 10 },
        { path: 'play: x', count: 5 },
      ]),
    );
    const res = await call('/api/tabs', { headers: auth });
    const body = await json<ListBody>(res);
    expect(body.items.map((i) => i.label)).toEqual(['browse', 'fav']);
  });

  it('returns 404 for unknown admin paths', async () => {
    const res = await call('/api/nope', { headers: auth });
    expect(res.status).toBe(404);
  });
});

describe('cache headers', () => {
  it('successful admin response includes 5min cache header', async () => {
    stubFetch(async () => gcHits([]));
    const res = await call('/api/top-stations', {
      headers: { Authorization: 'Bearer admin-token' },
    });
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
  });

  it('public top-stations gets the long (1h) cache', async () => {
    stubFetch(async () => gcHits([{ path: 'play: x', count: 1 }]));
    const res = await call('/api/public/top-stations');
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
  });
});
