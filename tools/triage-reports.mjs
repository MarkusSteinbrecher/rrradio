#!/usr/bin/env node
/**
 * Broken-station report triage (issue #507, P2).
 *
 * The cron half of the report pipeline. Reads non-resolved reports from
 * the stats Worker, aggregates them by (station, category), probes the
 * stream (no-audio / interruptions) or favicon (wrong-logo), and:
 *
 *   - confirms a category when the probe fails OR enough independent
 *     reports agree (report threshold; 1 by default, so every report
 *     confirms and gets an issue), and
 *   - upserts ONE GitHub issue per station (label `broken-station` +
 *     each confirmed category), then tells the Worker to flip the
 *     confirmed rows to `confirmed` and stamp the issue number on the
 *     station's reports so the issue-close Action can resolve them, and
 *   - opens the same issue (label `needs-review`, nothing confirmed) for
 *     a category that cannot be probed when a reporter left a comment,
 *     so the words reach a human (#820), and
 *   - lists everything still on hold in ONE digest issue (label
 *     `report-digest`), commenting when new stations appear, and resolves
 *     held reports as `not-reproducible` once they are older than
 *     HOLD_MAX_DAYS and have been listed for DIGEST_GRACE_DAYS (#819).
 *
 * P1 built ingest + receipts + manual resolve; P3 will have a curation
 * agent propose the catalog-fix PR. This sits in between: it is the
 * "received → confirmed → an issue exists" step. A human still merges
 * the fix and closes the issue.
 *
 * I/O lives in main(); everything above it is pure and unit-tested in
 * tools/triage-reports.test.mjs.
 *
 *   STATS_ADMIN_TOKEN   Worker admin bearer (required to act)
 *   GH_TOKEN            GitHub token with issues:write (required to act)
 *   GITHUB_REPOSITORY   owner/repo (default MarkusSteinbrecher/rrradio)
 *   STATS_BASE          Worker base URL (default https://stats.rrradio.org)
 *   REPORT_THRESHOLD    independent-report count to confirm (default 1:
 *                       every report; raise it if fake reports show up)
 *   HOLD_MAX_DAYS       age after which a held report is resolved as
 *                       not-reproducible (default 21; 0 disables)
 *   DIGEST_GRACE_DAYS   days a station must have been listed in the
 *                       digest before its reports may age out (default 7)
 *   flags: --dry-run (probe + plan, write nothing), --verbose
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lenientProbe } from './playable-check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Probe-able categories → which resource the prober checks. The others
// (wrong-station, wrong-info, other, unspecified) can't be auto-verified
// and rely on the report threshold alone.
export const CATEGORY_PROBE = {
  'no-audio': 'stream',
  interruptions: 'stream',
  'wrong-logo': 'favicon',
};

// lenientProbe verdicts we treat as "the stream is fine". needs-playlist
// resolves to a .pls/.m3u the app parses, so it still plays.
const STREAM_PASS = new Set(['ok', 'ok-hls', 'needs-playlist']);
// HTTP-parser quirks aren't proof the stream is down — browsers play
// these — so don't auto-confirm on them.
const STREAM_INCONCLUSIVE = new Set(['probe-inconclusive']);

const FAVICON_BASE = 'https://rrradio.org/';
const STATION_MARKER_RE = /<!-- rrradio:station-id=([A-Za-z0-9._:-]+) -->/;
// 1 = every report opens an issue and reaches the fix agent. A higher
// value brings back the hold: reports the probe cannot confirm wait in
// the digest until this many agree.
const DEFAULT_THRESHOLD = 1;
const DEFAULT_HOLD_MAX_DAYS = 21;
const DEFAULT_DIGEST_GRACE_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;
const RESOLVE_CHUNK = 100; // the Worker's RESOLVE_IDS_MAX
const REVIEW_LABEL = 'needs-review';
const DIGEST_LABEL = 'report-digest';
const DIGEST_TITLE = 'Broken-station reports on hold';
const DIGEST_MARKER = '<!-- rrradio:report-digest -->';
// `id@YYYY-MM-DD` pairs: which stations the digest listed, and since when.
const HELD_MARKER_RE = /<!-- rrradio:held=([A-Za-z0-9._:@,-]*) -->/;
const COMMENT_MAX = 500;
const TITLE_MAX = 120;
// Bound a single run so a flood of distinct stations can't blow the job
// timeout. Surfaced in the log when hit — never silently truncated.
const MAX_STATIONS_PER_RUN = 200;

// ─── pure logic ──────────────────────────────────────────────────────

/** Resolve a catalog favicon field to an absolute URL. Absolute http(s)
 *  URLs pass through; bare paths (`stations/x.png`) hang off rrradio.org;
 *  empty stays null (nothing to probe). */
