/**
 * Native-app play ping (rrradio-ios#166): forwarded to GoatCounter as
 * the same `play: <name>` event the web app sends, rate-limited per IP
 * on its own budget. FakeD1 + `globalThis.fetch` stub as in reports.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import type { Env } from './index';
import { FakeD1 } from './test-d1';

let env: Env;
interface GcHit {
  path: string;
  title: string;
  event: boolean;
  session: string;
}
interface GcCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  hits: GcHit[];
}
let gcCalls: GcCall[];
/** Every hit sent, across calls. */
const hits = (): GcHit[] => gcCalls.flatMap((c) => c.hits);

function stubGoatCounter(respond: (call: GcCall) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { hits: GcHit[] }) : { hits: [] };
      const call: GcCall = {
        url: new URL(String(input)),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        hits: body.hits,
      };
      gcCalls.push(call);
      return respond(call);
    }),
  );
}

beforeEach(() => {
  env = {
    GOATCOUNTER_SITE: 'test.goatcounter.com',
    GOATCOUNTER_TOKEN: 'gc-token',
    ADMIN_TOKEN: 'admin-token',
    ALLOWED_ORIGIN: 'https://rrradio.org',
    DB: new FakeD1().asD1(),
  };
  gcCalls = [];
  stubGoatCounter(() => new Response('{"status":"ok"}', { status: 202 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function play(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(
    new Request('https://worker.test/api/public/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  );
}

describe('POST /api/public/play', () => {
  it('forwards a play: <name> event through the authenticated count API', async () => {
    const res = await play({ stationName: 'FM4', stationId: 'fm4', platform: 'ios' });
    expect(res.status).toBe(202);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(gcCalls).toHaveLength(1);
    const call = gcCalls[0];
    expect(call.url.origin).toBe('https://test.goatcounter.com');
    expect(call.url.pathname).toBe('/api/v0/count');
    expect(call.method).toBe('POST');
    expect(call.headers.Authorization).toBe('Bearer gc-token');
    expect(call.hits[0]).toMatchObject({
      path: 'play: FM4',
      title: 'station=fm4 · platform=ios',
      event: true,
    });
  });

  it('records an iOS play a second time under its own prefix, in the same request', async () => {
    await play({ stationName: 'FM4', stationId: 'fm4', platform: 'ios' });
    expect(gcCalls).toHaveLength(1);
    expect(hits().map((h) => h.path)).toEqual(['play: FM4', 'play-ios: FM4']);
    expect(hits()[1].title).toBe('station=fm4 · platform=ios');
  });

  it('records other platforms once, in the combined count only', async () => {
    await play({ stationName: 'FM4', platform: 'android' });
    await play({ stationName: 'FM4' });
    expect(hits().map((h) => h.path)).toEqual(['play: FM4', 'play: FM4']);
  });

  // GoatCounter counts a path once per session. Hits from the Worker
  // would all share one, so each ping brings its own (#856).
  it('gives every ping its own session, shared by its two events', async () => {
    const ip = { 'CF-Connecting-IP': '203.0.113.7' };
    await play({ stationName: 'FM4', platform: 'ios' }, ip);
    await play({ stationName: 'FM4', platform: 'ios' }, ip);
    const [a, b] = gcCalls;
    expect(a.hits[0].session).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.hits[1].session).toBe(a.hits[0].session);
    expect(b.hits[0].session).not.toBe(a.hits[0].session);
    // Random, not derived from the listener.
    expect(JSON.stringify(gcCalls.map((c) => c.hits))).not.toContain('203.0.113.7');
  });

  // A URL in the User-Agent made GoatCounter file every hit as a bot,
  // with a 200 and no warning (#856).
  it('falls back to /count, without a bot-like User-Agent, when the token may not count', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubGoatCounter((call) =>
      call.url.pathname === '/api/v0/count'
        ? new Response('{"error":"requires count permissions"}', { status: 403 })
        : new Response(null, { status: 200 }),
    );
    const res = await play({ stationName: 'FM4', stationId: 'fm4', platform: 'ios' });
    expect(res.status).toBe(202);
    const pixels = gcCalls.filter((c) => c.url.pathname === '/count');
    expect(pixels.map((c) => c.url.searchParams.get('p'))).toEqual(['play: FM4', 'play-ios: FM4']);
    for (const pixel of pixels) {
      expect(pixel.url.searchParams.get('e')).toBe('1');
      const ua = pixel.headers['User-Agent'];
      expect(ua).toContain(' ');
      expect(ua).toContain('/');
      expect(ua).not.toContain('://');
      expect(ua.toLowerCase()).not.toMatch(/bot|crawler|spider/);
    }
  });

  it('cleans the name and caps it at 90 chars', async () => {
    await play({ stationName: '  Radio\u0007  X\n' + 'y'.repeat(200) });
    const p = hits()[0].path;
    expect(p.startsWith('play: Radio X y')).toBe(true);
    expect(p).not.toContain('\u0007');
    expect(p.length).toBeLessThanOrEqual('play: '.length + 90);
    expect(hits()[0].title).toBe('platform=unknown');
  });

  it('rejects a missing name, bad json, oversized bodies and GET', async () => {
    expect((await play({ stationId: 'fm4' })).status).toBe(400);
    expect((await play('{nope')).status).toBe(400);
    expect((await play({ stationName: 'x'.repeat(2000) })).status).toBe(413);
    const get = await worker.fetch(new Request('https://worker.test/api/public/play'), env);
    expect(get.status).toBe(405);
    expect(gcCalls).toHaveLength(0);
  });

  it('rate-limits the 301st play per IP without touching the report budget', async () => {
    const ip = { 'CF-Connecting-IP': '203.0.113.7' };
    for (let i = 0; i < 300; i++) {
      expect((await play({ stationName: `S${i}` }, ip)).status).toBe(202);
    }
    expect((await play({ stationName: 'too many' }, ip)).status).toBe(429);
    const report = await worker.fetch(
      new Request('https://worker.test/api/public/report-broken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ip },
        body: JSON.stringify({ stationId: 'fm4' }),
      }),
      env,
    );
    expect(report.status).toBe(202);
  });

  it('returns 502 when GoatCounter is down or rejects the hit, so the app may drop it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubGoatCounter(() => new Response(null, { status: 500 }));
    expect((await play({ stationName: 'FM4' })).status).toBe(502);
    stubGoatCounter(() => new Response('{"errors":{"0":"bad"}}', { status: 400 }));
    expect((await play({ stationName: 'FM4' })).status).toBe(502);
  });
});
