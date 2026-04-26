#!/usr/bin/env node
/**
 * Discovers and wires per-station metadata-API URLs for broadcasters
 * whose URL pattern can be derived (BR, ORF). For each station that's
 * missing a metadataUrl but has a known broadcaster, tries to find
 * the per-channel API URL and inserts it into data/stations.yaml.
 *
 *   npm run wire-metadata
 *
 * Discovery strategies:
 *   - BR  → scrape <homepage> for the radioplayer.json link
 *   - ORF → derive audioapi.orf.at/<slug>/api/json/4.0/live from
 *           the channel subdomain in homepage
 *
 * Read-only on the network side; mutates data/stations.yaml only when
 * a candidate URL probes 2xx + JSON. Surgical line insert keeps the
 * existing hand-formatted YAML structure intact.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ORIGIN = 'https://rrradio.org';
const TIMEOUT_MS = 8_000;

function timed(promise) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return [promise(ctrl.signal), () => clearTimeout(timer)];
}

async function probeJson(url) {
  const [p, done] = timed((signal) =>
    fetch(url, { signal, headers: { Origin: ORIGIN } }),
  );
  try {
    const res = await p;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    try { await res.body?.cancel(); } catch {}
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, contentType: ct };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 80) };
  } finally {
    done();
  }
}

async function fetchText(url) {
  const [p, done] = timed((signal) => fetch(url, { signal }));
  try {
    const res = await p;
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    done();
  }
}

// ─────────────────────────────────────────────────────────────
// Per-broadcaster discovery
// ─────────────────────────────────────────────────────────────

/** BR: scrape the channel page for `audio-livestream...radioplayer.json`,
 *  rewrite the hash-route prefix into a real path. */
async function discoverBr(station) {
  const home = station.homepage ?? '';
  // Pull channel slug from /radio/<slug>/...
  const m = home.match(/^https?:\/\/www\.br\.de\/radio\/([^/]+)\//);
  if (!m) return null;
  const slug = m[1];
  // Try a couple of likely landing pages; slug index, then fallback.
  const pages = [
    `https://www.br.de/radio/${slug}/index.html`,
    `https://www.br.de/mediathek/sendungen/${slug}/index.html`,
  ];
  for (const page of pages) {
    const html = await fetchText(page);
    if (!html) continue;
    const re = /https?:\/\/www\.br\.de\/radio\/live\/#\/mediathek\/audio\/[^"]*radioplayer\.json/;
    const found = html.match(re);
    if (!found) continue;
    // Rewrite hash route → real mediathek URL.
    const realUrl = found[0].replace('/radio/live/#/mediathek/', '/mediathek/');
    return realUrl;
  }
  // Last-resort: try the canonical pattern with a couple of common ids.
  for (const id of ['100', '102', '104']) {
    const candidate = `https://www.br.de/mediathek/audio/${slug}/${slug}-audio-livestream-${id}~radioplayer.json`;
    const probe = await probeJson(candidate);
    if (probe.ok) return candidate;
  }
  return null;
}

/** ORF: subdomain → slug. fm4.orf.at → fm4; oe1.orf.at → oe1. */
async function discoverOrf(station) {
  const home = station.homepage ?? '';
  const m = home.match(/^https?:\/\/([a-z0-9-]+)\.orf\.at\b/);
  if (!m) return null;
  const slug = m[1];
  return `https://audioapi.orf.at/${slug}/api/json/4.0/live`;
}

/** BBC: extract the service slug from streamUrl. Stream URLs include
 *  region suffixes (e.g. `bbc_world_service_east_asia`) that the
 *  schedule API doesn't accept — match against a known service list
 *  and pick the longest substring hit. We store the slug bare in
 *  metadataUrl; fetchers call the worker proxy with it. */
const BBC_SERVICES = [
  'bbc_world_service',
  'bbc_radio_one',
  'bbc_radio_two',
  'bbc_radio_three',
  'bbc_radio_four',
  'bbc_radio_four_extra',
  'bbc_radio_fivelive',
  'bbc_radio_five_live',
  'bbc_6music',
  'bbc_asian_network',
  'bbc_1xtra',
  'bbc_radio_nan_gaidheal',
  'bbc_radio_scotland',
  'bbc_radio_ulster',
  'bbc_radio_wales',
  'bbc_radio_cymru',
  'bbc_radio_foyle',
];
async function discoverBbc(station) {
  const url = (station.streamUrl ?? '').toLowerCase();
  // Pick the longest known service that appears in the URL.
  const candidates = BBC_SERVICES.filter((s) => url.includes(s)).sort((a, b) => b.length - a.length);
  for (const slug of candidates) {
    const probe = await probeJson(`https://rrradio-stats.markussteinbrecher.workers.dev/api/public/bbc/play/${slug}`);
    if (probe.ok) return slug;
  }
  return null;
}

/** HR: scrape the channel landing page for the radioplayer.json link.
 *  Each HR channel uses its own subdomain (hr1.de … hr4.de) and the
 *  paths differ per channel (radioprogramm-hr1, hrzwei-guide,
 *  guide_hrthree, guide_hrfour) — scraping is the only reliable way. */
async function discoverHr(station) {
  const home = station.homepage ?? '';
  const m = home.match(/^https?:\/\/(?:www\.)?(hr[1-4])\.de\b/i);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  const html = await fetchText(`https://www.${slug}.de/`);
  if (!html) return null;
  const re = new RegExp(`https?://www\\.${slug}\\.de/[^"\\s]*radioplayer\\.json`, 'i');
  const found = html.match(re);
  return found ? found[0] : null;
}

const DISCOVERERS = {
  br: discoverBr,
  orf: discoverOrf,
  bbc: discoverBbc,
  hr: discoverHr,
};

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const parsed = parseYaml(text);
if (!Array.isArray(parsed)) {
  console.error('wire-metadata: stations.yaml is not a list');
  process.exit(1);
}

let wired = 0;
let skipped = 0;
let failed = 0;

for (const s of parsed) {
  if (!s?.id) continue;
  if (s.metadataUrl) { skipped++; continue; }
  const discoverer = DISCOVERERS[s.broadcaster];
  if (!discoverer) continue;
  process.stdout.write(`  · ${s.id} (${s.broadcaster}) … `);
  const url = await discoverer(s);
  if (!url) {
    console.log('not found');
    failed++;
    continue;
  }
  // Some discoverers (BBC) return a slug that isn't directly fetchable —
  // they've already verified it via the worker proxy. Only post-probe
  // when the result looks like a real URL.
  if (/^https?:\/\//.test(url)) {
    const probe = await probeJson(url);
    if (!probe.ok) {
      console.log(`probe failed (${probe.reason})`);
      failed++;
      continue;
    }
  }
  console.log(`OK  ${url}`);

  // Insert `  metadataUrl: <url>` after the `id:` line for this station.
  const idLine = `- id: ${s.id}`;
  const idx = text.indexOf(idLine);
  if (idx === -1) {
    console.warn(`    ! couldn't locate id line for ${s.id}`);
    failed++;
    continue;
  }
  const endOfIdLine = text.indexOf('\n', idx);
  const before = text.slice(0, endOfIdLine + 1);
  const after = text.slice(endOfIdLine + 1);
  text = before + `  metadataUrl: ${url}\n` + after;
  wired++;
}

writeFileSync(stationsPath, text);
console.log('');
console.log(`wire-metadata done: ${wired} wired, ${skipped} already had metadataUrl, ${failed} failed/unsupported`);