export function faviconUrl(favicon) {
  if (!favicon || typeof favicon !== 'string') return null;
  if (/^https?:\/\//i.test(favicon)) return favicon;
  return FAVICON_BASE + favicon.replace(/^\/+/, '');
}

/** Stream probe → did it fail? Thrown connection = down; null verdict
 *  (redirect/mixed-content) and parser-quirk = inconclusive (not a
 *  fail); pass-set = fine; everything else (broken-*) = down. */
export function streamProbeFailed({ verdict, errored }) {
  if (errored) return true;
  if (verdict == null) return false;
  if (STREAM_PASS.has(verdict)) return false;
  if (STREAM_INCONCLUSIVE.has(verdict)) return false;
  return true;
}

/** Favicon probe → did it fail? Per the issue: 404 or timeout/network
 *  error auto-confirms wrong-logo; a present favicon (even if visually
 *  wrong) can't be auto-judged, so it relies on the threshold. */
export function faviconProbeFailed({ status, errored }) {
  if (errored) return true;
  return status === 404;
}

/** Confirm a (station, category) group when the probe failed or enough
 *  independent reports agree. */
export function decideConfirm({ probeFailed, count, threshold }) {
  return Boolean(probeFailed) || count >= threshold;
}

/** Group non-resolved report rows by station, then category. Resolved
 *  rows are dropped (their issue is closed). Returns a Map keyed by
 *  stationId. `count` is the number of reporters, not rows: a follow-up
 *  (`parentId`) on the same report in the same category is the same
 *  person saying more, so it adds its comment but not a vote. */
export function aggregate(rows) {
  const stations = new Map();
  for (const r of rows) {
    if (r.status === 'resolved') continue;
    let st = stations.get(r.stationId);
    if (!st) {
      st = {
        stationId: r.stationId,
        stationName: r.stationName || r.stationId,
        streamHost: r.streamHost || '',
        githubIssue: r.githubIssue ?? null,
        categories: new Map(),
      };
      stations.set(r.stationId, st);
    }
    if (r.stationName && !st.stationName) st.stationName = r.stationName;
    if (r.streamHost && !st.streamHost) st.streamHost = r.streamHost;
    if (r.githubIssue && !st.githubIssue) st.githubIssue = r.githubIssue;

    let cat = st.categories.get(r.category);
    if (!cat) {
      cat = { category: r.category, count: 0, receivedCount: 0, confirmedCount: 0, comments: [], rows: [], reporters: new Set() };
      st.categories.set(r.category, cat);
    }
    cat.reporters.add(r.parentId || r.id);
    cat.count = cat.reporters.size;
    cat.rows.push({ id: r.id, createdAt: r.createdAt ?? null });
    if (r.status === 'confirmed') cat.confirmedCount += 1;
    else cat.receivedCount += 1;
    const c = (r.comment || '').trim();
    if (c) cat.comments.push(c);
  }
  return stations;
}

/** Neutralize user comment text for safe inclusion in a GitHub issue
 *  body: a comment must not be able to forge the station-id marker the
 *  resolve Action greps for, nor break out of a fenced block. Zero-width
 *  spaces defuse the delimiters while staying human-readable. */
export function sanitizeComment(text) {
  if (!text) return '';
  return String(text)
    .replace(/<!--/g, '<!​--')
    .replace(/-->/g, '--​>')
    .replace(/```/g, '`​``')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .slice(0, COMMENT_MAX);
}

export function stationMarker(stationId) {
  return `<!-- rrradio:station-id=${stationId} -->`;
}

export function buildIssueTitle(station) {
  return `Broken station: ${station.stationName} (${station.stationId})`.slice(0, TITLE_MAX);
}

export function issueLabels(confirmedCategories, { needsReview = false } = {}) {
  return ['broken-station', ...new Set(confirmedCategories), ...(needsReview ? [REVIEW_LABEL] : [])];
}

/** Find the open `broken-station` issue for a station by its body
 *  marker. Returns the issue object or null. */
export function findIssueForStation(openIssues, stationId) {
  for (const issue of openIssues) {
    const m = STATION_MARKER_RE.exec(issue.body || '');
    if (m && m[1] === stationId) return issue;
  }
  return null;
}

/**
 * Decide, for one aggregated station, what to confirm and whether an
 * issue should exist. `probes` is { stream?: {failed, evidence},
 * favicon?: {failed, evidence} } gathered by the caller (I/O). Pure.
 */
export function planStation(station, probes, { threshold = DEFAULT_THRESHOLD } = {}) {
  const sections = [];
  const confirmCategories = []; // received → confirmed this run
  const labelCategories = []; // every category the (open) issue should carry
  const held = []; // categories with no issue this run — digest material
  let needsReview = false;
  for (const cat of station.categories.values()) {
    const kind = CATEGORY_PROBE[cat.category] ?? null;
    const probe = kind ? probes[kind] ?? null : null;
    const probeFailed = probe ? probe.failed : false;
    const willConfirm = decideConfirm({ probeFailed, count: cat.count, threshold });
    const alreadyConfirmed = cat.confirmedCount > 0;
    const comments = cat.comments.map(sanitizeComment).filter(Boolean);
    const probeEvidence = probe ? probe.evidence : kind ? 'not probed (no catalog entry)' : 'not probe-able';
    // A category nothing can probe never confirms below the threshold, so
    // a reporter's words would be read by nobody. Hand them to a human
    // without confirming anything (#820).
    const reviewOnly = !willConfirm && !alreadyConfirmed && !kind && comments.length > 0;
    const isActive = willConfirm || alreadyConfirmed || reviewOnly;
    if (!isActive) {
      held.push({
        category: cat.category,
        count: cat.count,
        probeKind: kind,
        probeEvidence,
        comments,
        rows: cat.rows ?? [],
      });
      continue;
    }
    labelCategories.push(cat.category);
    if (willConfirm && cat.receivedCount > 0) confirmCategories.push(cat.category);
    if (reviewOnly) needsReview = true;
    sections.push({
      category: cat.category,
      count: cat.count,
      probeKind: kind,
      probeEvidence,
      reviewOnly,
      reason: reviewOnly
        ? 'not confirmed — reporter comment on a category that cannot be probed'
        : probeFailed
          ? 'probe failed'
          : threshold <= 1
            ? `${cat.count} report(s); the probe did not fail`
            : `${cat.count} report(s) ≥ threshold ${threshold}`,
      comments,
    });
  }
  return { shouldOpenIssue: sections.length > 0, sections, confirmCategories, labelCategories, needsReview, held };
}

// ─── held reports: digest + age-out (#819) ───────────────────────────

/** `id@YYYY-MM-DD` pairs from the previous digest body → Map(id → date). */
export function parseHeldMarker(body) {
  const out = new Map();
  const m = HELD_MARKER_RE.exec(body || '');
  if (!m || !m[1]) return out;
  for (const pair of m[1].split(',')) {
    const at = pair.lastIndexOf('@');
    if (at <= 0) continue;
    const date = pair.slice(at + 1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out.set(pair.slice(0, at), date);
  }
  return out;
}

export function heldMarker(listedSince) {
  const pairs = [...listedSince.entries()].map(([id, date]) => `${id}@${date}`);
  return `<!-- rrradio:held=${pairs.join(',')} -->`;
}

/**
 * Split one held category's rows into those to resolve as
 * not-reproducible and those that stay on hold. A row ages out only when
 * it is older than `maxAgeDays` AND its station has been listed in the
 * digest for `graceDays` — so nothing is closed that a human never had
 * the chance to see. `maxAgeDays` 0 disables ageing out.
 */
export function partitionHeldRows(rows, { now, maxAgeDays, graceDays, listedSince }) {
  const expiredIds = [];
  const live = [];
  const listedMs = listedSince ? Date.parse(`${listedSince}T00:00:00Z`) : NaN;
  const graceMet = Number.isFinite(listedMs) && now - listedMs >= graceDays * DAY_MS;
  for (const r of rows) {
    const createdMs = r.createdAt ? Date.parse(r.createdAt) : NaN;
    const old = maxAgeDays > 0 && Number.isFinite(createdMs) && now - createdMs > maxAgeDays * DAY_MS;
    if (old && graceMet && r.id) expiredIds.push(r.id);
    else live.push(r);
  }
  return { expiredIds, live };
}

/** Station ids in `current` that the previous digest did not list. */
export function newlyHeld(previous, current) {
  return current.filter((id) => !previous.has(id));
}

function oldestDate(rows) {
  const dates = rows.map((r) => r.createdAt).filter(Boolean).sort();
  return dates.length ? dates[0].slice(0, 10) : null;
}

/** One digest line group for a station: `entry` is { stationId,
 *  stationName, catalogPresent, categories: held[] }. */
export function digestEntryLines(entry) {
  const lines = [`- **${sanitizeComment(entry.stationName)}** · \`${entry.stationId}\`${entry.catalogPresent ? '' : ' · not in catalog'}`];
  for (const c of entry.categories) {
    const oldest = oldestDate(c.rows);
    const bits = [
      `${c.category} ×${c.rows.length}`,
      oldest ? `since ${oldest}` : null,
      c.probeKind ? `probe (${c.probeKind}): ${c.probeEvidence}` : 'not probe-able',
    ].filter(Boolean);
    lines.push(`  - ${bits.join(' · ')}`);
    for (const comment of c.comments) {
      lines.push(`    > ${comment.replace(/\n/g, '\n    > ')}`);
    }
  }
  return lines;
}

export function buildDigestBody(entries, { listedSince, threshold, maxAgeDays, graceDays, generatedAt, runUrl } = {}) {
  const lines = [DIGEST_MARKER, heldMarker(listedSince ?? new Map()), ''];
  lines.push(
    `_Reports that automated triage could not confirm: the probe passed (or nothing could be probed) and fewer than ${threshold} reports agree. No issue exists for these stations and the reporters have no answer yet._`,
  );
  lines.push('');
  lines.push(
    maxAgeDays > 0
      ? `A report older than ${maxAgeDays} days is resolved as \`not-reproducible\` once its station has been listed here for ${graceDays} days. To act on one sooner, fix the catalog or open a \`broken-station\` issue with the station marker.`
      : 'Held reports do not age out (HOLD_MAX_DAYS=0).',
  );
  lines.push('');
  if (entries.length === 0) {
    lines.push('Nothing on hold.');
  } else {
    lines.push(`### On hold — ${entries.length} station(s)`);
    lines.push('');
    for (const e of entries) lines.push(...digestEntryLines(e));
  }
  lines.push('');
  lines.push('---');
  const stamp = [
    generatedAt ? `Last triaged ${generatedAt}` : null,
    runUrl ? `[workflow run](${runUrl})` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (stamp) lines.push(stamp);
  return lines.join('\n');
}

export function buildDigestComment(newEntries, expiredCount) {
  const lines = [];
  if (newEntries.length) {
    lines.push(`**New on hold (${newEntries.length}):**`);
    for (const e of newEntries) lines.push(...digestEntryLines(e));
  }
  if (expiredCount > 0) {
    if (lines.length) lines.push('');
    lines.push(`${expiredCount} held report(s) aged out and were resolved as \`not-reproducible\`.`);
  }
  return lines.join('\n');
}

export function buildIssueBody(station, plan, { catalogPresent, generatedAt, runUrl } = {}) {
  const lines = [];
  lines.push(stationMarker(station.stationId));
  lines.push('');
  lines.push(`**Station:** ${station.stationName} · \`${station.stationId}\``);
  if (station.streamHost) lines.push(`**Stream host:** \`${station.streamHost}\``);
  if (catalogPresent === false) {
    lines.push('');
    lines.push('> ⚠️ Not found in the bundled catalog (custom or unknown id) — stream/logo could not be auto-probed; confirmation is report-threshold only.');
  }
  lines.push('');
  lines.push('_Automated triage — confirmed by stream/favicon probe or report threshold. A human merges the fix and closes this issue with a `resolved:*` label to notify reporters._');

  for (const s of plan.sections) {
    lines.push('');
    lines.push(`### ${s.category} — ${s.count} report(s)`);
    lines.push(s.reviewOnly ? `- Needs review: ${s.reason}` : `- Confirmed by: ${s.reason}`);
    if (s.probeKind) lines.push(`- Probe (${s.probeKind}): ${s.probeEvidence}`);
    if (s.comments.length) {
      lines.push('- Reporter comments:');
      for (const c of s.comments) {
        lines.push(`  > ${c.replace(/\n/g, '\n  > ')}`);
      }
    }
  }

  lines.push('');
  lines.push('---');
  const stamp = [
    generatedAt ? `Last triaged ${generatedAt}` : null,
    runUrl ? `[workflow run](${runUrl})` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (stamp) lines.push(stamp);
  return lines.join('\n');
}

// ─── I/O ─────────────────────────────────────────────────────────────

function loadCatalog() {
  const data = JSON.parse(readFileSync(join(ROOT, 'public/stations.json'), 'utf8'));
  const byId = new Map();
  for (const s of data.stations ?? []) byId.set(s.id, s);
  return byId;
}

function withTimeout(ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}

async function probeStream(streamUrl, timeoutMs) {
  try {
    const res = await lenientProbe(streamUrl, { allowHttp: true });
    const verdict = res?.verdict ?? null;
    const failed = streamProbeFailed({ verdict, errored: false });
    return { failed, evidence: res ? `${verdict}: ${res.reason}`.slice(0, 200) : 'inconclusive (redirect/mixed-content)' };
  } catch (err) {
    void timeoutMs;
    return { failed: true, evidence: `connection failed: ${String(err?.message ?? err).slice(0, 160)}` };
  }
}

async function probeFavicon(url, timeoutMs) {
  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: t.signal,
      headers: { 'User-Agent': 'rrradio-triage/1.0 (+https://rrradio.org)' },
    });
    return {
      failed: faviconProbeFailed({ status: res.status, errored: false }),
      evidence: `HTTP ${res.status} ${res.headers.get('content-type') ?? ''}`.trim().slice(0, 120),
    };
  } catch (err) {
    return { failed: true, evidence: `fetch failed: ${String(err?.message ?? err).slice(0, 120)}` };
  } finally {
    t.done();
  }
}

async function workerGet(base, token) {
  const res = await fetch(`${base}/api/broken-reports?limit=500`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`worker GET /api/broken-reports: ${res.status}`);
  const body = await res.json();
  return body.items ?? [];
}

async function workerApplyTriage(base, token, payload) {
  const res = await fetch(`${base}/api/admin/triage-reports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`worker POST /api/admin/triage-reports: ${res.status} ${await res.text()}`);
  return res.json();
}

async function workerResolve(base, token, reportIds, resolution) {
  let resolved = 0;
  for (let i = 0; i < reportIds.length; i += RESOLVE_CHUNK) {
    const res = await fetch(`${base}/api/admin/resolve-reports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportIds: reportIds.slice(i, i + RESOLVE_CHUNK), resolution }),
    });
    if (!res.ok) throw new Error(`worker POST /api/admin/resolve-reports: ${res.status} ${await res.text()}`);
    resolved += (await res.json()).resolved ?? 0;
  }
  return resolved;
}

