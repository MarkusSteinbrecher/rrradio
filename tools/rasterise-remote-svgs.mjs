#!/usr/bin/env node
/**
 * Rasterise remote SVG favicons into local PNG bundle assets.
 *
 * iOS' UIImage(data:) and vanilla Android Coil don't decode SVG bytes
 * fetched at runtime — only build-time-bundled SVGs in Xcode's asset
 * catalog work. The Wikimedia thumb URL trick (#416) handles Commons
 * SVGs server-side, but ~340 broadcaster-hosted SVGs across the catalog
 * still leave mobile apps with empty placeholders.
 *
 * This tool pre-rasterises every remaining remote SVG favicon into a
 * 500px-wide PNG, stores it under public/stations/<id>.png, and rewrites
 * the YAML entry to point at the local file. The original URL is
 * preserved as `faviconSourceUrl:` for audit. Subsequent builds bundle
 * the PNG and every client renders it identically.
 *
 *   npm run rasterise-remote-svgs                 # full sweep
 *   npm run rasterise-remote-svgs -- --dry-run
 *   npm run rasterise-remote-svgs -- --limit 20
 *   npm run rasterise-remote-svgs -- --only id1,id2 --width 800
 *
 * Idempotent: if `public/stations/<id>.png` already exists AND the YAML
 * already points to it, the station is skipped.
 *
 * @resvg/resvg-js is a Rust-WASM rasteriser — no native deps, builds
 * cleanly on darwin/linux/CI.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CATALOG_PATH = join(ROOT, 'public/stations.json');
const QUALITY_PATH = join(ROOT, 'public/station-logo-quality.json');
const YAML_PATH = join(ROOT, 'data/stations.yaml');
const STATIONS_DIR = join(ROOT, 'public/stations');

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = {
    dryRun: false,
    limit: 0,
    only: new Set(),
    concurrency: 6,
    timeoutMs: 10_000,
    width: 500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--only') out.only = new Set((argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--timeout') out.timeoutMs = Number(argv[++i]);
    else if (a === '--width') out.width = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('usage: rasterise-remote-svgs [--dry-run] [--limit N] [--only id1,id2] [--concurrency N] [--timeout MS] [--width N]');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

if (!existsSync(STATIONS_DIR)) mkdirSync(STATIONS_DIR, { recursive: true });

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')).stations ?? [];
const quality = existsSync(QUALITY_PATH)
  ? JSON.parse(readFileSync(QUALITY_PATH, 'utf8')).stations ?? []
  : [];
const probeById = new Map(quality.map((s) => [s.id, s]));

// Pick targets: remote-SVG favicons that aren't already a local-bundle path
// and aren't the Commons-thumb pattern (those are already PNG).
function isTarget(station) {
  const fav = station.favicon;
  if (!fav || typeof fav !== 'string') return false;
  if (/^stations\//.test(fav)) return false;
  if (!/^https:/i.test(fav)) return false;
  if (/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//.test(fav)) return false;
  const probe = probeById.get(station.id);
  return probe?.format === 'svg' || /\.svg(\?|$)/i.test(fav);
}

let targets = catalog.filter(isTarget);
if (args.only.size > 0) targets = targets.filter((s) => args.only.has(s.id));
if (args.limit > 0) targets = targets.slice(0, args.limit);

console.log(
  `rasterise-remote-svgs: ${targets.length} target(s) · width=${args.width}px · concurrency=${args.concurrency}` +
    (args.dryRun ? ' · DRY RUN' : ''),
);

async function fetchSvg(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), args.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        Accept: 'image/svg+xml,image/*',
        'User-Agent': 'rrradio-rasteriser/1.0 (+https://github.com/MarkusSteinbrecher/rrradio)',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.subarray(0, 256).toString('utf8').trimStart();
    if (!head.startsWith('<')) throw new Error('response is not XML/SVG');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

function renderToPng(svgBuffer) {
  const resvg = new Resvg(svgBuffer, {
    fitTo: { mode: 'width', value: args.width },
    background: 'rgba(0, 0, 0, 0)', // preserve transparency
  });
  return resvg.render().asPng();
}

function yamlQuoteIfNeeded(value) {
  // Match the rest of the catalog: only quote URLs that contain YAML-
  // special chars. Most http URLs are safe unquoted.
  return /[:#&*!|>'"%@`,\[\]{}]/.test(value) ? JSON.stringify(value) : value;
}

/** Rewrite a single station's block in the YAML text:
 *   - replace `favicon: <url>` with `favicon: stations/<id>.png`
 *   - if no `faviconSourceUrl:` line exists in the block, insert one
 *     immediately after favicon so the original URL stays auditable
 */
