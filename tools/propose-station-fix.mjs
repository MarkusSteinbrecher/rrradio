#!/usr/bin/env node
/**
 * Broken-station fix agent (issue #507, P3).
 *
 * The last phase of the report pipeline. P1 ingested reports + receipts,
 * P2 confirmed them and upserted one `broken-station` GitHub issue per
 * station. This turns each open issue into a **catalog-fix PR**:
 *
 *   - no-audio / interruptions → re-probe the stream; if dead, find a
 *     working https replacement (http→https upgrade, then Radio Browser
 *     by stationuuid / exact name) and swap `streamUrl`; if none, propose
 *     `status: broken` (drops it from the published catalog).
 *   - wrong-logo → probe the favicon; if dead (404/error), clear it so
 *     the app falls back to a monogram.
 *   - wrong-station / wrong-info → when Radio Browser disagrees on the
 *     country, correct it; otherwise leave a research comment.
 *
 * Anything it can't fix confidently (stream recovered, favicon still
 * loads, ambiguous metadata, free-form `other`) becomes a research
 * comment on the issue instead of a guessed PR.
 *
 * The PR body carries `Closes #<issue>`. A human reviews the diff and
 * merges — that's the control point. Merging closes the issue, which
 * fires resolve-reports.yml → the Worker resolves the linked reports →
 * the apps' receipt polling notifies the reporters.
 *
 * Both data/stations.yaml (source) and public/stations.json (the shipped
 * artifact deploys serve as-is) are patched surgically — no full
 * `npm run catalog` rebuild — so each PR is a minimal, reviewable diff.
 * The weekly catalog-watch rebuild reconciles any derived-field drift.
 *
 * Pure logic is exported and unit-tested in propose-station-fix.test.mjs;
 * I/O (probe, Radio Browser, GitHub, git) lives in main().
 *
 *   GH_TOKEN            GitHub token: issues + pull-requests write (gh CLI)
 *   GITHUB_REPOSITORY   owner/repo (default MarkusSteinbrecher/rrradio)
 *   flags: --dry-run (plan only, no writes/PRs), --verbose,
 *          --limit N (max stations this run), --station <id> (target one)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { lenientProbe } from './playable-check.mjs';
import { fetchByUuid } from './rb-client.mjs';
import {
  sanitizeComment,
  faviconUrl,
  streamProbeFailed,
  faviconProbeFailed,
} from './triage-reports.mjs';
import { setStationScalar, setStationTags } from './lib/yaml-station-edit.mjs';
import { blockFavicons } from './lib/yaml-block-favicon.mjs';
import {
  findStation,
  patchStationFields,
  clearFaviconFields,
  removeStation,
} from './lib/catalog-json-patch.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const KNOWN_CATEGORIES = [
  'no-audio',
  'interruptions',
  'wrong-station',
  'wrong-logo',
  'wrong-info',
  'other',
  'unspecified',
];

const STATION_MARKER_RE = /<!-- rrradio:station-id=([A-Za-z0-9._:-]+) -->/;
const FIX_LABEL = 'broken-station-fix';
const COMMENT_MARKER = '<!-- rrradio:fix-bot -->';
// lenientProbe verdicts that mean "plays" — a replacement must hit one.
const STREAM_PASS = new Set(['ok', 'ok-hls', 'needs-playlist']);
const RB_BASE = 'https://de1.api.radio-browser.info';
const DEFAULT_MAX = 25;
const PROBE_TIMEOUT_MS = 8000;
const MAX_REPLACEMENT_PROBES = 6;

// ─── pure logic ──────────────────────────────────────────────────────

/** Station id from the issue body marker P2 writes, or null. */
export function parseStationId(issueBody) {
  const m = STATION_MARKER_RE.exec(issueBody || '');
  return m ? m[1] : null;
}

/** The known report categories carried as issue labels (drops the
 *  `broken-station` umbrella label and anything unrelated). */
export function categoriesFromLabels(labels) {
  const known = new Set(KNOWN_CATEGORIES);
  return [...new Set(labels || [])].filter((l) => known.has(l));
}

/** Stable per-station branch name → also the dedup key against open PRs. */
export function branchName(stationId) {
  return `bot/broken-fix/${String(stationId).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100)}`;
}

