import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyLogo, logoFailureClass, probeLogo, toLogoObservation, LOGO_HARD_DETAILS } from './logo-probe.mjs';
import { normaliseObservation } from './observations.mjs';

/** Minimal PNG header: signature + IHDR with the given size. */
function png(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function response(status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    body: {
      getReader() {
        let sent = false;
        return {
          read: async () => (sent ? { done: true } : ((sent = true), { value: bytes, done: false })),
          cancel: async () => {},
        };
      },
      cancel: async () => {},
    },
  };
}

const fetchOk = (status = 200, body = png(512, 512), headers = { 'content-type': 'image/png' }) => async () =>
  response(status, body, headers);

describe('probeLogo', () => {
  it('reads a local station asset from disk, ignoring the cache-bust query', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logo-probe-'));
    mkdirSync(join(dir, 'stations'));
    writeFileSync(join(dir, 'stations', 'x.png'), png(300, 300));
    const p = await probeLogo('stations/x.png?v=abcdef12', { publicDir: dir });
    expect(p).toMatchObject({ status: 'local', header: { format: 'png', width: 300, height: 300 }, bytes: 33 });
    const missing = await probeLogo('stations/nope.png', { publicDir: dir });
    expect(missing).toMatchObject({ status: 'failed', errorToken: 'HTTP 404' });
  });

  it('fetches https with a range and decodes the header', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(init.headers);
      return response(206, png(1024, 1024), { 'content-type': 'image/png', 'content-range': 'bytes 0-32/9000' });
    };
    const p = await probeLogo('https://cdn.example/logo.png', { fetchImpl });
    expect(calls[0].Range).toBe('bytes=0-65535');
    expect(p).toMatchObject({ status: 206, contentType: 'image/png', header: { width: 1024, height: 1024 }, bytes: 9000 });
  });

  it('records HTTP errors, non-images and network failures without throwing', async () => {
    expect(await probeLogo('https://x/404.png', { fetchImpl: fetchOk(404, '', { 'content-type': 'text/html' }) })).toMatchObject({ status: 404 });
    expect(await probeLogo('https://x/page', { fetchImpl: fetchOk(200, '<html>', { 'content-type': 'text/html' }) })).toMatchObject({ status: 200, header: null });
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' });
    const dns = await probeLogo('https://x/logo.png', { fetchImpl: async () => { throw err; } });
    expect(dns).toMatchObject({ status: 'failed', errorToken: 'dns' });
  });

  it('never fetches http:// or odd schemes, and returns null for no favicon', async () => {
    const fetchImpl = async () => { throw new Error('must not be called'); };
    expect(await probeLogo('http://x/logo.png', { fetchImpl })).toMatchObject({ status: 'failed', errorToken: 'http' });
    expect(await probeLogo('data:image/png;base64,AAAA', { fetchImpl })).toMatchObject({ status: 'failed', errorToken: 'unsupported-scheme' });
    expect(await probeLogo('', { fetchImpl })).toBeNull();
    expect(await probeLogo(undefined, { fetchImpl })).toBeNull();
  });
});

describe('classifyLogo', () => {
  const okProbe = (w, h, format = 'png') => ({ status: 200, contentType: 'image/png', header: { format, width: w, height: h }, ms: 10 });

  it('ok when it loads, decodes and is big enough — the size bucket is the detail', () => {
    expect(classifyLogo('https://cdn.example/logo.png', okProbe(512, 512))).toEqual({ v: 'ok', d: 'good' });
    expect(classifyLogo('https://cdn.example/logo.png', okProbe(160, 200))).toEqual({ v: 'ok', d: 'acceptable' });
    expect(classifyLogo('https://cdn.example/logo.svg', { status: 200, header: { format: 'svg' } })).toEqual({ v: 'ok', d: 'vector' });
    expect(classifyLogo('stations/x.png?v=1', { status: 'local', header: { format: 'png', width: 512, height: 512 } })).toEqual({ v: 'ok', d: 'good' });
  });

  it('warn when it loads but is too small or the URL heuristics distrust it', () => {
    expect(classifyLogo('https://cdn.example/logo.png', okProbe(48, 48))).toEqual({ v: 'warn', d: 'poor' });
    expect(classifyLogo('https://cdn.example/logo.png', { status: 200, header: { format: 'png' } })).toEqual({ v: 'warn', d: 'unknown' });
    expect(classifyLogo('https://cdn-profiles.tunein.com/s1/images/logoq.jpg', okProbe(512, 512))).toEqual({ v: 'warn', d: 'third-party' });
    expect(classifyLogo('https://upload.wikimedia.org/wikipedia/en/a/ab/Logo.png', okProbe(512, 512))).toEqual({ v: 'warn', d: 'non-free-wiki' });
  });

  it('bad with the failure token, and missing when there is nothing to load', () => {
    expect(classifyLogo(undefined, null)).toEqual({ v: 'bad', d: 'missing' });
    expect(classifyLogo('https://x/a.png', null)).toEqual({ v: 'bad', d: 'missing' });
    expect(classifyLogo('https://x/a.png', { status: 404, header: null })).toEqual({ v: 'bad', d: 'HTTP 404' });
    expect(classifyLogo('https://x/a.png', { status: 200, header: null })).toEqual({ v: 'bad', d: 'not-image' });
    expect(classifyLogo('https://x/a.png', { status: 'failed', errorToken: 'timeout' })).toEqual({ v: 'bad', d: 'timeout' });
    expect(classifyLogo('http://x/a.png', { status: 'failed', errorToken: 'http' })).toEqual({ v: 'bad', d: 'http' });
  });
});

describe('logoFailureClass', () => {
  it('splits hard from soft like the stream probe, plus the logo-only deterministic failures', () => {
    for (const d of LOGO_HARD_DETAILS) expect(logoFailureClass(d)).toBe('hard');
    for (const d of ['timeout', 'HTTP 403', 'HTTP 503', 'reset', 'tls', 'network', 'nonsense', null]) expect(logoFailureClass(d)).toBe('soft');
    expect(logoFailureClass({ v: 'bad', d: 'not-image' })).toBe('hard');
    expect(logoFailureClass({ v: 'ok', d: 'good' })).toBeNull();
  });
});

describe('toLogoObservation', () => {
  it('builds a schema-valid f:logo row with no icy field', () => {
    const row = toLogoObservation({
      station: { id: 'de-x' },
      verdict: { v: 'bad', d: 'HTTP 404' },
      probe: { status: 404, contentType: 'text/html', ms: 120 },
      at: '2026-09-09T05:00:00.123Z',
    });
    const norm = normaliseObservation(row);
    expect(norm).toEqual({ id: 'de-x', at: '2026-09-09T05:00:00Z', v: 'gha', f: 'logo', o: 'bad', c: 'hard', s: 404, ct: 'text/html', ms: 120, d: 'HTTP 404', r: false });
    expect('icy' in norm).toBe(false);
    const okRow = normaliseObservation(toLogoObservation({ station: { id: 'a' }, verdict: { v: 'ok', d: 'good' }, probe: { status: 'local', ms: 1 }, at: '2026-09-09T05:00:00Z' }));
    expect(okRow).toMatchObject({ o: 'ok', c: null, s: null, d: 'good' });
  });
});
