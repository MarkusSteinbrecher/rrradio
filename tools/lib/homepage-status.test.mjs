import { describe, expect, it } from 'vitest';
import {
  CLASS,
  STRICT_FAIL,
  classifyStatus,
  classifyError,
  isRetryable,
  homepageVerdict,
  homepageFailureClass,
  toHomepageObservation,
  probeHomepage,
  runPolitePool,
  hostOf,
} from './homepage-status.mjs';
import { normaliseObservation } from './observations.mjs';

describe('classifyStatus', () => {
  it('treats 2xx as ok', () => {
    for (const s of [200, 201, 204, 226]) expect(classifyStatus(s)).toBe(CLASS.OK);
  });

  it('treats 3xx as redirect (only surfaced when not following)', () => {
    for (const s of [301, 302, 307, 308]) expect(classifyStatus(s)).toBe(CLASS.REDIRECT);
  });

  it('treats 404 / 410 / 400 and other 4xx as dead — the actionable signal', () => {
    for (const s of [400, 404, 410, 451, 418]) expect(classifyStatus(s)).toBe(CLASS.DEAD);
  });

  it('treats 401 / 403 / 429 as blocked, not dead', () => {
    for (const s of [401, 403, 429]) expect(classifyStatus(s)).toBe(CLASS.BLOCKED);
  });

  it('treats 5xx as server-error', () => {
    for (const s of [500, 502, 503, 504]) expect(classifyStatus(s)).toBe(CLASS.SERVER_ERROR);
  });

  it('treats nonsense codes as error', () => {
    for (const s of [0, -1, NaN, undefined]) expect(classifyStatus(s)).toBe(CLASS.ERROR);
  });
});

describe('STRICT_FAIL', () => {
  it('fails strict only on dead — not blocked / server-error / error', () => {
    expect(STRICT_FAIL.has(CLASS.DEAD)).toBe(true);
    expect(STRICT_FAIL.has(CLASS.BLOCKED)).toBe(false);
    expect(STRICT_FAIL.has(CLASS.SERVER_ERROR)).toBe(false);
    expect(STRICT_FAIL.has(CLASS.ERROR)).toBe(false);
    expect(STRICT_FAIL.has(CLASS.OK)).toBe(false);
  });
});

describe('classifyError', () => {
  it('detects timeouts and aborts', () => {
    expect(classifyError({ name: 'TimeoutError', message: 'The operation timed out' })).toBe('timeout');
    expect(classifyError(new Error('This operation was aborted'))).toBe('timeout');
  });

  it('detects DNS failures', () => {
    expect(classifyError({ message: 'fetch failed', cause: { code: 'ENOTFOUND' } })).toBe('dns');
    expect(classifyError(new Error('getaddrinfo EAI_AGAIN example.com'))).toBe('dns');
  });

  it('detects TLS and connection errors', () => {
    expect(classifyError(new Error('unable to verify the first certificate'))).toBe('tls');
    expect(classifyError({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } })).toBe('refused');
    expect(classifyError({ message: 'fetch failed', cause: { code: 'ECONNRESET' } })).toBe('reset');
  });

  it('falls back to network for anything unrecognised', () => {
    expect(classifyError(new Error('something weird'))).toBe('network');
    expect(classifyError(null)).toBe('network');
  });
});

describe('isRetryable', () => {
  it('retries server errors, network errors, and 429', () => {
    expect(isRetryable(CLASS.SERVER_ERROR)).toBe(true);
    expect(isRetryable(CLASS.ERROR)).toBe(true);
    expect(isRetryable(CLASS.BLOCKED, 429)).toBe(true);
  });

  it('does not retry dead, ok, or non-429 blocked', () => {
    expect(isRetryable(CLASS.DEAD, 404)).toBe(false);
    expect(isRetryable(CLASS.OK, 200)).toBe(false);
    expect(isRetryable(CLASS.BLOCKED, 403)).toBe(false);
  });
});

describe('homepageVerdict', () => {
  it('maps classes to record verdicts with stable details', () => {
    expect(homepageVerdict({ status: 200, class: CLASS.OK })).toEqual({ v: 'ok' });
    expect(homepageVerdict({ status: 403, class: CLASS.BLOCKED })).toEqual({ v: 'warn', d: 'HTTP 403' });
    expect(homepageVerdict({ status: 429, class: CLASS.BLOCKED })).toEqual({ v: 'warn', d: 'HTTP 429' });
    expect(homepageVerdict({ status: 404, class: CLASS.DEAD })).toEqual({ v: 'bad', d: 'HTTP 404' });
    expect(homepageVerdict({ status: 503, class: CLASS.SERVER_ERROR })).toEqual({ v: 'bad', d: 'HTTP 503' });
    expect(homepageVerdict({ status: 0, class: CLASS.ERROR, reason: 'dns' })).toEqual({ v: 'bad', d: 'dns' });
    expect(homepageVerdict({ status: 0, class: CLASS.ERROR })).toEqual({ v: 'bad', d: 'network' });
  });

  it('classes only unambiguously gone pages as hard', () => {
    expect(homepageFailureClass({ v: 'bad', d: 'HTTP 404' })).toBe('hard');
    expect(homepageFailureClass({ v: 'bad', d: 'dns' })).toBe('hard');
    expect(homepageFailureClass({ v: 'bad', d: 'HTTP 503' })).toBe('soft');
    expect(homepageFailureClass({ v: 'bad', d: 'timeout' })).toBe('soft');
    expect(homepageFailureClass({ v: 'warn', d: 'HTTP 403' })).toBe(null);
  });
});

