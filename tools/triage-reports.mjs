#!/usr/bin/env node
/**
 * Broken-station report triage (issue #507, P2).
 *
 * The cron half of the report pipeline. Reads non-resolved reports from
 * the stats Worker, aggregates them by (station, category), probes the
 * stream (no-audio / interruptions) or favicon (wrong-logo), and:
 *
 *   - confirms a category when the probe fails OR enough independent
 *     reports agree (report threshold), and
 *   - upserts ONE GitHub issue per station (label `broken-station` +
 *     each confirmed category), then tells the Worker to flip the
 *     confirmed rows to `confirmed` and stamp the issue number on the
 *     station's reports so the issue-close Action can resolve them.
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
 *   REPORT_THRESHOLD    independent-report count to confirm (default 3)
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
const DEFAULT_THRESHOLD = 3;
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
 *  stationId. */
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
      cat = { category: r.category, count: 0, receivedCount: 0, confirmedCount: 0, comments: [] };
      st.categories.set(r.category, cat);
    }
    cat.count += 1;
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

export function issueLabels(confirmedCategories) {
  return ['broken-station', ...new Set(confirmedCategories)];
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
  for (const cat of station.categories.values()) {
    const kind = CATEGORY_PROBE[cat.category] ?? null;
    const probe = kind ? probes[kind] ?? null : null;
    const probeFailed = probe ? probe.failed : false;
    const willConfirm = decideConfirm({ probeFailed, count: cat.count, threshold });
    const alreadyConfirmed = cat.confirmedCount > 0;
    const isActive = willConfirm || alreadyConfirmed;
    if (!isActive) continue;
    labelCategories.push(cat.category);
    if (willConfirm && cat.receivedCount > 0) confirmCategories.push(cat.category);
    sections.push({
      category: cat.category,
      count: cat.count,
      probeKind: kind,
      probeEvidence: probe ? probe.evidence : kind ? 'not probed (no catalog entry)' : 'not probe-able',
      reason: probeFailed ? 'probe failed' : `${cat.count} report(s) ≥ threshold ${threshold}`,
      comments: cat.comments.map(sanitizeComment).filter(Boolean),
    });
  }
  return { shouldOpenIssue: sections.length > 0, sections, confirmCategories, labelCategories };
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
    lines.push(`- Confirmed by: ${s.reason}`);
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
        `  ${station.stationId}: ${cats.join(',')} → ${plan.shouldOpenIssue ? `confirm[${plan.labelCategories.join(',')}]` : 'hold (no confirmation yet)'}`,
      );
    }
    if (!plan.shouldOpenIssue) continue;

    const title = buildIssueTitle(station);
    const body = buildIssueBody(station, plan, { catalogPresent: Boolean(entry), generatedAt, runUrl });
    const labels = issueLabels(plan.labelCategories);

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
