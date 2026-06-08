import { describe, expect, it } from 'vitest';
import { CLASS, STRICT_FAIL, classifyStatus, classifyError, isRetryable } from './homepage-status.mjs';

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