describe('toHomepageObservation', () => {
  it('builds a valid homepage row', () => {
    const row = normaliseObservation(
      toHomepageObservation({ station: { id: 'a' }, result: { status: 410, class: CLASS.DEAD, ms: 120 }, at: '2026-10-19T05:00:00Z' }),
    );
    expect(row).toEqual({
      id: 'a', at: '2026-10-19T05:00:00Z', v: 'gha', f: 'homepage', o: 'bad', c: 'hard',
      s: 410, ct: null, ms: 120, d: 'HTTP 410', r: false,
    });
  });

  it('records no status for a network error', () => {
    const row = toHomepageObservation({ station: { id: 'a' }, result: { status: 0, class: CLASS.ERROR, reason: 'timeout' }, at: '2026-10-19T05:00:00Z' });
    expect(row).toMatchObject({ s: null, o: 'bad', c: 'soft', d: 'timeout' });
  });
});

describe('probeHomepage', () => {
  /** Fake fetch answering from a per-method script. */
  function fakeFetch(script) {
    const calls = [];
    const fn = async (_url, init) => {
      calls.push(init.method);
      const next = script[init.method].shift();
      if (next instanceof Error) throw next;
      return { status: next, redirected: false, url: _url, body: null };
    };
    return { fn, calls };
  }
  const io = (f) => ({ fetch: f, timeout: 1000, sleep: async () => {} });

  it('stops at a clean HEAD — no body downloaded', async () => {
    const f = fakeFetch({ HEAD: [200], GET: [] });
    const r = await probeHomepage('https://a/', io(f.fn));
    expect(r).toMatchObject({ status: 200, class: CLASS.OK, method: 'HEAD' });
    expect(f.calls).toEqual(['HEAD']);
  });

  it('never trusts a non-2xx HEAD: falls back to GET', async () => {
    const f = fakeFetch({ HEAD: [405], GET: [200] });
    expect(await probeHomepage('https://a/', io(f.fn))).toMatchObject({ class: CLASS.OK, method: 'GET' });
    expect(f.calls).toEqual(['HEAD', 'GET']);
  });

  it('falls back to GET when HEAD throws', async () => {
    const f = fakeFetch({ HEAD: [new Error('socket hang up')], GET: [404] });
    expect(await probeHomepage('https://a/', io(f.fn))).toMatchObject({ status: 404, class: CLASS.DEAD });
  });

  it('retries 429 on GET, then keeps it as blocked (warn)', async () => {
    const f = fakeFetch({ HEAD: [429], GET: [429, 429, 429] });
    const r = await probeHomepage('https://a/', { ...io(f.fn), retries: 2 });
    expect(r).toMatchObject({ status: 429, class: CLASS.BLOCKED });
    expect(homepageVerdict(r)).toEqual({ v: 'warn', d: 'HTTP 429' });
    expect(f.calls).toEqual(['HEAD', 'GET', 'GET', 'GET']);
  });

  it('does not retry a 403 (blocked, not transient)', async () => {
    const f = fakeFetch({ HEAD: [403], GET: [403] });
    expect(await probeHomepage('https://a/', io(f.fn))).toMatchObject({ class: CLASS.BLOCKED });
    expect(f.calls).toEqual(['HEAD', 'GET']);
  });

  it('turns repeated network errors into an error row with a reason token', async () => {
    const err = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const f = fakeFetch({ HEAD: [err], GET: [err, err, err] });
    expect(await probeHomepage('https://a/', io(f.fn))).toMatchObject({ status: 0, class: CLASS.ERROR, reason: 'dns' });
  });
});

describe('runPolitePool', () => {
  it('never runs two items for the same host at once', async () => {
    const inFlight = new Map();
    let clash = false;
    const items = ['https://a/1', 'https://a/2', 'https://a/3', 'https://b/1', 'https://c/1'];
    const res = await runPolitePool(items, hostOf, async (url) => {
      const h = hostOf(url);
      if (inFlight.get(h)) clash = true;
      inFlight.set(h, true);
      await new Promise((r) => setTimeout(r, 5));
      inFlight.set(h, false);
    }, { concurrency: 4 });
    expect(clash).toBe(false);
    expect(res).toEqual({ started: 5, skipped: [] });
  });

  it('starts nothing after the deadline and reports what it skipped', async () => {
    let t = 0;
    const seen = [];
    const res = await runPolitePool(['https://a/', 'https://b/', 'https://c/'], hostOf, async (u) => {
      seen.push(u);
      t += 10;
    }, { concurrency: 1, deadline: 15, now: () => t });
    expect(seen).toEqual(['https://a/', 'https://b/']);
    expect(res.skipped).toEqual(['https://c/']);
  });
});
