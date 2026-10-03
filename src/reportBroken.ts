import type { ReportCategory } from './brokenReports';
import { normalizeComment } from './brokenReports';
import { STATS_WORKER_BASE } from './config';
import { truncateErrorMessage } from './errors';
import type { Station } from './types';

declare const __BUILD_VERSION__: string;
const BUILD: string =
  typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

/** Payload for POST /api/public/report-broken (broken-reports contract).
 *  The comment is omitted when empty. */
export function buildReportBody(
  station: Station,
  category: ReportCategory,
  comment: string,
  reason?: string,
): Record<string, string> {
  const body: Record<string, string> = {
    stationId: station.id,
    stationName: station.name,
    streamHost: streamHost(station.streamUrl),
    platform: 'web',
    appVersion: BUILD,
    reason: truncateErrorMessage(reason ?? ''),
    source: 'manual',
    category,
  };
  const c = normalizeComment(comment);
  if (c) body.comment = c;
  return body;
}

/** POST the report. Resolves to the server-minted receipt id, or null in
 *  degraded mode (report recorded, no receipt). Throws on non-2xx. */
export async function reportBrokenStation(
  station: Station,
  category: ReportCategory,
  comment: string,
  reason?: string,
): Promise<string | null> {
  const res = await fetch(`${STATS_WORKER_BASE}/api/public/report-broken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildReportBody(station, category, comment, reason)),
  });
  if (!res.ok) {
    throw new Error(`report failed: ${res.status}`);
  }
  try {
    const data = (await res.json()) as { reportId?: unknown };
    return typeof data.reportId === 'string' && data.reportId ? data.reportId : null;
  } catch {
    return null;
  }
}

/** GET /api/public/report-status for the given receipt ids (≤50, see
 *  idsToPoll). Returns the parsed body, or null on any failure (silent
 *  no-op per the contract). */
export async function fetchReportStatuses(ids: string[]): Promise<unknown> {
  if (ids.length === 0) return null;
  const q = encodeURIComponent(ids.join(','));
  try {
    const res = await fetch(`${STATS_WORKER_BASE}/api/public/report-status?ids=${q}`);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function streamHost(streamUrl: string): string {
  try {
    return new URL(streamUrl).host;
  } catch {
    return '';
  }
}
