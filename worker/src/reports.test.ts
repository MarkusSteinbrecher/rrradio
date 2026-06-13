/**
 * Broken-station report pipeline tests (issue #507, P1): D1-backed
 * ingest with receipt ids, anonymous status polling, per-IP rate
 * limiting, and the admin resolve + triage-list endpoints. D1 is the
 * in-memory FakeD1; GoatCounter is a `globalThis.fetch` stub like the
 * rest of the worker suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import type { Env } from './index';
import { FakeD1 } from './test-d1';

let db: FakeD1;
let env: Env;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
  db = new FakeD1();
  env = {
    GOATCOUNTER_SITE: 'test.goatcounter.com',
    GOATCOUNTER_TOKEN: 'gc-token',
    ADMIN_TOKEN: 'admin-token',
    ALLOWED_ORIGIN: 'https://rrradio.org',
    DB: db.asD1(),
  };
  // GoatCounter accepts everything unless a test overrides.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://worker.test${path}`, init), env);
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function report(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return call('/api/public/report-broken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Ingest one report and return its receipt id. */
async function seedReport(over: Record<string, unknown> = {}): Promise<string> {
  const res = await report({ stationId: 'fm4', stationName: 'FM4', ...over });
  expect(res.status).toBe(202);
  const body = await json<{ reportId: string }>(res);
  expect(body.reportId).toMatch(UUID_RE);
  return body.reportId;
}

function resolveReports(body: Record<string, unknown>, token = 'admin-token'): Promise<Response> {
  return call('/api/admin/resolve-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('report ingest (POST /api/public/report-broken)', () => {
  it('stores category + comment in D1 and returns a receipt id', async () => {
    const id = await seedReport({
      category: 'no-audio',
      comment: 'Silent since Tuesday morning.',
      platform: 'ios',
    });
    const row = db.reports.get(id);
    expect(row).toMatchObject({
      station_id: 'fm4',
      station_name: 'FM4',
      category: 'no-audio',
      comment: 'Silent since Tuesday morning.',
      platform: 'ios',
      status: 'received',
      resolution: null,
      github_issue: null,
    });
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps the GoatCounter event, with category but never the comment', async () => {
    await seedReport({ category: 'wrong-logo', comment: 'top secret user text' });
    const gc = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(gc).toHaveLength(1);
    const url = new URL(String(gc[0][0]));
    expect(url.pathname).toBe('/count');
    expect(url.searchParams.get('t')).toContain('category=wrong-logo');
    expect(String(url)).not.toContain('secret');
  });

  it('maps absent or unrecognized categories to "unspecified" (old clients)', async () => {
    const plain = await seedReport({}); // pre-category payload
    expect(db.reports.get(plain)?.category).toBe('unspecified');
    const junk = await seedReport({ category: 'definitely-not-a-category' });
    expect(db.reports.get(junk)?.category).toBe('unspecified');
  });

  it('strips control characters from the comment and caps it at 500 chars', async () => {
    const id = await seedReport({
      comment: 'line one\u0000\u0007\nline two\t!' + 'x'.repeat(600),
    });
    const stored = db.reports.get(id)?.comment ?? '';
    expect(stored.startsWith('line one\nline two!')).toBe(true);
    expect(stored.length).toBe(500);
    expect(stored).not.toContain('\u0007');
  });

  it('rate-limits the 21st report from the same IP within a day', async () => {
    const ip = { 'CF-Connecting-IP': '203.0.113.7' };
    for (let i = 0; i < 20; i++) {
      const res = await report({ stationId: `s${i}` }, ip);
      expect(res.status).toBe(202);
    }
    const blocked = await report({ stationId: 'one-too-many' }, ip);
    expect(blocked.status).toBe(429);
    expect((await json(blocked)).error).toBe('rate limited');
    // A different IP is unaffected.
    const other = await report({ stationId: 'fine' }, { 'CF-Connecting-IP': '198.51.100.9' });
    expect(other.status).toBe(202);
  });

  it('still returns the receipt when GoatCounter is down (D1 is primary)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('GC down');
    }));
    const res = await report({ stationId: 'fm4' });
    expect(res.status).toBe(202);
    const body = await json<{ ok: boolean; reportId: string }>(res);
    expect(body.reportId).toMatch(UUID_RE);
    expect(db.reports.size).toBe(1);
  });

  it('falls back to the old receipt-less 202 when D1 is down but GC works', async () => {
    db.failInserts = true;
    const res = await report({ stationId: 'fm4' });
    expect(res.status).toBe(202);
    const body = await json<{ ok: boolean; reportId?: string }>(res);
    expect(body.ok).toBe(true);
    expect(body.reportId).toBeUndefined();
  });

  it('returns 502 when both D1 and GoatCounter fail', async () => {
    db.failInserts = true;
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('GC down');
    }));
    const res = await report({ stationId: 'fm4' });
    expect(res.status).toBe(502);
  });
});

