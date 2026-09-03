import { describe, expect, it, vi } from 'vitest';
import { classifyProbe, errorToken, handleAdminProbe, probeUrl } from './probe';

function streamResponse(status: number, contentType: string | null, bytes = 'ID3'): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bytes));
      // Never close: a live stream doesn't. The probe must hang up itself.
    },
  });
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = contentType;
  return new Response(body, { status, headers });
}

const respond = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Cache-Control': 'no-store' } });

describe('classifyProbe', () => {
  it('audio-like 2xx is ok with the content-type as detail', () => {
    expect(classifyProbe({ status: 200, contentType: 'audio/mpeg' })).toEqual({ o: 'ok', c: null, d: 'audio/mpeg' });
    expect(classifyProbe({ status: 200, contentType: 'application/vnd.apple.mpegurl' }).o).toBe('ok');
    expect(classifyProbe({ status: 200, contentType: 'application/octet-stream' }).o).toBe('ok');
  });

  it('non-audio 2xx is warn, never bad', () => {
    expect(classifyProbe({ status: 200, contentType: 'text/html' })).toEqual({
      o: 'warn',
      c: null,
      d: 'content-type "text/html"',
    });
    expect(classifyProbe({ status: 200, contentType: null }).d).toBe('content-type "?"');
  });

  it('404/410 are hard, other 4xx/5xx soft', () => {
    expect(classifyProbe({ status: 404, contentType: null })).toEqual({ o: 'bad', c: 'hard', d: 'HTTP 404' });
    expect(classifyProbe({ status: 410, contentType: null }).c).toBe('hard');
    expect(classifyProbe({ status: 403, contentType: null })).toEqual({ o: 'bad', c: 'soft', d: 'HTTP 403' });
    expect(classifyProbe({ status: 503, contentType: null }).c).toBe('soft');
  });

  it('fetch failures map to the stable error tokens', () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(errorToken(timeout)).toBe('timeout');
    expect(errorToken(new Error('getaddrinfo ENOTFOUND host'))).toBe('dns');
    expect(errorToken(new Error('connect ECONNREFUSED'))).toBe('refused');
    expect(errorToken(new Error('read ECONNRESET'))).toBe('reset');
    expect(errorToken(new Error('unable to verify the first certificate'))).toBe('tls');
    expect(errorToken(new Error('something else'))).toBe('network');
  });

  it('dns/refused are hard failures, the rest soft', () => {
    expect(classifyProbe({ status: null, contentType: null, error: new Error('ENOTFOUND') }).c).toBe('hard');
    expect(classifyProbe({ status: null, contentType: null, error: new Error('ECONNREFUSED') }).c).toBe('hard');
    expect(classifyProbe({ status: null, contentType: null, error: new Error('timeout') })).toEqual({
      o: 'bad',
      c: 'soft',
      d: 'timeout',
    });
  });
});

describe('probeUrl', () => {
  it('reads one chunk, hangs up, and reports status + content-type', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(200, 'Audio/MPEG'));
    const a = await probeUrl('https://example.org/live', fetchImpl as unknown as typeof fetch);
    expect(a).toMatchObject({ url: 'https://example.org/live', s: 200, ct: 'audio/mpeg', o: 'ok', c: null });
    expect(typeof a.ms).toBe('number');
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Icy-MetaData']).toBe('1');
    expect(init.redirect).toBe('follow');
  });

  it('turns a thrown fetch into a bad verdict instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 1.2.3.4:8000');
    });
    const a = await probeUrl('https://example.org/live', fetchImpl as unknown as typeof fetch);
    expect(a).toMatchObject({ s: null, ct: null, o: 'bad', c: 'hard', d: 'refused' });
  });

  it('classifies a 404 without needing a body', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const a = await probeUrl('https://example.org/gone', fetchImpl as unknown as typeof fetch);
    expect(a).toMatchObject({ s: 404, o: 'bad', c: 'hard', d: 'HTTP 404' });
  });
});

describe('handleAdminProbe', () => {
  it('rejects missing, unparsable and non-http urls with 400', async () => {
    for (const q of ['', '?url=notaurl', '?url=ftp://x.example/a', '?url=javascript:alert(1)']) {
      const res = await handleAdminProbe(new URL(`https://w.example/api/admin/probe${q}`), respond, vi.fn());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad url' });
    }
  });

  it('answers 200 with the probe result and no-store', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(200, 'audio/aac'));
    const res = await handleAdminProbe(
      new URL('https://w.example/api/admin/probe?url=https%3A%2F%2Fexample.org%2Flive'),
      respond,
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ url: 'https://example.org/live', o: 'ok', d: 'audio/aac' });
  });
});
