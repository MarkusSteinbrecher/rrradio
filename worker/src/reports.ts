/**
 * Broken-station report pipeline (issue #507, P1).
 *
 * Reports land in the D1 `broken_reports` table; the row id doubles as
 * the anonymous receipt token the client polls with. The GoatCounter
 * event the old endpoint emitted is kept (best-effort) so the existing
 * admin dashboard keeps working, but D1 is the primary record.
 *
 *   POST /api/public/report-broken   — ingest, returns { ok, reportId }
 *   GET  /api/public/report-status   — receipt polling (?ids=a,b,c)
 *   POST /api/admin/resolve-reports  — mark reports resolved (Bearer ADMIN_TOKEN)
 *   GET  /api/broken-reports         — recent rows for triage (Bearer ADMIN_TOKEN)
 *
 * Lifecycle: received → confirmed (P2 prober / report threshold)
 * → resolved (fixed | removed | not-reproducible). P1 ships ingest,
 * polling, and resolve; nothing here moves rows to `confirmed` yet.
 */

import type { Env } from './env';
import { noStoreJsonResponse } from './respond';

export const CATEGORIES = [
  'no-audio',
  'interruptions',
  'wrong-station',
  'wrong-logo',
  'wrong-info',
  'other',
] as const;

export const RESOLUTIONS = ['fixed', 'removed', 'not-reproducible'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

const REPORT_STATUSES = ['received', 'confirmed', 'resolved'] as const;

const COMMENT_MAX = 500;
/** Per-IP ingest cap. Generous for a human (you'd have to report 20
 *  stations in a day) but stops scripted flooding. */
const RATE_LIMIT_PER_DAY = 20;
const STATUS_IDS_MAX = 50;
const RESOLVE_IDS_MAX = 100;

/**
 * Statements as named constants so the test suite's fake D1 dispatches
 * on statement identity instead of parsing SQL. Receipt ids never go
 * through string interpolation — always bound parameters.
 */
export const SQL = {
  insertReport:
    "INSERT INTO broken_reports (id, station_id, station_name, stream_host, category, comment, platform, app_version, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)",
  upsertRate:
    'INSERT INTO report_rate (ip_hash, day, count) VALUES (?, ?, 1) ON CONFLICT (ip_hash, day) DO UPDATE SET count = count + 1 RETURNING count',
  purgeRate: 'DELETE FROM report_rate WHERE day < ?',
  selectStatus:
    'SELECT id, status, resolution, resolved_at FROM broken_reports WHERE id = ?',
  resolveById:
    "UPDATE broken_reports SET status = 'resolved', resolution = ?, resolved_at = ?, github_issue = COALESCE(?, github_issue) WHERE id = ? AND status != 'resolved'",
  resolveByStation:
    "UPDATE broken_reports SET status = 'resolved', resolution = ?, resolved_at = ?, github_issue = COALESCE(?, github_issue) WHERE station_id = ? AND status != 'resolved'",
  resolveByStationCategory:
    "UPDATE broken_reports SET status = 'resolved', resolution = ?, resolved_at = ?, github_issue = COALESCE(?, github_issue) WHERE station_id = ? AND category = ? AND status != 'resolved'",
  resolveByIssue:
    "UPDATE broken_reports SET status = 'resolved', resolution = ?, resolved_at = ?, github_issue = COALESCE(?, github_issue) WHERE github_issue = ? AND status != 'resolved'",
  selectRecent:
    'SELECT id, station_id, station_name, stream_host, category, comment, platform, app_version, reason, status, resolution, created_at, resolved_at, github_issue FROM broken_reports ORDER BY created_at DESC LIMIT ?',
  selectRecentByStatus:
    'SELECT id, station_id, station_name, stream_host, category, comment, platform, app_version, reason, status, resolution, created_at, resolved_at, github_issue FROM broken_reports WHERE status = ? ORDER BY created_at DESC LIMIT ?',
} as const;

interface StatusRow {
  id: string;
  status: string;
  resolution: string | null;
  resolved_at: string | null;
}

interface ReportRow extends StatusRow {
  station_id: string;
  station_name: string;
  stream_host: string;
  category: string;
  comment: string;
  platform: string;
  app_version: string;
  reason: string;
  created_at: string;
  github_issue: number | null;
}

function cleanField(value: unknown, max = 120): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanHost(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).host.slice(0, 120);
  } catch {
    return cleanField(value, 120);
  }
}

function cleanReportedHost(data: Record<string, unknown>): string {
  const host = cleanToken(data.streamHost, '', 120);
  if (host) return host;
  // Backward compatibility for older clients. New clients send only
  // streamHost so query strings never reach this Worker.
  return cleanHost(data.streamUrl);
}

function cleanToken(value: unknown, fallback: string, max = 40): string {
  const cleaned = cleanField(value, max).replace(/[^a-z0-9._:-]/gi, '-');
  return cleaned || fallback;
}