function ghApi(repo, token) {
  const base = `https://api.github.com/repos/${repo}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'rrradio-triage/1.0',
  };
  return {
    async listOpenBrokenIssues() {
      const out = [];
      for (let page = 1; page <= 10; page++) {
        const res = await fetch(`${base}/issues?labels=broken-station&state=open&per_page=100&page=${page}`, { headers });
        if (!res.ok) throw new Error(`gh list issues: ${res.status} ${await res.text()}`);
        const batch = await res.json();
        // The issues endpoint also returns PRs; drop them.
        out.push(...batch.filter((i) => !i.pull_request));
        if (batch.length < 100) break;
      }
      return out;
    },
    async createIssue({ title, body, labels }) {
      const res = await fetch(`${base}/issues`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, labels }),
      });
      if (!res.ok) throw new Error(`gh create issue: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async updateIssue(number, { title, body, labels }) {
      const res = await fetch(`${base}/issues/${number}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, labels }),
      });
      if (!res.ok) throw new Error(`gh update issue #${number}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async findDigestIssue() {
      const res = await fetch(`${base}/issues?labels=${DIGEST_LABEL}&state=open&per_page=100`, { headers });
      if (!res.ok) throw new Error(`gh list digest issue: ${res.status} ${await res.text()}`);
      const batch = await res.json();
      return batch.find((i) => !i.pull_request && (i.body || '').includes(DIGEST_MARKER)) ?? null;
    },
    async commentIssue(number, body) {
      const res = await fetch(`${base}/issues/${number}/comments`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`gh comment issue #${number}: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}

function parseArgs(argv) {
  const out = { dryRun: false, verbose: false };
  for (const a of argv) {
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: triage-reports [--dry-run] [--verbose]');
      process.exit(0);
    } else {
      console.error(`triage-reports: unknown argument "${a}"`);
      process.exit(1);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.dryRun || process.env.DRY_RUN === '1';
  const base = process.env.STATS_BASE || 'https://stats.rrradio.org';
  const adminToken = process.env.STATS_ADMIN_TOKEN || '';
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPOSITORY || 'MarkusSteinbrecher/rrradio';
  const threshold = Math.max(1, Number(process.env.REPORT_THRESHOLD) || DEFAULT_THRESHOLD);
  const timeoutMs = Math.max(2000, Number(process.env.PROBE_TIMEOUT_MS) || 8000);
  const envDays = (name, fallback) => {
    const n = Number(process.env[name]);
    return process.env[name] !== undefined && process.env[name] !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const maxAgeDays = envDays('HOLD_MAX_DAYS', DEFAULT_HOLD_MAX_DAYS);
  const graceDays = envDays('DIGEST_GRACE_DAYS', DEFAULT_DIGEST_GRACE_DAYS);
  const now = Date.now();
  const generatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;

  if (!adminToken) throw new Error('STATS_ADMIN_TOKEN is required');
  if (!dryRun && !ghToken) throw new Error('GH_TOKEN is required (or pass --dry-run)');

  const catalog = loadCatalog();
  const rows = await workerGet(base, adminToken);
  const stations = aggregate(rows);
  console.log(
    `triage: ${rows.length} report row(s) → ${stations.size} station(s) with open reports · threshold ${threshold}${dryRun ? ' · DRY RUN' : ''}`,
  );

  const gh = ghToken ? ghApi(repo, ghToken) : null;
  // Dedupe against existing issues only when we'll actually write. In a
  // dry run we skip the GitHub read entirely and just report intent.
  const openIssues = !dryRun && gh ? await gh.listOpenBrokenIssues() : [];

  let processed = 0;
  let confirmedCount = 0;
  let issuesOpened = 0;
  let issuesUpdated = 0;
  const heldStations = []; // stations with no issue this run → digest

  for (const station of stations.values()) {
    if (processed >= MAX_STATIONS_PER_RUN) {
      console.warn(`triage: hit MAX_STATIONS_PER_RUN (${MAX_STATIONS_PER_RUN}); ${stations.size - processed} station(s) deferred to next run`);
      break;
    }
    processed += 1;

    const entry = catalog.get(station.stationId) ?? null;
    const cats = [...station.categories.keys()];
    const needStream = cats.some((c) => CATEGORY_PROBE[c] === 'stream');
    const needFavicon = cats.some((c) => CATEGORY_PROBE[c] === 'favicon');
    const probes = {};
    if (needStream && entry?.streamUrl) probes.stream = await probeStream(entry.streamUrl, timeoutMs);
    const favUrl = entry ? faviconUrl(entry.favicon) : null;
    if (needFavicon && favUrl) probes.favicon = await probeFavicon(favUrl, timeoutMs);

    const plan = planStation(station, probes, { threshold });
    if (args.verbose) {
      console.log(
        `  ${station.stationId}: ${cats.join(',')} → ${plan.shouldOpenIssue ? `${plan.confirmCategories.length || !plan.needsReview ? 'confirm' : 'review'}[${plan.labelCategories.join(',')}]` : 'hold (no confirmation yet)'}`,
      );
    }
    if (!plan.shouldOpenIssue) {
      // Held categories of a station that does get an issue ride along
      // with it (the issue number is stamped on all its open rows).
      heldStations.push({
        stationId: station.stationId,
        stationName: station.stationName,
        catalogPresent: Boolean(entry),
        categories: plan.held,
      });
      continue;
    }

    const title = buildIssueTitle(station);
    const body = buildIssueBody(station, plan, { catalogPresent: Boolean(entry), generatedAt, runUrl });
    const labels = issueLabels(plan.labelCategories, { needsReview: plan.needsReview });

    if (dryRun) {
      console.log(`  [dry-run] would upsert issue: ${title} · labels ${labels.join(',')}`);
      console.log(`  [dry-run] would confirm ${plan.confirmCategories.join(',') || '(none new)'}`);
      confirmedCount += plan.confirmCategories.length;
      continue;
    }

    const existing = findIssueForStation(openIssues, station.stationId);
    let issueNumber;
    if (existing) {
      await gh.updateIssue(existing.number, { title, body, labels });
      issueNumber = existing.number;
      issuesUpdated += 1;
    } else {
      const created = await gh.createIssue({ title, body, labels });
      issueNumber = created.number;
      issuesOpened += 1;
    }

    const applied = await workerApplyTriage(base, adminToken, {
      stationId: station.stationId,
      confirmCategories: plan.confirmCategories,
      githubIssue: issueNumber,
    });
    confirmedCount += applied.confirmed ?? 0;
    console.log(
      `  #${issueNumber} ${existing ? 'updated' : 'opened'} for ${station.stationId} · confirmed ${applied.confirmed} · linked ${applied.linked}`,
    );
  }

  // ─── held reports: age out, then one digest issue (#819) ───
  // A dry run does not read GitHub, so it has no "listed since" dates:
  // it shows the digest it would write and ages nothing out.
  const digestIssue = !dryRun && gh ? await gh.findDigestIssue() : null;
  const previous = parseHeldMarker(digestIssue?.body ?? '');
  const today = generatedAt.slice(0, 10);
  const listedSince = new Map();
  const entries = [];
  const expiredIds = [];
  for (const st of heldStations) {
    const categories = [];
    for (const cat of st.categories) {
      const part = partitionHeldRows(cat.rows, {
        now,
        maxAgeDays,
        graceDays,
        listedSince: previous.get(st.stationId) ?? null,
      });
      expiredIds.push(...part.expiredIds);
      if (part.live.length) categories.push({ ...cat, rows: part.live });
    }
    if (!categories.length) continue;
    entries.push({ ...st, categories });
    listedSince.set(st.stationId, previous.get(st.stationId) ?? today);
  }
  const newIds = new Set(newlyHeld(previous, [...listedSince.keys()]));
  const newEntries = entries.filter((e) => newIds.has(e.stationId));

  if (dryRun) {
    console.log(`  [dry-run] would list ${entries.length} station(s) in the digest issue`);
    if (args.verbose) {
      console.log(buildDigestBody(entries, { listedSince, threshold, maxAgeDays, graceDays, generatedAt, runUrl }));
    }
  } else {
    let resolved = 0;
    if (expiredIds.length) resolved = await workerResolve(base, adminToken, expiredIds, 'not-reproducible');
    const body = buildDigestBody(entries, { listedSince, threshold, maxAgeDays, graceDays, generatedAt, runUrl });
    let number = digestIssue?.number ?? null;
    if (number) {
      await gh.updateIssue(number, { title: DIGEST_TITLE, body, labels: [DIGEST_LABEL] });
      // Editing a body notifies nobody; a comment does. Only speak up
      // when something changed for the reader.
      const note = buildDigestComment(newEntries, resolved);
      if (note) await gh.commentIssue(number, note);
    } else if (entries.length) {
      number = (await gh.createIssue({ title: DIGEST_TITLE, body, labels: [DIGEST_LABEL] })).number;
    }
    console.log(
      `  digest${number ? ` #${number}` : ''}: ${entries.length} station(s) on hold · ${newEntries.length} new · ${resolved} report(s) aged out`,
    );
  }

  console.log(
    `triage done: ${issuesOpened} opened, ${issuesUpdated} updated, ${confirmedCount} report(s) confirmed${dryRun ? ' (dry run — nothing written)' : ''}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('triage-reports failed:', err?.stack ?? err);
    process.exit(1);
  });
}
