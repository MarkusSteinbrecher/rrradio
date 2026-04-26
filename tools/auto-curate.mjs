#!/usr/bin/env node
/**
 * Imports popular Radio Browser stations into data/stations.yaml.
 *
 * Pulls top-played station names from our public worker endpoint
 * (those are stations real visitors hit "play" on), looks each one
 * up in Radio Browser to harvest streamUrl + tags + favicon, probes
 * the stream to confirm it's alive, and appends a YAML stub at
 * status:stream-only. Skips anything already in stations.yaml
 * (matched case-insensitively by name).
 *
 *   npm run auto-curate           — last 30 days, top 20, min 2 plays
 *   npm run auto-curate -- 90 50 1  — days, limit, min plays
 *
 * Read-only on the network side; mutates data/stations.yaml only
 * when a candidate makes it through the full pipeline. Designed
 * to run inside the catalog-watch workflow, which then creates a
 * PR if the file changed.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const days = Math.max(1, Math.min(365, Number(process.argv[2]) || 30));
const limit = Math.max(1, Math.min(50, Number(process.argv[3]) || 20));
const minPlays = Math.max(1, Number(process.argv[4]) || 2);

const WORKER = 'https://rrradio-stats.markussteinbrecher.workers.dev';
const RB_BASE = 'https://de1.api.radio-browser.info';
const ORIGIN = 'https://rrradio.org';
const PROBE_TIMEOUT_MS = 8_000;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function timed(promise) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  return [promise(ctrl.signal), () => clearTimeout(timer)];
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
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
    if (!audioLike) return { ok: false, reason: `non-audio content-type "${ct}"` };
    return { ok: true, contentType: ct };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 80) };
  } finally {
    done();
  }
}

async function rbLookup(name) {
  // Radio Browser's exact-match search. Returns multiple variants
  // (different bitrates / mirrors) sorted by clickcount.
  const params = new URLSearchParams({
    name,
    name_exact: 'true',
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    limit: '5',
  });
  const url = `${RB_BASE}/json/stations/search?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'rrradio-auto-curate/1.0' } });
  if (!res.ok) return [];
  return (await res.json()) ?? [];
}

function pickBest(rbStations) {
  // Prefer https streams (mixed content otherwise blocks our app).
  // Among https, prefer the one Radio Browser most recently saw alive,
  // then by clickcount. Fall back to anything if no https variant.
  const https = rbStations.filter((s) => /^https:\/\//i.test(s.url_resolved || s.url));
  const pool = https.length > 0 ? https : rbStations;
  pool.sort((a, b) => {
    const ok = (s) => (s.lastcheckok ? 1 : 0);
    if (ok(b) !== ok(a)) return ok(b) - ok(a);
    return (b.clickcount ?? 0) - (a.clickcount ?? 0);
  });
  return pool[0];
}

function normaliseTags(rbTags) {
  if (!rbTags) return [];
  return rbTags
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 6);
}

function buildYamlEntry({ id, name, station, country }) {
  // Hand-formatted to match the existing stations.yaml style
  // (build-catalog reads it, but yaml.stringify would reorder fields).
  const lines = [];
  lines.push('');
  lines.push(`# Auto-imported from Radio Browser (${new Date().toISOString().slice(0, 10)})`);
  lines.push(`- id: ${id}`);
  lines.push(`  broadcaster: independent`);
  lines.push(`  name: ${quote(name)}`);
  lines.push(`  streamUrl: ${station.url_resolved || station.url}`);
  if (station.bitrate && station.bitrate > 0) lines.push(`  bitrate: ${station.bitrate}`);
  if (station.codec) lines.push(`  codec: ${station.codec.toUpperCase()}`);
  const tags = normaliseTags(station.tags);
  if (tags.length > 0) lines.push(`  tags: [${tags.join(', ')}]`);
  if (station.favicon) lines.push(`  favicon: ${station.favicon}`);
  if (station.homepage) lines.push(`  homepage: ${station.homepage}`);
  if (country) lines.push(`  country: ${country}`);
  lines.push(`  status: stream-only`);
  return lines.join('\n') + '\n';
}

function quote(s) {
  // Quote names containing YAML-significant chars. Keep simple; we
  // only emit double-quoted when needed.
  return /[:#&*!|>'"%@`,\[\]{}]/.test(s) || /^\s|\s$/.test(s)
    ? JSON.stringify(s)
    : s;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

console.log(`auto-curate: top ${limit} candidates over last ${days} days, min ${minPlays} plays`);

// 1. Top played from GoatCounter (via worker)
const topRes = await fetch(`${WORKER}/api/public/top-stations?days=${days}&limit=${limit}`);
if (!topRes.ok) {
  console.error(`auto-curate: worker fetch failed ${topRes.status}`);
  process.exit(1);
}
const top = (await topRes.json()).items ?? [];

// 2. Existing curated names + ids
const stationsPath = join(root, 'data/stations.yaml');
const stationsText = readFileSync(stationsPath, 'utf8');
const stationsList = parseYaml(stationsText);
const knownNames = new Set(
  (Array.isArray(stationsList) ? stationsList : [])
    .map((s) => (s?.name ?? '').toLowerCase())
    .filter(Boolean),
);
const knownIds = new Set(
  (Array.isArray(stationsList) ? stationsList : [])
    .map((s) => s?.id)
    .filter(Boolean),
);

// 3. Filter to fresh, popular-enough candidates
const fresh = top.filter(
  (i) => i?.name && i.count >= minPlays && !knownNames.has(i.name.toLowerCase()),
);
console.log(`  ${fresh.length} fresh candidates with ≥${minPlays} plays`);
if (fresh.length === 0) {
  console.log('auto-curate: nothing to import. exiting.');
  process.exit(0);
}

// 4. For each: RB lookup → pick best → probe → build YAML
const accepted = [];
const rejected = [];
for (const cand of fresh) {
  process.stdout.write(`  · ${cand.name} … `);
  const matches = await rbLookup(cand.name);
  if (matches.length === 0) {
    console.log('no Radio Browser match');
    rejected.push({ name: cand.name, reason: 'no RB match' });
    continue;
  }
  const best = pickBest(matches);
  if (!best?.url_resolved && !best?.url) {
    console.log('RB match has no stream URL');
    rejected.push({ name: cand.name, reason: 'no stream URL' });
    continue;
  }
  const probeUrl = best.url_resolved || best.url;
  const result = await probe(probeUrl);
  if (!result.ok) {
    console.log(`probe failed (${result.reason})`);
    rejected.push({ name: cand.name, reason: result.reason });
    continue;
  }
  let id = `rb-${slugify(cand.name)}`;
  // Disambiguate against existing ids (possible if two candidates slug
  // to the same value, or a previous import is being re-applied).
  let suffix = 2;
  while (knownIds.has(id)) {
    id = `rb-${slugify(cand.name)}-${suffix++}`;
  }
  knownIds.add(id);
  console.log(`OK (${probeUrl})`);
  accepted.push({ id, name: cand.name, station: best, country: best.countrycode || undefined });
}

// 5. Append the new entries to stations.yaml
if (accepted.length === 0) {
  console.log('auto-curate: no candidates passed probing.');
  console.log(`  rejected: ${rejected.map((r) => `${r.name} (${r.reason})`).join('; ')}`);
  process.exit(0);
}
const additions = accepted.map(buildYamlEntry).join('');
const trailing = stationsText.endsWith('\n') ? '' : '\n';
writeFileSync(stationsPath, stationsText + trailing + additions);

console.log('');
console.log(`auto-curate: appended ${accepted.length} stations to data/stations.yaml`);
for (const a of accepted) console.log(`  + ${a.id}  ${a.name}`);
if (rejected.length > 0) {
  console.log('');
  console.log(`  rejected ${rejected.length}:`);
  for (const r of rejected) console.log(`  - ${r.name} (${r.reason})`);
}
