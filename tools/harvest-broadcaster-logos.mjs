#!/usr/bin/env node
/**
 * Broadcaster-API logo harvester (issue #471).
 *
 * Turns the by-hand SRG logo fix (#469/#473) into a repeatable tool. For each
 * broadcaster with a metadata adapter, fetch the authoritative per-channel
 * `imageUrl` straight from the broadcaster's own API and emit an `apply-logos`
 * patch — broadcaster-hosted, licence-clean, deterministic, idempotent. Drives
 * down the fragile non-free-Wikipedia dependence.
 *
 * The join is pure (`tools/lib/broadcaster-logos.mjs`); this CLI only fetches
 * the source documents, applies the write policy, and writes the patch. It does
 * NOT mutate `data/stations.yaml` — review the patch, then:
 *
 *   npm run apply-logos -- --in internal/logos/broadcaster-api.json            # insert (fill missing)
 *   npm run apply-logos -- --in internal/logos/broadcaster-api.json --replace  # also overwrite existing
 *
 * Write policy (which stations enter the patch):
 *   default            → stations with NO favicon (safe to insert)
 *   --upgrade-generic  → + stations on a weak / site-default icon
 *   --include-existing → every matched station (forced idempotent re-harvest)
 *
 *   npm run harvest-logos                          # all adapters, missing only
 *   npm run harvest-logos -- --adapter srg --cc CH # one adapter / country
 *   npm run harvest-logos -- --only id1,id2        # specific stations
 *   npm run harvest-logos -- --include-existing    # re-harvest the whole set
 *   npm run harvest-logos -- --json                # machine-readable summary
 *
 * Reads `data/stations.yaml` (the authoring source the patch is applied back
 * into). Network-read-only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { ADAPTERS, POLICY, faviconState, getAdapter, policyIncludes } from './lib/broadcaster-logos.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATIONS = path.join(ROOT, 'data', 'stations.yaml');
const DEFAULT_OUT = path.join(ROOT, 'internal', 'logos', 'broadcaster-api.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const TIMEOUT_MS = 15000;

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { adapter: null, cc: null, only: new Set(), out: DEFAULT_OUT, policy: POLICY.MISSING, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--adapter') out.adapter = String(argv[++i] ?? '').toLowerCase();
    else if (a === '--cc') out.cc = String(argv[++i] ?? '').toUpperCase();
    else if (a === '--only' || a === '--id')
      for (const id of (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) out.only.add(id);
    else if (a === '--out') out.out = path.resolve(ROOT, String(argv[++i] ?? DEFAULT_OUT));
    else if (a === '--upgrade-generic') out.policy = POLICY.GENERIC;
    else if (a === '--include-existing' || a === '--all') out.policy = POLICY.ALL;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: harvest-broadcaster-logos [--adapter srg] [--cc XX] [--only id,…] [--out path]\n' +
          '                                [--upgrade-generic | --include-existing] [--json]',
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function loadStations() {
  const parsed = parseYaml(fs.readFileSync(STATIONS, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error('harvest-broadcaster-logos: stations.yaml is not a list');
    process.exit(1);
  }
  return parsed.filter((s) => s?.id);
}

function selectStations(all) {
  let xs = all;
  if (args.only.size) xs = xs.filter((s) => args.only.has(s.id));
  if (args.cc) xs = xs.filter((s) => String(s.country ?? '').toUpperCase() === args.cc);
  return xs;
}

async function fetchJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'application/json,*/*' } });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

async function harvestAdapter(adapter, stations) {
  const matched = stations.filter((s) => adapter.match(s));
  if (!matched.length) return { adapter: adapter.name, matched: 0, entries: [], rows: [], fetchErrors: [] };

  // One fetch per source document, indexed per net.
  const indexByNet = new Map();
  const fetchErrors = [];
  for (const { net, url } of adapter.sources(matched)) {
    const res = await fetchJson(url);
    if (!res.ok) {
      fetchErrors.push({ net, url, reason: res.reason });
      continue;
    }
    indexByNet.set(net, adapter.index(net, res.json));
  }

  const entries = [];
  const rows = [];
  for (const s of matched) {
    const resolved = adapter.resolve(s, indexByNet);
    const state = faviconState(s);
    if (!resolved) {
      rows.push({ id: s.id, state, action: 'unresolved' });
      continue;
    }
    const included = policyIncludes(args.policy, state);
    const sameAsCurrent = s.favicon === resolved.url;
    rows.push({
      id: s.id,
      state,
      url: resolved.url,
      action: included ? (sameAsCurrent ? 'patch(idempotent)' : state === 'missing' ? 'patch(insert)' : 'patch(replace)') : 'hold',
    });
    if (included) entries.push(resolved);
  }
  return { adapter: adapter.name, matched: matched.length, entries, rows, fetchErrors };
}

// ─────────────────────────────────────────────────────────────────────────

const adapters = args.adapter ? [getAdapter(args.adapter)].filter(Boolean) : ADAPTERS;
if (args.adapter && !adapters.length) {
  console.error(`harvest-broadcaster-logos: unknown adapter "${args.adapter}" (have: ${ADAPTERS.map((a) => a.name).join(', ')})`);
  process.exit(2);
}

const stations = selectStations(loadStations());
const results = [];
for (const adapter of adapters) results.push(await harvestAdapter(adapter, stations));

const patch = results.flatMap((r) => r.entries);

// De-dupe by id (an adapter resolves each station once, but guard regardless).
const byId = new Map();
for (const e of patch) byId.set(e.id, e);
const finalPatch = [...byId.values()];

fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, JSON.stringify(finalPatch, null, 2) + '\n');

if (args.json) {
  console.log(JSON.stringify({ policy: args.policy, out: path.relative(ROOT, args.out), results }, null, 2));
} else {
  for (const r of results) {
    const counts = r.rows.reduce((m, row) => ((m[row.action] = (m[row.action] ?? 0) + 1), m), {});
    console.log(`\n[${r.adapter}] matched ${r.matched} station(s) · policy=${args.policy}`);
    for (const e of r.fetchErrors) console.warn(`  ! fetch ${e.net} failed: ${e.reason}`);
    for (const row of r.rows) {
      const mark = row.action.startsWith('patch') ? '✓' : row.action === 'hold' ? '·' : '!';
      console.log(`  ${mark} ${row.id.padEnd(34)} ${row.state.padEnd(8)} ${row.action}${row.url ? '  ' + row.url : ''}`);
    }
    console.log(`  → ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}`);
  }
  console.log(`\nwrote ${finalPatch.length} patch entr${finalPatch.length === 1 ? 'y' : 'ies'} → ${path.relative(ROOT, args.out)}`);
  if (finalPatch.length) {
    console.log(`apply with:  npm run apply-logos -- --in ${path.relative(ROOT, args.out)}${args.policy === POLICY.MISSING ? '' : ' --replace'}`);
  }
}
