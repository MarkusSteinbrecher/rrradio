#!/usr/bin/env node
/**
 * Verify that `public/stations.json` is consistent with `data/stations.yaml`.
 *
 * Production deploys consume the committed catalog artifact rather than
 * regenerating it (audit #65 — keep RB-fragility out of every deploy),
 * so CI needs a deterministic check that the committed JSON matches what
 * the YAML implies. We can't do a full RB-merge equivalence without the
 * cache, but we can catch the realistic regression: a developer edited
 * `data/stations.yaml` and forgot to run `npm run catalog`.
 *
 * The structural check pairs every publishable YAML row (status in
 * {working, stream-only, icy-only}) with the JSON station of the same
 * id. Counts must match too.
 *
 * Exits 0 when consistent, 2 when not. Reads only local files; no
 * network.
 *
 *   npm run check-catalog
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const C = COLOR
  ? { ok: '\x1b[32m', bad: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { ok: '', bad: '', dim: '', reset: '' };

function fail(msg) {
  console.error(`${C.bad}check-catalog: ${msg}${C.reset}`);
  process.exit(2);
}

const yamlText = readFileSync(join(root, 'data/stations.yaml'), 'utf8');
const yamlList = parseYaml(yamlText);
if (!Array.isArray(yamlList)) fail('stations.yaml: not a list');

const yamlPublishableIds = new Set(
  yamlList
    .filter((s) => s && typeof s.id === 'string' && PUBLISHABLE.has(s.status))
    .map((s) => s.id),
);

// Stations marked `httpAllowed: true` in YAML — exempt from the
// HTTPS-only stream policy. Audit #71: any new HTTP entry must carry
// this flag and a comment explaining why HTTPS isn't available.
const httpAllowedIds = new Set(
  yamlList
    .filter((s) => s && typeof s.id === 'string' && s.httpAllowed === true)
    .map((s) => s.id),
);

const jsonText = readFileSync(join(root, 'public/stations.json'), 'utf8');
const json = JSON.parse(jsonText);
const jsonStations = Array.isArray(json) ? json : json.stations;
if (!Array.isArray(jsonStations)) fail('public/stations.json: stations[] not found');

const jsonIds = new Set(jsonStations.map((s) => s.id));

// Every publishable YAML row should have a matching JSON entry.
const missingFromJson = [...yamlPublishableIds].filter((id) => !jsonIds.has(id));
// Every JSON entry should trace back to a publishable YAML row.
const missingFromYaml = [...jsonIds].filter((id) => !yamlPublishableIds.has(id));

const drift =
  missingFromJson.length > 0 ||
  missingFromYaml.length > 0 ||
  yamlPublishableIds.size !== jsonIds.size;

// URL safety: every absolute URL in the catalog must be http/https.
// Catches catalog poisoning where a YAML or RB-merged value somehow
// contains a javascript:/data:/file: scheme that would render as an
// `<a href>` in the UI. Favicons are allowed to be relative paths
// (e.g. "stations/grrif.png") since the runtime resolves those
// against the public/ root.
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const URL_FIELDS = ['streamUrl', 'homepage', 'favicon'];
const urlIssues = [];
for (const s of jsonStations) {
  for (const field of URL_FIELDS) {
    const v = s[field];
    if (!v) continue;
    if (field === 'favicon' && /^stations\//.test(v)) continue; // local asset
    let proto;
    try {
      proto = new URL(v).protocol;
    } catch {
      urlIssues.push(`${s.id}: ${field} not a parseable URL: ${v}`);
      continue;
    }
    if (!ALLOWED_PROTOCOLS.has(proto)) {
      urlIssues.push(`${s.id}: ${field} has disallowed scheme ${proto} → ${v}`);
    }
  }
}
if (urlIssues.length > 0) {
  console.error(`${C.bad}check-catalog: ${urlIssues.length} URL safety issue(s):${C.reset}`);
  for (const m of urlIssues.slice(0, 20)) console.error(`  ${m}`);
  if (urlIssues.length > 20) console.error(`  …and ${urlIssues.length - 20} more`);
  process.exit(2);
}

// HTTPS-only catalog policy (audit #71). HTTP streams are blocked by
// the browser mixed-content policy on https sites and require an iOS
// ATS exception. Stations that genuinely lack HTTPS must opt in via
// `httpAllowed: true` in stations.yaml so the deviation is curator-
// reviewed and visible in diffs.
const httpsIssues = [];
for (const s of jsonStations) {
  if (!s.streamUrl || typeof s.streamUrl !== 'string') continue;
  if (!s.streamUrl.startsWith('http://')) continue;
  if (httpAllowedIds.has(s.id)) continue;
  httpsIssues.push(`${s.id}: HTTP streamUrl not allowlisted → ${s.streamUrl}`);
}
if (httpsIssues.length > 0) {
  console.error(`${C.bad}check-catalog: ${httpsIssues.length} HTTPS-policy violation(s):${C.reset}`);
  for (const m of httpsIssues.slice(0, 20)) console.error(`  ${m}`);
  if (httpsIssues.length > 20) console.error(`  …and ${httpsIssues.length - 20} more`);
  console.error(
    `\n  Fix: replace with https:// in data/stations.yaml (preferred), or add`,
  );
  console.error(`  ${C.ok}httpAllowed: true${C.reset}${C.bad} to the YAML row with a comment explaining why HTTPS`);
  console.error(`  isn't available (audit #71).${C.reset}`);
  process.exit(2);
}

if (drift) {
  console.error(
    `${C.bad}check-catalog: stations.json is out of sync with stations.yaml${C.reset}`,
  );
  console.error(`  YAML publishable: ${yamlPublishableIds.size}`);
  console.error(`  JSON published:   ${jsonIds.size}`);
  if (missingFromJson.length > 0) {
    console.error(`\n  ${missingFromJson.length} station(s) in YAML but not JSON:`);
    for (const id of missingFromJson.slice(0, 10)) console.error(`    + ${id}`);
    if (missingFromJson.length > 10) console.error(`    + …and ${missingFromJson.length - 10} more`);
  }
  if (missingFromYaml.length > 0) {
    console.error(`\n  ${missingFromYaml.length} station(s) in JSON but not YAML:`);
    for (const id of missingFromYaml.slice(0, 10)) console.error(`    - ${id}`);
    if (missingFromYaml.length > 10) console.error(`    - …and ${missingFromYaml.length - 10} more`);
  }
  console.error(
    `\n  Fix: run ${C.ok}npm run catalog${C.reset}${C.bad} (regenerates JSON from YAML + Radio Browser),${C.reset}`,
  );
  console.error(`  then commit the updated public/stations.json.`);
  process.exit(2);
}

// Stale-allowlist check: an `httpAllowed: true` row whose stream is
// now actually HTTPS (e.g. RB upstream upgraded) means the flag should
// be removed. Warn (don't fail) so curator can clean up.
const staleAllowlist = [];
for (const s of jsonStations) {
  if (!httpAllowedIds.has(s.id)) continue;
  if (typeof s.streamUrl === 'string' && s.streamUrl.startsWith('https://')) {
    staleAllowlist.push(s.id);
  }
}
if (staleAllowlist.length > 0) {
  console.warn(
    `${C.dim}check-catalog: ${staleAllowlist.length} station(s) carry httpAllowed:true but resolve to HTTPS — flag can be removed:${C.reset}`,
  );
  for (const id of staleAllowlist) console.warn(`  ${id}`);
}

console.log(
  `${C.ok}check-catalog: ${yamlPublishableIds.size} publishable YAML stations match JSON ✓${C.reset}`,
);
if (httpAllowedIds.size > 0) {
  console.log(
    `${C.dim}  ${httpAllowedIds.size} HTTP-only station(s) on the allowlist (httpAllowed: true)${C.reset}`,
  );
}