describe('receipt polling (GET /api/public/report-status)', () => {
  it('returns status per known id and omits unknown ids', async () => {
    const id = await seedReport({ category: 'no-audio' });
    const ghost = '00000000-0000-4000-8000-000000000000';
    const res = await call(`/api/public/report-status?ids=${id},${ghost}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await json<{ reports: Array<Record<string, unknown>> }>(res);
    expect(body.reports).toEqual([{ id, status: 'received' }]);
  });

  it('includes resolution + resolvedAt once resolved', async () => {
    const id = await seedReport({});
    await resolveReports({ resolution: 'fixed', reportIds: [id] });
    const res = await call(`/api/public/report-status?ids=${id}`);
    const body = await json<{ reports: Array<Record<string, unknown>> }>(res);
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]).toMatchObject({ id, status: 'resolved', resolution: 'fixed' });
    expect(String(body.reports[0].resolvedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('ignores malformed ids and empty queries', async () => {
    for (const q of ['', '?ids=', "?ids=1'%3BDROP%20TABLE--,not-a-uuid"]) {
      const res = await call(`/api/public/report-status${q}`);
      expect(res.status).toBe(200);
      expect((await json<{ reports: unknown[] }>(res)).reports).toEqual([]);
    }
  });
});

describe('admin resolve (POST /api/admin/resolve-reports)', () => {
  it('requires the admin bearer token', async () => {
    const res = await resolveReports({ resolution: 'fixed', stationId: 'fm4' }, 'wrong');
    expect(res.status).toBe(401);
  });

  it('rejects non-POST with 405', async () => {
    const res = await call('/api/admin/resolve-reports', {
      headers: { Authorization: 'Bearer admin-token' },
    });
    expect(res.status).toBe(405);
  });

  it('rejects an unknown resolution and a selector-less body with 400', async () => {
    expect((await resolveReports({ resolution: 'wontfix', stationId: 'fm4' })).status).toBe(400);
    expect((await resolveReports({ resolution: 'fixed' })).status).toBe(400);
  });

  it('resolves all open reports for a station and stamps the issue number', async () => {
    const a = await seedReport({ category: 'no-audio' });
    const b = await seedReport({ category: 'interruptions' });
    const other = await seedReport({ stationId: 'swr3' });

    const res = await resolveReports({ resolution: 'fixed', stationId: 'fm4', githubIssue: 510 });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, resolved: 2 });

    for (const id of [a, b]) {
      expect(db.reports.get(id)).toMatchObject({
        status: 'resolved',
        resolution: 'fixed',
        github_issue: 510,
      });
    }
    expect(db.reports.get(other)?.status).toBe('received');

    // Idempotent: a second close resolves nothing new.
    const again = await resolveReports({ resolution: 'fixed', stationId: 'fm4', githubIssue: 510 });
    expect(await json(again)).toEqual({ ok: true, resolved: 0 });
  });

  it('scopes to a category when one is given', async () => {
    const logo = await seedReport({ category: 'wrong-logo' });
    const audio = await seedReport({ category: 'no-audio' });
    await resolveReports({ resolution: 'fixed', stationId: 'fm4', category: 'wrong-logo' });
    expect(db.reports.get(logo)?.status).toBe('resolved');
    expect(db.reports.get(audio)?.status).toBe('received');
  });

  it('resolves by linked github issue (P2 upsert linkage)', async () => {
    const id = await seedReport({});
    // Link the row to an issue first (as the P2 upserter will), then
    // resolve by issue number alone.
    await resolveReports({ resolution: 'removed', reportIds: [id], githubIssue: 511 });
    const second = await seedReport({});
    const row = db.reports.get(second);
    if (row) row.github_issue = 511;
    if (row) row.status = 'confirmed';
    const res = await resolveReports({ resolution: 'removed', githubIssue: 511 });
    expect(await json(res)).toEqual({ ok: true, resolved: 1 });
    expect(db.reports.get(second)?.status).toBe('resolved');
  });
});

describe('admin triage list (GET /api/broken-reports)', () => {
  it('requires auth', async () => {
    const res = await call('/api/broken-reports');
    expect(res.status).toBe(401);
  });

  it('returns rows with camelCase fields, filterable by status', async () => {
    const a = await seedReport({ category: 'no-audio', comment: 'dead air' });
    const b = await seedReport({ stationId: 'swr3', category: 'wrong-logo' });
    await resolveReports({ resolution: 'fixed', reportIds: [b] });

    const all = await call('/api/broken-reports', {
      headers: { Authorization: 'Bearer admin-token' },
    });
    expect(all.status).toBe(200);
    expect(all.headers.get('Cache-Control')).toBe('no-store');
    const allBody = await json<{ items: Array<Record<string, unknown>>; total: number }>(all);
    expect(allBody.total).toBe(2);
    expect(allBody.items.map((i) => i.id)).toContain(a);
    const rowA = allBody.items.find((i) => i.id === a);
    expect(rowA).toMatchObject({
      stationId: 'fm4',
      category: 'no-audio',
      comment: 'dead air',
      status: 'received',
    });

    const open = await call('/api/broken-reports?status=received', {
      headers: { Authorization: 'Bearer admin-token' },
    });
    const openBody = await json<{ items: Array<Record<string, unknown>> }>(open);
    expect(openBody.items.map((i) => i.id)).toEqual([a]);

    const bad = await call('/api/broken-reports?status=nonsense', {
      headers: { Authorization: 'Bearer admin-token' },
    });
    expect(bad.status).toBe(400);
  });
});
