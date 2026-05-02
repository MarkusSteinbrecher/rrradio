/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub `track` before importing the module under test so the mock
// captures every call. Each test reads `trackCalls` to assert what
// was emitted.
const trackCalls: Array<{ path: string; title?: string }> = [];
vi.mock('./telemetry', () => ({
  track: (path: string, title?: string) => {
    trackCalls.push({ path, title });
  },
}));

const errors = await import('./errors');

beforeEach(() => {
  trackCalls.length = 0;
  errors._resetForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('truncateErrorMessage', () => {
  it('returns empty for null / undefined', () => {
    expect(errors.truncateErrorMessage(null)).toBe('');
    expect(errors.truncateErrorMessage(undefined)).toBe('');
  });

  it('coerces non-strings to a string', () => {
    expect(errors.truncateErrorMessage(42)).toBe('42');
  });

  it('collapses whitespace', () => {
    expect(errors.truncateErrorMessage('  hello\n\n   world  ')).toBe('hello world');
  });

  it('redacts http/https/file/blob URLs', () => {
    expect(errors.truncateErrorMessage('failed to load https://example.com/x?y=z')).toBe(
      'failed to load <url>',
    );
    expect(errors.truncateErrorMessage('blocked file:///Users/me/secret.txt')).toBe(
      'blocked <url>',
    );
    expect(errors.truncateErrorMessage('blob URL blob:https://x.com/abc-def gone')).toBe(
      'blob URL <url> gone',
    );
  });

  it('caps at 120 chars with ellipsis', () => {
    const long = 'x'.repeat(200);
    const out = errors.truncateErrorMessage(long);
    expect(out).toHaveLength(120);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('errorClass', () => {
  it('reads Error.name', () => {
    expect(errors.errorClass(new TypeError('oops'))).toBe('TypeError');
  });

  it('reads .name on plain objects', () => {
    expect(errors.errorClass({ name: 'AbortError' })).toBe('AbortError');
  });

  it('falls back to "Error" for primitives / unknown shapes', () => {
    expect(errors.errorClass('a string')).toBe('Error');
    expect(errors.errorClass(42)).toBe('Error');
    expect(errors.errorClass(null)).toBe('Error');
  });
});

describe('errorEvent', () => {
  it('emits to GoatCounter as error/<category>', () => {
    errors.errorEvent('catalog', new Error('boom'));
    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0].path).toBe('error: catalog');
  });

  it('title carries class + message + build + route', () => {
    errors.errorEvent('runtime', new TypeError('nope'));
    const t = trackCalls[0].title!;
    expect(t).toContain('TypeError: nope');
    expect(t).toContain('dev'); // BUILD fallback in tests
    expect(t).toContain('/');
  });

  it('appends optional detail (e.g. station id)', () => {
    errors.errorEvent('stream', new Error('audio failed'), { detail: 'station=fm4' });
    expect(trackCalls[0].title).toContain('station=fm4');
  });

  it('truncates long messages and strips URLs', () => {
    const longUrl = 'fetch failed https://broadcaster.example.com/api/v1/very-long-path?with=lots&of=query&params=here';
    errors.errorEvent('worker', new Error(longUrl));
    expect(trackCalls[0].title).toContain('<url>');
    expect(trackCalls[0].title).not.toContain('lots&of=query');
  });

  it('handles non-Error values', () => {
    errors.errorEvent('promise', 'string reason');
    expect(trackCalls[0].title).toContain('Error: string reason');
  });
});

describe('reportWorkerError', () => {
  it('encodes route + status as detail', () => {
    errors.reportWorkerError(new Error('nope'), '/api/public/totals', 502);
    expect(trackCalls[0].path).toBe('error: worker');
    expect(trackCalls[0].title).toContain('/api/public/totals@502');
  });

  it('omits @status when not provided', () => {
    errors.reportWorkerError(new Error('nope'), '/api/public/totals');
    expect(trackCalls[0].title).toContain('/api/public/totals');
    expect(trackCalls[0].title).not.toContain('@');
  });
});

describe('reportStreamError', () => {
  it('encodes the station id as detail', () => {
    errors.reportStreamError('audio failed', 'builtin-fm4');
    expect(trackCalls[0].path).toBe('error: stream');
    expect(trackCalls[0].title).toContain('station=builtin-fm4');
  });
});

describe('installGlobalErrorHandlers', () => {
  it('captures window.error events as error/runtime', () => {
    errors.installGlobalErrorHandlers();
    const ev = new ErrorEvent('error', { message: 'something broke', error: new ReferenceError('x is not defined') });
    window.dispatchEvent(ev);
    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0].path).toBe('error: runtime');
    expect(trackCalls[0].title).toContain('ReferenceError');
  });

  it('captures unhandledrejection events as error/promise', () => {
    errors.installGlobalErrorHandlers();
    // Some happy-dom builds don't expose PromiseRejectionEvent; fall
    // back to a CustomEvent that mimics the relevant `reason` field.
    const reason = new Error('rejected');
    let ev: Event;
    try {
      ev = new (globalThis as { PromiseRejectionEvent?: typeof PromiseRejectionEvent })
        .PromiseRejectionEvent!('unhandledrejection', { reason, promise: Promise.reject(reason).catch(() => {}) as Promise<unknown> });
    } catch {
      ev = Object.assign(new Event('unhandledrejection'), { reason });
    }
    window.dispatchEvent(ev);
    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0].path).toBe('error: promise');
  });

  it('is idempotent — installing twice attaches one handler', () => {
    errors.installGlobalErrorHandlers();
    errors.installGlobalErrorHandlers();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'x', error: new Error('x') }),
    );
    expect(trackCalls).toHaveLength(1);
  });
});
