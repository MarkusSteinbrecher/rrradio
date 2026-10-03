import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addReceipt,
  applyStatuses,
  canSendReport,
  idsToPoll,
  loadReceipts,
  MAX_RECEIPT_AGE_MS,
  normalizeComment,
  pruneReceipts,
  receiptForStation,
  receiptStatusText,
  RESOLVED_LINGER_MS,
  saveReceipts,
  type ReportReceipt,
} from './brokenReports';
import { buildReportBody, fetchReportStatuses, reportBrokenStation } from './reportBroken';
import type { Station } from './types';

const NOW = Date.UTC(2026, 9, 3, 12);
const DAY = 24 * 3600 * 1000;

function receipt(over: Partial<ReportReceipt> = {}): ReportReceipt {
  return {
    id: 'r1',
    stationId: 'builtin-fm4',
    stationName: 'FM4',
    category: 'no-audio',
    sentAt: NOW - DAY,
    status: 'received',
    seen: false,
    ...over,
  };
}

const fm4: Station = {
  id: 'builtin-fm4',
  name: 'FM4',
  streamUrl: 'https://orf-live.example/fm4.mp3',
} as Station;

describe('canSendReport / normalizeComment', () => {
  it('needs a category; "other" also needs a comment', () => {
    expect(canSendReport(null, 'text')).toBe(false);
    expect(canSendReport('no-audio', '')).toBe(true);
    expect(canSendReport('other', '   ')).toBe(false);
    expect(canSendReport('other', 'it plays jazz')).toBe(true);
  });
  it('trims, caps at 500 and drops empty comments', () => {
    expect(normalizeComment('  hi  ')).toBe('hi');
    expect(normalizeComment('   ')).toBeUndefined();
    expect(normalizeComment('x'.repeat(600))).toHaveLength(500);
  });
});

describe('receipt store', () => {
  beforeEach(() => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips through localStorage and ignores junk', () => {
    saveReceipts([receipt(), { bogus: true } as unknown as ReportReceipt]);
    expect(loadReceipts()).toEqual([receipt()]);
    localStorage.setItem('rrradio.brokenReports.receipts.v1', '{not json');
    expect(loadReceipts()).toEqual([]);
  });

  it('addReceipt replaces by id; receiptForStation picks the latest', () => {
    let list = addReceipt([], receipt({ id: 'a', sentAt: NOW - 3 * DAY }));
    list = addReceipt(list, receipt({ id: 'b', sentAt: NOW - DAY }));
    list = addReceipt(list, receipt({ id: 'a', sentAt: NOW - 5 * DAY }));
    expect(list).toHaveLength(2);
    expect(receiptForStation(list, 'builtin-fm4')?.id).toBe('b');
    expect(receiptForStation(list, 'other')).toBeUndefined();
  });

  it('prunes after 90 days, and seen resolutions 7 days after resolving', () => {
    const old = receipt({ id: 'old', sentAt: NOW - MAX_RECEIPT_AGE_MS - 1 });
    const seenDone = receipt({
      id: 'seen',
      status: 'resolved',
      seen: true,
      resolvedAt: NOW - RESOLVED_LINGER_MS - 1,
    });
    const unseenDone = receipt({
      id: 'unseen',
      status: 'resolved',
      seen: false,
      resolvedAt: NOW - RESOLVED_LINGER_MS - 1,
    });
    const fresh = receipt({ id: 'fresh' });
    expect(pruneReceipts([old, seenDone, unseenDone, fresh], NOW).map((r) => r.id)).toEqual([
      'unseen',
      'fresh',
    ]);
  });
});

describe('applyStatuses', () => {
  const held = [receipt({ id: 'a' }), receipt({ id: 'b' })];

  it('applies status/resolution and drops ids the server omitted', () => {
    const out = applyStatuses(held, {
      reports: [
        { id: 'a', status: 'resolved', resolution: 'fixed', resolvedAt: '2026-10-02T09:12:33.000Z' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'a',
      status: 'resolved',
      resolution: 'fixed',
      resolvedAt: Date.parse('2026-10-02T09:12:33.000Z'),
    });
  });

  it('accepts a bare array and ignores unknown status values', () => {
    const out = applyStatuses(held, [
      { id: 'a', status: 'confirmed' },
      { id: 'b', status: 'exploded' },
    ]);
    expect(out.map((r) => r.status)).toEqual(['confirmed', 'received']);
  });

  it('a malformed payload changes nothing', () => {
    expect(applyStatuses(held, { nope: 1 })).toBe(held);
    expect(applyStatuses(held, 'x')).toBe(held);
  });

  it('keeps receipts that were not part of this poll (over the 50-id cap)', () => {
    const many = Array.from({ length: 55 }, (_, i) =>
      receipt({ id: `id${i}`, sentAt: NOW - i * 1000 }),
    );
    const ids = idsToPoll(many);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('id0');
    const out = applyStatuses(many, { reports: [] }, ids);
    expect(out.map((r) => r.id)).toEqual(['id50', 'id51', 'id52', 'id53', 'id54']);
  });
});

describe('receiptStatusText', () => {
  it('uses the iOS wording per state', () => {
    expect(receiptStatusText(receipt())).toMatch(/look into it/);
    expect(receiptStatusText(receipt({ status: 'confirmed' }))).toMatch(/fix in progress/);
    expect(receiptStatusText(receipt({ status: 'resolved', resolution: 'removed' }))).toMatch(
      /removed/,
    );
    expect(
      receiptStatusText(receipt({ status: 'resolved', resolution: 'not-reproducible' })),
    ).toMatch(/couldn't reproduce/);
    expect(receiptStatusText(receipt({ status: 'resolved' }))).toMatch(/fixed/);
  });
});

describe('reportBroken client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends category and a trimmed comment; omits an empty comment', () => {
    const body = buildReportBody(fm4, 'interruptions', '  drops every minute ', 'stalled');
    expect(body).toMatchObject({
      stationId: 'builtin-fm4',
      streamHost: 'orf-live.example',
      platform: 'web',
      source: 'manual',
      category: 'interruptions',
      comment: 'drops every minute',
      reason: 'stalled',
    });
    expect(buildReportBody(fm4, 'no-audio', '  ')).not.toHaveProperty('comment');
  });

  it('returns the receipt id, or null in degraded mode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, reportId: 'abc' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(reportBrokenStation(fm4, 'no-audio', '')).resolves.toBe('abc');
    await expect(reportBrokenStation(fm4, 'no-audio', '')).resolves.toBeNull();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, string>;
    expect(sent.category).toBe('no-audio');
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(reportBrokenStation(fm4, 'other', 'x')).rejects.toThrow(/429/);
  });

  it('status poll is a silent no-op on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchReportStatuses(['a'])).resolves.toBeNull();
    await expect(fetchReportStatuses([])).resolves.toBeNull();
  });
});
