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
let gcUrls: URL[];

beforeEach(() => {
  env = {
    GOATCOUNTER_SITE: 'test.goatcounter.com',
    GOATCOUNTER_TOKEN: 'gc-token',
    ADMIN_TOKEN: 'admin-token',
    ALLOWED_ORIGIN: 'https://rrradio.org',
    DB: new FakeD1().asD1(),
  };
  gcUrls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      gcUrls.push(new URL(input instanceof Request ? input.url : String(input)));
      return new Response(null, { status: 204 });
    }),
  );
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
  it('forwards a play: <name> event, like the web app', async () => {
    const res = await play({ stationName: 'FM4', stationId: 'fm4', platform: 'ios' });
    expect(res.status).toBe(202);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(gcUrls).toHaveLength(1);
    const url = gcUrls[0];
    expect(url.origin).toBe('https://test.goatcounter.com');
    expect(url.pathname).toBe('/count');
    expect(url.searchParams.get('p')).toBe('play: FM4');
    expect(url.searchParams.get('e')).toBe('1');
    expect(url.searchParams.get('t')).toBe('station=fm4 · platform=ios');
  });

  it('cleans the name and caps it at 90 chars', async () => {
    await play({ stationName: '  Radio\u0007  X\n' + 'y'.repeat(200) });
    const p = gcUrls[0].searchParams.get('p') ?? '';
    expect(p.startsWith('play: Radio X y')).toBe(true);
    expect(p).not.toContain('\u0007');
    expect(p.length).toBeLessThanOrEqual('play: '.length + 90);
    expect(gcUrls[0].searchParams.get('t')).toBe('platform=unknown');
  });

  it('rejects a missing name, bad json, oversized bodies and GET', async () => {
    expect((await play({ stationId: 'fm4' })).status).toBe(400);
    expect((await play('{nope')).status).toBe(400);
    expect((await play({ stationName: 'x'.repeat(2000) })).status).toBe(413);
    const get = await worker.fetch(new Request('https://worker.test/api/public/play'), env);
    expect(get.status).toBe(405);
    expect(gcUrls).toHaveLength(0);
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

  it('returns 502 when GoatCounter is down, so the app may drop it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    expect((await play({ stationName: 'FM4' })).status).toBe(502);
  });
});