/** User-authored free text. Newlines survive; other control characters
 *  are stripped, runs of spaces collapse, length capped. Stored as
 *  plain text — anything rendering it (GitHub issue bodies in P2)
 *  escapes at the output edge. */
function cleanComment(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, COMMENT_MAX);
}

function parseCategory(value: unknown): string {
  // Absent or unrecognized → 'unspecified' so pre-category clients
  // keep working unchanged.
  const raw = cleanToken(value, '', 24);
  return (CATEGORIES as readonly string[]).includes(raw) ? raw : 'unspecified';
}

const RECEIPT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseReceiptIds(raw: string, max: number): string[] {
  const ids = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => RECEIPT_RE.test(s));
  return [...new Set(ids)].slice(0, max);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function recordGoatCounterEvent(path: string, title: string, env: Env): Promise<void> {
  const params = new URLSearchParams({
    p: path,
    t: title,
    e: '1',
  });
  const res = await fetch(`https://${env.GOATCOUNTER_SITE}/count?${params}`, {
    headers: {
      'User-Agent': 'rrradio-stats/1.0 (+https://rrradio.org)',
      Accept: 'image/gif,*/*',
    },
  });
  if (!res.ok) {
    throw new Error(`goatcounter count failed: ${res.status}`);
  }
}

/** True when this IP already spent its daily report budget. Fail-open:
 *  a D1 hiccup must not block a legitimate report. The hash is salted
 *  with the day + a server secret so the stored key is neither
 *  reversible nor linkable across days. */
async function isRateLimited(req: Request, env: Env): Promise<boolean> {
  const ip = req.headers.get('CF-Connecting-IP') ?? '';
  if (!ip) return false;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ipHash = await sha256Hex(`${day}:${ip}:${env.ADMIN_TOKEN}`);
    const row = await env.DB.prepare(SQL.upsertRate)
      .bind(ipHash, day)
      .first<{ count: number }>();
    await env.DB.prepare(SQL.purgeRate).bind(day).run();
    return (row?.count ?? 0) > RATE_LIMIT_PER_DAY;
  } catch (err) {
    console.error('[report-rate]', err instanceof Error ? err.message : String(err));
    return false;
  }
}

export async function handleReportBroken(
  req: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const raw = await req.text();
  if (raw.length > 4096) {
    return noStoreJsonResponse({ error: 'payload too large' }, 413, headers);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return noStoreJsonResponse({ error: 'invalid json' }, 400, headers);
  }
  const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const stationId = cleanToken(data.stationId, '');
  if (!stationId) {
    return noStoreJsonResponse({ error: 'stationId required' }, 400, headers);
  }

  if (await isRateLimited(req, env)) {
    return noStoreJsonResponse({ error: 'rate limited' }, 429, headers);
  }

  const stationName = cleanField(data.stationName, 90) || stationId;
  const streamHost = cleanReportedHost(data);
  const platform = cleanToken(data.platform, 'unknown', 24);
  const appVersion = cleanField(data.appVersion, 48);
  const reason = cleanField(data.reason, 160);
  const source = cleanToken(data.source, 'manual', 24);
  const category = parseCategory(data.category);
  const comment = cleanComment(data.comment);

  // D1 is the primary record; the receipt only exists if the row does.
  let reportId: string | null = crypto.randomUUID();
  try {
    await env.DB.prepare(SQL.insertReport)
      .bind(
        reportId,
        stationId,
        stationName,
        streamHost,
        category,
        comment,
        platform,
        appVersion,
        reason,
        new Date().toISOString(),
      )
      .run();
  } catch (err) {
    console.error('[report-insert]', err instanceof Error ? err.message : String(err));
    reportId = null;
  }

  // Keep the GoatCounter event so the existing admin dashboard's
  // reports card keeps working. Best-effort: the comment never goes to
  // GC (user-authored text stays in D1), and a GC failure doesn't fail
  // the report as long as the D1 row landed.
  const title = [
    `station=${stationId}`,
    streamHost ? `host=${streamHost}` : '',
    `platform=${platform}`,
    appVersion ? `app=${appVersion}` : '',
    `category=${category}`,
    reason ? `reason=${reason}` : '',
    `source=${source}`,
  ]
    .filter(Boolean)
    .join(' · ');
  let gcOk = true;
  try {
    await recordGoatCounterEvent(`report-broken: ${stationName}`, title, env);
  } catch (err) {
    gcOk = false;
    console.error('[report-gc]', err instanceof Error ? err.message : String(err));
  }

  if (!reportId && !gcOk) {
    // Both stores failed — don't pretend the report landed.
    return noStoreJsonResponse({ error: 'store failed' }, 502, headers);
  }
  return noStoreJsonResponse(reportId ? { ok: true, reportId } : { ok: true }, 202, headers);
}

