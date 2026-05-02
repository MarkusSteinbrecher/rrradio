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

function gcHits(items: Array<{ path: string; count: number; title?: string; event?: boolean }>) {
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
    const body = await json(res);
    expect(body.items).toEqual([
      { name: 'Alpha FM', count: 10 },
      { name: 'Beta FM', count: 5 },
    ]);
    expect(body.range_days).toBe(7);
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
    const body = await json(res);
    expect(body.total).toBe(1234);
    expect(body.range_days).toBe(30);
  });

  it('returns 404 for unknown public paths', async () => {
    const res = await call('/api/public/nope');
    expect(res.status).toBe(404);
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