/** A probe verdict that means the stream actually plays. */
export function streamProbePassed(verdict) {
  return verdict != null && STREAM_PASS.has(verdict);
}

/** Radio Browser's comma/semicolon tag string → a small clean tag list. */
export function normaliseTags(rbTags) {
  if (!rbTags) return [];
  return String(rbTags)
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 6);
}

export function buildPrTitle(stationName, stationId) {
  return `Fix broken station: ${stationName} (${stationId})`.slice(0, 120);
}

function fixLine(fx) {
  const cats = fx.categories.join(', ');
  switch (fx.action) {
    case 'stream-swap':
      return `- **${cats}** — swap dead stream → \`${fx.url}\`${
        fx.codec ? ` (${fx.codec}${fx.bitrate ? ` ${fx.bitrate}kbps` : ''})` : ''
      }`;
    case 'mark-broken':
      return `- **${cats}** — \`status: broken\` (removed from the published catalog)`;
    case 'favicon-clear':
      return `- **${cats}** — clear dead favicon (app falls back to a monogram)`;
    case 'metadata':
      return `- **${cats}** — set \`country: ${fx.country}\``;
    default:
      return `- **${cats}** — ${fx.action}`;
  }
}

function footer({ generatedAt, runUrl }) {
  const stamp = [
    generatedAt ? `Generated ${generatedAt}` : null,
    runUrl ? `[workflow run](${runUrl})` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return stamp ? ['', '---', stamp] : [];
}

export function buildPrBody(station, fixes, unfixable, { issue, generatedAt, runUrl } = {}) {
  const lines = [];
  if (issue) lines.push(`Closes #${issue}`, '');
  lines.push(`Automated catalog fix for the broken-station report on **${station.name}** (\`${station.id}\`).`);
  lines.push('');
  lines.push(
    '_Generated by the broken-station fix agent (issue #507, P3). A human reviews this diff and merges; merging closes the linked report issue, which notifies the reporters via receipt polling._',
  );
  lines.push('', '## Changes');
  for (const fx of fixes) {
    lines.push(fixLine(fx));
    if (fx.evidence) lines.push(`  - ${fx.evidence}`);
  }
  if (unfixable.length) {
    lines.push('', '## Needs human follow-up (not auto-fixed)');
    for (const u of unfixable) {
      lines.push(`- **${u.categories.join(', ')}** — ${u.reason}`);
      if (u.evidence) lines.push(`  - ${u.evidence}`);
    }
  }
  if (fixes.some((f) => f.action === 'mark-broken')) {
    lines.push('', '> Tip: add the `resolved:removed` label before closing so reporters see "removed" rather than "fixed".');
  }
  lines.push(...footer({ generatedAt, runUrl }));
  return lines.join('\n');
}

export function buildResearchComment(station, unfixable, { generatedAt, runUrl } = {}) {
  const lines = [COMMENT_MARKER, ''];
  lines.push(`**Fix agent — no confident automated fix** for \`${station.id}\`. Findings for a human:`, '');
  for (const u of unfixable) {
    lines.push(`- **${u.categories.join(', ')}** — ${u.reason}`);
    if (u.evidence) lines.push(`  - ${u.evidence}`);
    if (u.suggest) lines.push(`  - suggested resolution label: \`${u.suggest}\``);
  }
  lines.push(...footer({ generatedAt, runUrl }));
  return lines.join('\n');
}

// ─── I/O ─────────────────────────────────────────────────────────────

function loadYamlText() {
  return readFileSync(join(ROOT, 'data/stations.yaml'), 'utf8');
}

function parseCatalog(yamlText) {
  const list = parseYaml(yamlText);
  const byId = new Map();
  for (const s of Array.isArray(list) ? list : []) if (s && s.id) byId.set(s.id, s);
  return byId;
}

function loadJsonPayload() {
  return JSON.parse(readFileSync(join(ROOT, 'public/stations.json'), 'utf8'));
}

function withTimeout(ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}

async function probeStreamUrl(url) {
  try {
    const res = await lenientProbe(url, { allowHttp: true });
    const verdict = res?.verdict ?? null;
    return {
      failed: streamProbeFailed({ verdict, errored: false }),
      verdict,
      reason: res?.reason ?? 'inconclusive (redirect/mixed-content)',
    };
  } catch (err) {
    return { failed: true, verdict: null, reason: `connection failed: ${String(err?.message ?? err).slice(0, 160)}` };
  }
}

async function probeFaviconUrl(url) {
  const t = withTimeout(PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: t.signal,
      headers: { 'User-Agent': 'rrradio-fix/1.0 (+https://rrradio.org)' },
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

async function rbSearchByName(name) {
  const params = new URLSearchParams({
    name,
    name_exact: 'true',
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    limit: '5',
  });
  const t = withTimeout(PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${RB_BASE}/json/stations/search?${params}`, {
      headers: { 'User-Agent': 'rrradio-fix/1.0' },
      signal: t.signal,
    });
    if (!res.ok) return [];
    return (await res.json()) ?? [];
  } catch {
    return [];
  } finally {
    t.done();
  }
}

/** The single best Radio Browser record for a catalog station: prefer
 *  the bound stationuuid, else the top exact-name hit. Null on miss. */
async function rbRecord(entry) {
  if (entry.stationuuid) {
    try {
      const recs = await fetchByUuid([entry.stationuuid]);
      if (recs?.[0]) return recs[0];
    } catch {
      /* fall through to name search */
    }
  }
  const list = await rbSearchByName(entry.name);
  return list[0] ?? null;
}

/** Find a working https replacement stream for a dead station. Tries an
 *  http→https upgrade of the current URL, then Radio Browser (by uuid,
 *  then exact name), probing https candidates until one plays. */
async function findReplacement(entry) {
  const seen = new Set([entry.streamUrl]);
  const candidates = [];
  const add = (url, extra = {}) => {
    if (!url || seen.has(url) || !/^https:\/\//i.test(url)) return;
    seen.add(url);
    candidates.push({ url, ...extra });
  };

  if (typeof entry.streamUrl === 'string' && entry.streamUrl.startsWith('http://')) {
    add('https://' + entry.streamUrl.slice('http://'.length), { source: 'https-upgrade' });
  }
  if (entry.stationuuid) {
    try {
      const recs = await fetchByUuid([entry.stationuuid]);
      const rb = recs?.[0];
      if (rb) add(rb.url_resolved || rb.url, { codec: rb.codec, bitrate: rb.bitrate, source: 'rb-uuid' });
    } catch {
      /* ignore RB errors */
    }
  }
  const named = (await rbSearchByName(entry.name))
    .filter((s) => /^https:\/\//i.test(s.url_resolved || s.url))
    .sort((a, b) => (b.lastcheckok ?? 0) - (a.lastcheckok ?? 0) || (b.clickcount ?? 0) - (a.clickcount ?? 0));
  for (const s of named) add(s.url_resolved || s.url, { codec: s.codec, bitrate: s.bitrate, source: 'rb-name' });

  for (const c of candidates.slice(0, MAX_REPLACEMENT_PROBES)) {
    const p = await probeStreamUrl(c.url);
    if (streamProbePassed(p.verdict)) {
      return {
        url: c.url,
        codec: c.codec ? String(c.codec).toUpperCase() : undefined,
        bitrate: c.bitrate && c.bitrate > 0 ? c.bitrate : undefined,
        verdict: p.verdict,
        source: c.source,
      };
    }
  }
  return null;
}

/**
 * Inspect one station against its reported categories and return the
 * planned { fixes, unfixable }. All probing/RB I/O happens here.
 */
async function inspectStation(entry, categories, { verbose } = {}) {
  const catSet = new Set(categories);
  const fixes = [];
  const unfixable = [];

  // ── stream (no-audio / interruptions) ──
  const streamCats = [...catSet].filter((c) => c === 'no-audio' || c === 'interruptions');
  if (streamCats.length) {
    const sp = await probeStreamUrl(entry.streamUrl);
    if (verbose) console.log(`    stream ${entry.streamUrl} → ${sp.failed ? 'DEAD' : 'ok'} (${sp.verdict ?? 'n/a'})`);
    if (sp.failed) {
      const repl = await findReplacement(entry);
      if (repl) {
        fixes.push({
          categories: streamCats,
          action: 'stream-swap',
          url: repl.url,
          codec: repl.codec,
          bitrate: repl.bitrate,
          evidence: `current stream ${sp.verdict ?? 'failed'} (${sp.reason}); replacement via ${repl.source} probes ${repl.verdict}`,
        });
      } else {
        fixes.push({
          categories: streamCats,
          action: 'mark-broken',
          evidence: `current stream ${sp.verdict ?? 'failed'} (${sp.reason}); no working https replacement found via http-upgrade or Radio Browser`,
        });
      }
    } else {
      unfixable.push({
        categories: streamCats,
        reason: 'stream probes OK now — likely transient or already fixed',
        evidence: `probe: ${sp.verdict} (${sp.reason})`,
        suggest: 'resolved:not-reproducible',
      });
    }
  }

  // ── favicon (wrong-logo) ──
  if (catSet.has('wrong-logo')) {
    const fav = faviconUrl(entry.favicon);
    if (!fav) {
      unfixable.push({
        categories: ['wrong-logo'],
        reason: 'no favicon set in the catalog — a logo needs sourcing (curate-logos)',
        evidence: 'favicon is empty',
      });
    } else {
      const fp = await probeFaviconUrl(fav);
      if (verbose) console.log(`    favicon ${fav} → ${fp.failed ? 'DEAD' : 'ok'} (${fp.evidence})`);
      if (fp.failed) {
        fixes.push({
          categories: ['wrong-logo'],
          action: 'favicon-clear',
          evidence: `favicon ${fav} → ${fp.evidence}; clearing so the app falls back to a monogram`,
        });
      } else {
        unfixable.push({
          categories: ['wrong-logo'],
          reason: "favicon loads — can't auto-verify it's the right image",
          evidence: `favicon ${fav} → ${fp.evidence}`,
          suggest: 'curate-logos',
        });
      }
    }
  }

  // ── metadata (wrong-station / wrong-info) ──
  const metaCats = [...catSet].filter((c) => c === 'wrong-station' || c === 'wrong-info');
  if (metaCats.length) {
    const rb = await rbRecord(entry);
    const catCountry = entry.country ? String(entry.country).toUpperCase() : '';
    const rbCountry = rb?.countrycode ? String(rb.countrycode).toUpperCase() : '';
    if (rbCountry && catCountry && rbCountry !== catCountry) {
      fixes.push({
        categories: metaCats,
        action: 'metadata',
        country: rbCountry,
        evidence: `Radio Browser lists country ${rbCountry}; catalog has ${catCountry}`,
      });
    } else {
      unfixable.push({
        categories: metaCats,
        reason: 'metadata correction needs human judgement (name / tags / country)',
        evidence: rb
          ? `RB: name=${JSON.stringify(rb.name)} country=${rbCountry || '?'} tags=${rb.tags || '?'}; catalog: name=${JSON.stringify(entry.name)} country=${catCountry || '?'}`
          : 'no Radio Browser record matched this station',
      });
    }
  }

  // ── free-form ──
  const otherCats = [...catSet].filter((c) => c === 'other' || c === 'unspecified');
  if (otherCats.length) {
    unfixable.push({
      categories: otherCats,
      reason: 'free-form report — needs human review',
      evidence: 'see the reporter comments in the issue body',
    });
  }

  return { fixes, unfixable };
}

/** Apply the planned fixes to in-memory YAML text + JSON payload copies.
 *  Returns { yaml, json } ready to write. Pure (exported for tests). */
export function applyFixes(yamlText, jsonPayload, stationId, fixes) {
  let yaml = yamlText;
  const json = structuredClone(jsonPayload);
  const jsonChanges = {};
  let unpublish = false;
  let clearFavicon = false;

  for (const fx of fixes) {
    if (fx.action === 'stream-swap') {
      yaml = setStationScalar(yaml, stationId, 'streamUrl', fx.url).text;
      jsonChanges.streamUrl = fx.url;
      if (fx.codec) {
        yaml = setStationScalar(yaml, stationId, 'codec', fx.codec).text;
        jsonChanges.codec = fx.codec;
      }
      if (fx.bitrate) {
        yaml = setStationScalar(yaml, stationId, 'bitrate', fx.bitrate).text;
        jsonChanges.bitrate = fx.bitrate;
      }
    } else if (fx.action === 'mark-broken') {
      yaml = setStationScalar(yaml, stationId, 'status', 'broken').text;
      unpublish = true;
    } else if (fx.action === 'favicon-clear') {
      yaml = blockFavicons(yaml, [stationId]).text;
      clearFavicon = true;
    } else if (fx.action === 'metadata') {
      if (fx.country) {
        yaml = setStationScalar(yaml, stationId, 'country', fx.country).text;
        jsonChanges.country = fx.country;
      }
      if (fx.tags) {
        yaml = setStationTags(yaml, stationId, fx.tags).text;
        jsonChanges.tags = fx.tags;
      }
    }
  }

  if (unpublish) {
    json.stations = removeStation(json.stations, stationId).stations;
  } else {
    patchStationFields(json.stations, stationId, jsonChanges);
    if (clearFavicon) clearFaviconFields(json.stations, stationId);
  }
  return { yaml, json };
}

// ── git / gh shells (only invoked when not in dry-run) ──
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}
function gh(args, input) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', input, maxBuffer: 1 << 26 });
}
function ghJson(args) {
  return JSON.parse(gh(args));
}

function issueHasFixBotComment(repo, number) {
  try {
    const comments = ghJson(['api', `repos/${repo}/issues/${number}/comments`, '--paginate']);
    return comments.some((c) => (c.body || '').includes(COMMENT_MARKER));
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const out = { dryRun: false, verbose: false, limit: DEFAULT_MAX, station: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--limit') out.limit = Math.max(1, Number(argv[++i]) || DEFAULT_MAX);
    else if (a === '--station') out.station = argv[++i] || null;
    else if (a === '--help' || a === '-h') {
      console.log('usage: propose-station-fix [--dry-run] [--verbose] [--limit N] [--station <id>]');
      process.exit(0);
    } else {
      console.error(`propose-station-fix: unknown argument "${a}"`);
      process.exit(1);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.dryRun || process.env.DRY_RUN === '1';
  const repo = process.env.GITHUB_REPOSITORY || 'MarkusSteinbrecher/rrradio';
  const generatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;

  // Open broken-station issues = the confirmed work queue (P2 upserts them).
  const issues = ghJson([
    'issue',
    'list',
    '--repo',
    repo,
    '--label',
    'broken-station',
    '--state',
    'open',
    '--json',
    'number,title,body,labels',
    '--limit',
    '200',
  ]);

  // Dedup: skip stations that already have an open fix PR.
  const openPrHeads = new Set(
    ghJson(['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'headRefName', '--limit', '200']).map(
      (p) => p.headRefName,
    ),
  );

  const yamlText = loadYamlText();
  const catalog = parseCatalog(yamlText);
  const jsonPayload = loadJsonPayload();
  const base = dryRun ? null : git(['rev-parse', 'HEAD']).trim();
  // Where to return between stations. On a `schedule` run actions/checkout
  // leaves a detached HEAD (abbrev-ref → "HEAD"), so fall back to the base
  // commit rather than trying to check out a ref literally named "HEAD".
  let startRef = null;
  if (!dryRun) {
    const abbrev = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    startRef = abbrev && abbrev !== 'HEAD' ? abbrev : base;
  }

  console.log(
    `propose-fix: ${issues.length} open broken-station issue(s) · ${openPrHeads.size} open PR(s)${dryRun ? ' · DRY RUN' : ''}`,
  );

  let prs = 0;
  let comments = 0;
  let processed = 0;

  for (const issue of issues) {
    if (processed >= args.limit) {
      console.warn(`propose-fix: hit --limit ${args.limit}; ${issues.length - processed} issue(s) deferred`);
      break;
    }
    const stationId = parseStationId(issue.body);
    if (!stationId) {
      if (args.verbose) console.log(`  #${issue.number}: no station-id marker — skipping`);
      continue;
    }
    if (args.station && stationId !== args.station) continue;
    const cats = categoriesFromLabels((issue.labels || []).map((l) => l.name));
    const branch = branchName(stationId);
    if (openPrHeads.has(branch)) {
      if (args.verbose) console.log(`  #${issue.number} ${stationId}: open fix PR exists — skipping`);
      continue;
    }
    const entry = catalog.get(stationId);
    processed += 1;

    if (!entry) {
      console.log(`  #${issue.number} ${stationId}: not in the bundled catalog (custom/unknown id)`);
      if (!dryRun && !issueHasFixBotComment(repo, issue.number)) {
        const body = buildResearchComment(
          { id: stationId, name: stationId },
          [{ categories: cats.length ? cats : ['unspecified'], reason: 'station id not found in data/stations.yaml — custom or already removed', evidence: 'nothing to patch' }],
          { generatedAt, runUrl },
        );
        gh(['issue', 'comment', String(issue.number), '--repo', repo, '--body-file', '-'], body);
        comments += 1;
      }
      continue;
    }

    const { fixes, unfixable } = await inspectStation(entry, cats, { verbose: args.verbose });
    console.log(
      `  #${issue.number} ${stationId} [${cats.join(',') || 'none'}] → ${fixes.length} fix(es), ${unfixable.length} for human`,
    );

    if (fixes.length === 0) {
      // Nothing actionable — leave a one-time research comment.
      if (unfixable.length === 0) continue;
      if (dryRun) {
        console.log(`  [dry-run] would comment on #${issue.number}: ${unfixable.map((u) => u.reason).join(' | ')}`);
        comments += 1;
        continue;
      }
      if (issueHasFixBotComment(repo, issue.number)) {
        if (args.verbose) console.log(`  #${issue.number}: fix-bot comment already present — skipping`);
        continue;
      }
      const body = buildResearchComment(entry, unfixable, { generatedAt, runUrl });
      gh(['issue', 'comment', String(issue.number), '--repo', repo, '--body-file', '-'], body);
      comments += 1;
      continue;
    }

    const title = buildPrTitle(entry.name, stationId);
    const body = buildPrBody(entry, fixes, unfixable, { issue: issue.number, generatedAt, runUrl });

    if (dryRun) {
      console.log(`  [dry-run] would open PR "${title}" (head ${branch})`);
      for (const fx of fixes) console.log(`            ${fixLine(fx).replace(/^- /, '')}`);
      prs += 1;
      continue;
    }

    // Build the change on a fresh branch off the base commit.
    git(['checkout', '-B', branch, base]);
    const { yaml, json } = applyFixes(yamlText, jsonPayload, stationId, fixes);
    writeFileSync(join(ROOT, 'data/stations.yaml'), yaml);
    writeFileSync(join(ROOT, 'public/stations.json'), JSON.stringify(json, null, 2) + '\n');

    // Gate the change before pushing — never open a PR that fails check-catalog.
    try {
      execFileSync('node', ['tools/check-catalog.mjs'], { cwd: ROOT, stdio: 'pipe' });
    } catch (err) {
      console.error(`  #${issue.number} ${stationId}: check-catalog failed — abandoning this fix`);
      console.error(String(err.stdout || '') + String(err.stderr || ''));
      git(['checkout', '-f', startRef]);
      git(['branch', '-D', branch]);
      continue;
    }

    git(['add', 'data/stations.yaml', 'public/stations.json']);
    git(['commit', '-m', `fix(catalog): ${title}\n\nCloses #${issue.number}`]);
    // Force-push: the branch name is stable per station, so a re-run after
    // a previous (closed-unmerged) PR overwrites its stale bot branch. Bot
    // namespace only — never main; the workflow serializes runs.
    git(['push', '--force', '-u', 'origin', branch]);
    gh([
      'pr',
      'create',
      '--repo',
      repo,
      '--head',
      branch,
      '--base',
      'main',
      '--title',
      title,
      '--body-file',
      '-',
      '--label',
      FIX_LABEL,
    ], body);
    prs += 1;
    console.log(`  #${issue.number} ${stationId}: opened PR on ${branch}`);

    // Restore the working tree for the next iteration.
    git(['checkout', '-f', startRef]);
  }

  console.log(
    `propose-fix done: ${prs} PR(s)${dryRun ? ' (planned)' : ''}, ${comments} comment(s), ${processed} issue(s) processed`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('propose-station-fix failed:', err?.stack ?? err);
    process.exit(1);
  });
}