/** GET /api/public/report-status?ids=a,b,c — anonymous receipt polling.
 *  Unknown ids are omitted (client treats as expired). no-store: a
 *  resolution must be visible on the next poll, and receipts are
 *  per-reporter anyway. */
export async function handleReportStatus(
  url: URL,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const ids = parseReceiptIds(url.searchParams.get('ids') ?? '', STATUS_IDS_MAX);
  if (ids.length === 0) {
    return noStoreJsonResponse({ reports: [] }, 200, headers);
  }
  const results = await env.DB.batch<StatusRow>(
    ids.map((id) => env.DB.prepare(SQL.selectStatus).bind(id)),
  );
  const reports = results
    .flatMap((r) => r.results ?? [])
    .map((row) => ({
      id: row.id,
      status: row.status,
      ...(row.resolution ? { resolution: row.resolution } : {}),
      ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
    }));
  return noStoreJsonResponse({ reports }, 200, headers);
}

/** POST /api/admin/resolve-reports — mark reports resolved. Selectors
 *  (reportIds, stationId [+ category], githubIssue) are OR-combined;
 *  at least one is required. Already-resolved rows are never touched,
 *  so overlapping selectors don't double-count. Called by the
 *  issue-close GitHub Action and by hand. */
export async function handleResolveReports(
  req: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const raw = await req.text();
  if (raw.length > 16384) {
    return noStoreJsonResponse({ error: 'payload too large' }, 413, headers);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return noStoreJsonResponse({ error: 'invalid json' }, 400, headers);
  }
  const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  const resolution = cleanToken(data.resolution, '', 24);
  if (!(RESOLUTIONS as readonly string[]).includes(resolution)) {
    return noStoreJsonResponse(
      { error: `resolution must be one of: ${RESOLUTIONS.join(', ')}` },
      400,
      headers,
    );
  }

  const reportIds = Array.isArray(data.reportIds)
    ? parseReceiptIds(data.reportIds.filter((v) => typeof v === 'string').join(','), RESOLVE_IDS_MAX)
    : [];
  const stationId = cleanToken(data.stationId, '');
  const category = cleanToken(data.category, '', 24);
  const githubIssue =
    typeof data.githubIssue === 'number' && Number.isInteger(data.githubIssue) && data.githubIssue > 0
      ? data.githubIssue
      : null;

  if (reportIds.length === 0 && !stationId && !githubIssue) {
    return noStoreJsonResponse(
      { error: 'at least one of reportIds, stationId, githubIssue required' },
      400,
      headers,
    );
  }

  const resolvedAt = new Date().toISOString();
  const stmts: D1PreparedStatement[] = reportIds.map((id) =>
    env.DB.prepare(SQL.resolveById).bind(resolution, resolvedAt, githubIssue, id),
  );
  if (stationId && category) {
    stmts.push(
      env.DB.prepare(SQL.resolveByStationCategory).bind(
        resolution,
        resolvedAt,
        githubIssue,
        stationId,
        category,
      ),
    );
  } else if (stationId) {
    stmts.push(env.DB.prepare(SQL.resolveByStation).bind(resolution, resolvedAt, githubIssue, stationId));
  }
  if (githubIssue) {
    stmts.push(env.DB.prepare(SQL.resolveByIssue).bind(resolution, resolvedAt, githubIssue, githubIssue));
  }

  const results = await env.DB.batch(stmts);
  const resolved = results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
  return noStoreJsonResponse({ ok: true, resolved }, 200, headers);
}

/** GET /api/broken-reports — recent report rows for manual triage
 *  (admin dashboard / curl). Optional ?status=received|confirmed|resolved,
 *  ?limit=N (1–500, default 200). no-store: triage wants live state,
 *  not a 5-minute-old snapshot. */
export async function handleAdminReportsList(
  url: URL,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const statusFilter = url.searchParams.get('status') ?? '';
  if (statusFilter && !(REPORT_STATUSES as readonly string[]).includes(statusFilter)) {
    return noStoreJsonResponse(
      { error: `status must be one of: ${REPORT_STATUSES.join(', ')}` },
      400,
      headers,
    );
  }
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));

  const stmt = statusFilter
    ? env.DB.prepare(SQL.selectRecentByStatus).bind(statusFilter, limit)
    : env.DB.prepare(SQL.selectRecent).bind(limit);
  const { results } = await stmt.all<ReportRow>();

  const items = (results ?? []).map((row) => ({
    id: row.id,
    stationId: row.station_id,
    stationName: row.station_name,
    streamHost: row.stream_host,
    category: row.category,
    comment: row.comment,
    platform: row.platform,
    appVersion: row.app_version,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    githubIssue: row.github_issue,
  }));
  return noStoreJsonResponse({ items, total: items.length }, 200, headers);
}
