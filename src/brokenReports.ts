/**
 * Broken-station report receipts (#614) — the web half of the receipt
 * lifecycle in docs/spec/contracts/broken-reports.md. Mirrors iOS
 * `BrokenStationReports.swift`: the six categories, the local receipt
 * store, the status-payload merge and the 90d / 7d retention prune.
 *
 * Pure functions over plain arrays; persistence is a thin localStorage
 * wrapper (`loadReceipts` / `saveReceipts`). Receipts are device-local
 * and never attached to any other request.
 */
import { getString, setString } from './storage';

export const REPORT_CATEGORIES = [
  'no-audio',
  'interruptions',
  'wrong-station',
  'wrong-logo',
  'wrong-info',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** iOS `reportCategory*` English strings. */
export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  'no-audio': "No audio / won't play",
  interruptions: 'Buffering or dropouts',
  'wrong-station': 'Plays the wrong station',
  'wrong-logo': 'Wrong or missing logo',
  'wrong-info': 'Wrong name or details',
  other: 'Something else',
};

export const COMMENT_MAX = 500;

export type ReceiptStatus = 'received' | 'confirmed' | 'resolved';
export type ReceiptResolution = 'fixed' | 'removed' | 'not-reproducible';

export interface ReportReceipt {
  id: string;
  stationId: string;
  stationName: string;
  category: ReportCategory;
  /** ms since epoch */
  sentAt: number;
  status: ReceiptStatus;
  resolution?: ReceiptResolution;
  /** ms since epoch */
  resolvedAt?: number;
  /** The resolved toast fires once; survives reloads. */
  seen: boolean;
}

const STORAGE_KEY = 'rrradio.brokenReports.receipts.v1';
const DAY = 24 * 3600 * 1000;
export const MAX_RECEIPT_AGE_MS = 90 * DAY;
export const RESOLVED_LINGER_MS = 7 * DAY;
/** Server reads at most this many ids per status call. */
export const STATUS_IDS_MAX = 50;

const STATUSES: readonly string[] = ['received', 'confirmed', 'resolved'];
const RESOLUTIONS: readonly string[] = ['fixed', 'removed', 'not-reproducible'];

/** "Something else" carries no signal without words. */
export function canSendReport(category: ReportCategory | null, comment: string): boolean {
  if (!category) return false;
  if (category === 'other') return comment.trim().length > 0;
  return true;
}

/** Trimmed, capped comment; undefined when empty (omitted from payload). */
export function normalizeComment(comment: string): string | undefined {
  const trimmed = comment.trim().slice(0, COMMENT_MAX);
  return trimmed ? trimmed : undefined;
}

function isReceipt(v: unknown): v is ReportReceipt {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.stationId === 'string' &&
    typeof r.stationName === 'string' &&
    typeof r.category === 'string' &&
    (REPORT_CATEGORIES as readonly string[]).includes(r.category) &&
    typeof r.sentAt === 'number' &&
    typeof r.status === 'string' &&
    STATUSES.includes(r.status)
  );
}

export function loadReceipts(): ReportReceipt[] {
  try {
    const parsed = JSON.parse(getString(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(isReceipt) : [];
  } catch {
    return [];
  }
}

export function saveReceipts(receipts: ReportReceipt[]): void {
  setString(STORAGE_KEY, JSON.stringify(receipts));
}

export function addReceipt(receipts: ReportReceipt[], receipt: ReportReceipt): ReportReceipt[] {
  return [...receipts.filter((r) => r.id !== receipt.id), receipt];
}

/** Latest receipt for a station — drives the "Reported" status line. */
export function receiptForStation(
  receipts: ReportReceipt[],
  stationId: string,
): ReportReceipt | undefined {
  let latest: ReportReceipt | undefined;
  for (const r of receipts) {
    if (r.stationId === stationId && (!latest || r.sentAt > latest.sentAt)) latest = r;
  }
  return latest;
}

/** 90 days after sending, or 7 days past a *seen* resolution → drop. */
export function pruneReceipts(receipts: ReportReceipt[], now: number): ReportReceipt[] {
  return receipts.filter((r) => {
    if (now - r.sentAt > MAX_RECEIPT_AGE_MS) return false;
    if (
      r.status === 'resolved' &&
      r.seen &&
      r.resolvedAt !== undefined &&
      now - r.resolvedAt > RESOLVED_LINGER_MS
    ) {
      return false;
    }
    return true;
  });
}

/** The ids for one status call: newest first, capped at the server's
 *  per-call limit. */
export function idsToPoll(receipts: ReportReceipt[]): string[] {
  return [...receipts]
    .sort((a, b) => b.sentAt - a.sentAt)
    .slice(0, STATUS_IDS_MAX)
    .map((r) => r.id);
}

/** Merge a `report-status` payload (`{reports:[…]}` or a bare array) into
 *  the held receipts. Polled ids missing from a well-formed payload
 *  expired server-side and are dropped (receipts that weren't in this
 *  call — over the 50-id cap — are kept as-is); a malformed payload
 *  changes nothing. */
export function applyStatuses(
  receipts: ReportReceipt[],
  payload: unknown,
  polledIds: readonly string[] = receipts.map((r) => r.id),
): ReportReceipt[] {
  const polled = new Set(polledIds);
  let entries: unknown[];
  if (Array.isArray(payload)) entries = payload;
  else if (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as { reports?: unknown }).reports)
  ) {
    entries = (payload as { reports: unknown[] }).reports;
  } else {
    return receipts;
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (const e of entries) {
    if (typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string') {
      byId.set((e as { id: string }).id, e as Record<string, unknown>);
    }
  }
  const out: ReportReceipt[] = [];
  for (const r of receipts) {
    const e = byId.get(r.id);
    if (!e) {
      if (!polled.has(r.id)) out.push(r);
      continue;
    }
    const next = { ...r };
    if (typeof e.status === 'string' && STATUSES.includes(e.status)) {
      next.status = e.status as ReceiptStatus;
    }
    if (typeof e.resolution === 'string' && RESOLUTIONS.includes(e.resolution)) {
      next.resolution = e.resolution as ReceiptResolution;
    }
    if (typeof e.resolvedAt === 'string') {
      const t = Date.parse(e.resolvedAt);
      if (Number.isFinite(t)) next.resolvedAt = t;
    }
    out.push(next);
  }
  return out;
}

/** iOS `reportStatus*` wording for the per-station status line. */
export function receiptStatusText(r: ReportReceipt): string {
  switch (r.status) {
    case 'received':
      return "Report sent — we'll look into it";
    case 'confirmed':
      return 'Confirmed — fix in progress';
    case 'resolved':
      if (r.resolution === 'removed') return 'Station removed from the catalog';
      if (r.resolution === 'not-reproducible') return "Checked — we couldn't reproduce it";
      return 'Your report was addressed — fixed';
  }
}

/** One-shot resolved toast text, e.g. "FM4: fixed". */
export function resolvedToastText(r: ReportReceipt): string {
  const outcome =
    r.resolution === 'removed'
      ? 'removed from the catalog'
      : r.resolution === 'not-reproducible'
        ? "we couldn't reproduce it"
        : 'fixed';
  return `Your report on ${r.stationName}: ${outcome}`;
}
