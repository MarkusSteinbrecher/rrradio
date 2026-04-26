#!/usr/bin/env node
/**
 * Generates the "station backlog" — every station real visitors have
 * played (per GoatCounter), with Radio Browser lookup + stream probe
 * + verdict so you can see at a glance what's curatable, what's
 * blocked, and why.
 *
 * Reads:
 *   - the public worker's /api/public/top-stations  (the play counts)
 *   - data/stations.yaml                            (already curated)
 *   - Radio Browser per name                        (stream + favicon)
 *
 * Writes:
 *   - public/station-backlog.json   (consumed by the admin dashboard)
 *
 *   npm run backlog                — last 30 days, top 30
 *   npm run backlog -- 90 50       — explicit days / limit
 *
 * Verdicts:
 *   already-curated    — in data/stations.yaml; nothing to do here
 *   auto-curate-ready  — RB has https stream that probes OK → safe to import
 *   needs-https        — only http variants exist (mixed-content blocked)
 *   stream-broken      — no working stream variant
 *   no-rb-match        — name not found in Radio Browser
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const days = Math.max(1, Math.min(365, Number(process.argv[2]) || 30));
const limit = Math.max(1, Math.min(50, Number(process.argv[3]) || 30));

const WORKER = 'https://rrradio-stats.markussteinbrecher.workers.dev';
const RB_BASE = 'https://de1.api.radio-browser.info';
const ORIGIN = 'https://rrradio.org';
const PROBE_TIMEOUT_MS = 8_000;

// Hostname → broadcaster key heuristic. When auto-curating, lets us
// suggest the right broadcaster bucket rather than always defaulting
// to `independent`. Keys must exist in data/broadcasters.yaml.
const HOST_TO_BROADCASTER = [
  [/(^|\.)orf\.at$/i, 'orf'],
  [/(^|\.)br\.de$/i, 'br'],
  [/(^|\.)bbc\.(co\.uk|com)$/i, 'bbc'],
  [/(^|\.)radiofrance\.fr$/i, 'radio-france'],
  [/(^|\.)grrif\.ch$/i, 'grrif'],
  [/(^|\.)somafm\.com$/i, 'soma-fm'],
  [/(^|\.)kexp\.org$/i, 'kexp'],
  [/(^|\.)kcrw\.com$/i, 'kcrw'],
  [/(^|\.)nts\.live$/i, 'nts'],
  [/(^|\.)deutschlandradio\.de$/i, 'dlf'],
  [/(^|\.)wdr\.de$/i, 'wdr'],
  [/(^|\.)ndr\.de$/i, 'ndr'],
];

function broadcasterFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    for (const [re, key] of HOST_TO_BROADCASTER) {
      if (re.test(host)) return key;
    }
  } catch {
    /* malformed URL */
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function timed(promise) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  return [promise(ctrl.signal), () => clearTimeout(timer)];
}

async function probe(url) {
  const [p, done] = timed((signal) =>
    fetch(url, { signal, headers: { Origin: ORIGIN, 'Icy-MetaData': '1' } }),
  );
  try {
    const res = await p;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    try { await res.body?.cancel(); } catch {}
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const audioLike =
      ct.startsWith('audio/') || ct.includes('mpegurl') || ct.includes('octet-stream');
    if (!audioLike) return { ok: false, reason: `non-audio "${ct}"` };
    return { ok: true, contentType: ct };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 80) };
  } finally {
    done();
  }
}

async function rbLookup(name) {
  const params = new URLSearchParams({
    name,
    name_exact: 'true',
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    limit: '5',
  });
  try {
    const res = await fetch(`${RB_BASE}/json/stations/search?${params}`, {
      headers: { 'User-Agent': 'rrradio-backlog/1.0' },
    });
    if (!res.ok) return [];
    return (await res.json()) ?? [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

console.log(`backlog: top ${limit} played stations over last ${days} days`);

const topRes = await fetch(`${WORKER}/api/public/top-stations?days=${days}&limit=${limit}`);
if (!topRes.ok) {
  console.error(`backlog: worker fetch failed ${topRes.status}`);
  process.exit(1);
}
const top = (await topRes.json()).items ?? [];

const stationsYaml = parseYaml(readFileSync(join(root, 'data/stations.yaml'), 'utf8'));
const knownNames = new Set(
  (Array.isArray(stationsYaml) ? stationsYaml : [])
    .map((s) => (s?.name ?? '').toLowerCase())
    .filter(Boolean),
);

const items = [];
for (const cand of top) {
  if (!cand?.name) continue;

  const entry = {
    name: cand.name,
    plays: cand.count,
    alreadyCurated: knownNames.has(cand.name.toLowerCase()),
    rbMatched: false,
    streamUrl: null,
    https: null,
    streamProbe: null,
    icyAvailable: null,
    broadcasterGuess: null,
    verdict: null,
  };

  if (entry.alreadyCurated) {
    entry.verdict = 'already-curated';
    items.push(entry);
    continue;
  }

  process.stdout.write(`  · ${cand.name} … `);
  const matches = await rbLookup(cand.name);
  if (matches.length === 0) {
    console.log('no RB match');
    entry.verdict = 'no-rb-match';
    items.push(entry);
    continue;
  }
  entry.rbMatched = true;

  // Prefer https + lastcheckok + most-clicked, like the auto-curate
  // pick logic. If only http variants exist, surface that distinctly.
  const sorted = [...matches].sort((a, b) => {
    const ahttps = /^https:/i.test(a.url_resolved || a.url) ? 1 : 0;
    const bhttps = /^https:/i.test(b.url_resolved || b.url) ? 1 : 0;
    if (bhttps !== ahttps) return bhttps - ahttps;
    if ((b.lastcheckok ?? 0) !== (a.lastcheckok ?? 0)) return (b.lastcheckok ?? 0) - (a.lastcheckok ?? 0);
    return (b.clickcount ?? 0) - (a.clickcount ?? 0);
  });
  const best = sorted[0];
  const probeUrl = best.url_resolved || best.url;
  entry.streamUrl = probeUrl;
  entry.https = /^https:\/\//i.test(probeUrl);
  entry.broadcasterGuess = broadcasterFromUrl(probeUrl);

  if (!entry.https) {
    console.log('http only');
    entry.verdict = 'needs-https';
    items.push(entry);
    continue;
  }

  const probeResult = await probe(probeUrl);
  entry.streamProbe = probeResult;
  if (!probeResult.ok) {
    console.log(`stream broken (${probeResult.reason})`);
    entry.verdict = 'stream-broken';
    items.push(entry);
    continue;
  }

  console.log(`OK${entry.broadcasterGuess ? ` (broadcaster guess: ${entry.broadcasterGuess})` : ''}`);
  entry.verdict = 'auto-curate-ready';
  items.push(entry);
}

const outPath = join(root, 'public/station-backlog.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), rangeDays: days, items },
    null,
    2,
  ) + '\n',
);

console.log('');
const counts = items.reduce((acc, i) => ((acc[i.verdict] = (acc[i.verdict] ?? 0) + 1), acc), {});
console.log(`  ${items.length} total · ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
console.log(`  wrote ${outPath}`);