function editStationBlock(text, id, newFavicon, originalUrl) {
  const idLine = `- id: ${id}\n`;
  const idIdx = text.indexOf(idLine);
  if (idIdx === -1) return { text, status: 'id-not-found' };

  const blockStart = idIdx + idLine.length;
  const after = text.slice(blockStart);
  const nextIdMatch = /\n(?=- id: )/.exec(after);
  const blockEnd = nextIdMatch ? blockStart + nextIdMatch.index + 1 : text.length;
  const block = text.slice(blockStart, blockEnd);

  const favRe = /^  favicon: .*$/m;
  if (!favRe.test(block)) return { text, status: 'favicon-line-not-found' };

  const hasSourceUrl = /^  faviconSourceUrl: /m.test(block);
  const replacement = hasSourceUrl
    ? `  favicon: ${newFavicon}`
    : `  favicon: ${newFavicon}\n  faviconSourceUrl: ${yamlQuoteIfNeeded(originalUrl)}`;

  const newBlock = block.replace(favRe, replacement);
  return {
    text: text.slice(0, blockStart) + newBlock + text.slice(blockEnd),
    status: hasSourceUrl ? 'replaced' : 'replaced-with-source-url',
  };
}

async function processStation(station, yamlState) {
  const id = station.id;
  const originalUrl = station.favicon;
  const localPath = `stations/${id}.png`;
  const absPath = join(STATIONS_DIR, `${id}.png`);
  const localPathRe = new RegExp(`^  favicon: stations/${id.replace(/[.+*?^$()[\]{}|\\]/g, '\\$&')}\\.png$`, 'm');

  // Idempotency: PNG exists on disk AND YAML already points to it.
  if (existsSync(absPath) && localPathRe.test(yamlState.text)) {
    return { id, status: 'skipped', reason: 'already-local' };
  }

  let svg;
  try {
    svg = await fetchSvg(originalUrl);
  } catch (err) {
    return { id, status: 'fetch-failed', reason: String(err.message ?? err) };
  }

  let png;
  try {
    png = renderToPng(svg);
  } catch (err) {
    return { id, status: 'render-failed', reason: String(err.message ?? err) };
  }

  if (!args.dryRun) {
    writeFileSync(absPath, png);
  }

  const edit = editStationBlock(yamlState.text, id, localPath, originalUrl);
  if (edit.status === 'id-not-found' || edit.status === 'favicon-line-not-found') {
    return { id, status: edit.status, bytes: png.length };
  }
  yamlState.text = edit.text;
  return { id, status: 'rasterised', bytes: png.length };
}

async function runPool(items, worker, concurrency) {
  let next = 0;
  let done = 0;
  const total = items.length;
  const results = [];
  const lanes = Array.from({ length: Math.min(concurrency, total || 1) }, async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const r = await worker(items[i]);
      results.push(r);
      done++;
      if (done % 25 === 0 || done === total) {
        process.stderr.write(`\r  rasterised ${done}/${total}`);
      }
    }
  });
  await Promise.all(lanes);
  if (total > 0) process.stderr.write('\n');
  return results;
}

const yamlState = { text: readFileSync(YAML_PATH, 'utf8') };

const results = await runPool(targets, (s) => processStation(s, yamlState), args.concurrency);

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log('outcomes:', counts);

const failed = results.filter((r) => r.status === 'fetch-failed' || r.status === 'render-failed');
if (failed.length > 0) {
  console.log('failures (first 10):');
  for (const f of failed.slice(0, 10)) console.log(`  ${f.id} · ${f.status} · ${f.reason}`);
}

if (args.dryRun) {
  console.log('--dry-run: not writing data/stations.yaml');
} else {
  writeFileSync(YAML_PATH, yamlState.text);
  console.log(`wrote ${YAML_PATH}`);
}
