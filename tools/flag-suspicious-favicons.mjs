#!/usr/bin/env node
/**
 * Scan the resolved catalog (`public/stations.json`) for favicon URLs hosted
 * on free-image / fan-upload services. For each match, edit
 * `data/stations.yaml` to set `faviconBlocked: true` on the offending entry —
 * which causes build-catalog to drop the favicon (no fallback to RB's same
 * sketchy URL) and the matrix to show the row as `missing`.
 *
 * Also clears any local `favicon:` / `faviconSource:` / `faviconLicense:` /
 * `faviconSourceUrl:` lines on the same entry — they're meaningless once the
 * favicon is blocked, and leaving them in the file is just visual noise.
 *
 * Idempotent: re-running over an already-blocked file is a no-op.
 *
 *   node tools/flag-suspicious-favicons.mjs --dry-run
 *   node tools/flag-suspicious-favicons.mjs           # write
 *
 * The host list is the "we don't trust this is the broadcaster's official
 * logo" bucket — typically free image-share sites that anyone can upload to,
 * or known image-search thumbnail proxies. Curated logos (Wikipedia,
 * broadcaster sites, broadcaster APIs) are left alone.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CATALOG_PATH = join(ROOT, 'public/stations.json');
const YAML_PATH = join(ROOT, 'data/stations.yaml');

const DRY_RUN = process.argv.includes('--dry-run');

// Hosts whose presence in a favicon URL signals "user uploaded a screenshot
// to a free image service" rather than "broadcaster's own logo asset".
// Curated explicitly; add to it carefully.
const SUSPICIOUS_HOSTS = new Set([
  'i.postimg.cc',
  'postimg.cc',
  'i.ibb.co',
  'ibb.co',
  'i.imgur.com',
  'imgur.com',
  'm.imgur.com',
  'blogger.googleusercontent.com',
  'lh3.googleusercontent.com',
  'firebasestorage.googleapis.com',
  'public-rf-upload.minhawebradio.net',
  'static.xx.fbcdn.net',
]);

// Hosts where the path prefix matters (e.g. encrypted-tbn0.gstatic.com is
// a Google image-search thumbnail proxy — anyone's image can land there).
function isSuspiciousHost(host) {
  if (SUSPICIOUS_HOSTS.has(host)) return true;
  if (/^encrypted-tbn\d+\.gstatic\.com$/i.test(host)) return true;
  // Other facebook CDN subdomains (scontent-*.fbcdn.net, …) — Facebook
  // resizes/proxies user-uploaded images here and frequently serves their
  // generic site favicon when the scraper hit a /facebook.com/<user> page.
  if (/\.fbcdn\.net$/i.test(host)) return true;
  return false;
}

function classify(favicon) {
  if (!favicon) return null;
  if (favicon.startsWith('stations/')) return null;
  let url;
  try { url = new URL(favicon); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (isSuspiciousHost(url.host.toLowerCase())) return url.host.toLowerCase();
  return null;
}

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const stations = catalog.stations ?? [];

const flagged = new Map();        // id → { host, favicon }
const hostCounts = new Map();

for (const s of stations) {
  const host = classify(s.favicon);
  if (!host) continue;
  flagged.set(s.id, { host, favicon: s.favicon });
  hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
}

console.log(`flag-suspicious: ${flagged.size} stations match`);
for (const [host, n] of [...hostCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(5)} ${host}`);
}

if (flagged.size === 0) {
  console.log('flag-suspicious: nothing to do');
  process.exit(0);
}

// ─── Edit YAML ────────────────────────────────────────────────────────────
// Strategy: walk line-by-line. Track the current `- id:` block. When we
// enter a flagged block:
//   - strip favicon/faviconSource/faviconLicense/faviconSourceUrl lines
//   - insert `  faviconBlocked: true` on the line immediately after `- id:`
//     (unless one is already present in the block).
// This keeps the change localised; we don't rewrite the file structurally.

const text = readFileSync(YAML_PATH, 'utf8');
const lines = text.split('\n');

const blockStart = (line) => /^- id: (.+)$/.exec(line);
const FAVICON_LINE_RX = /^  (favicon|faviconSource|faviconSourceType|faviconSourceUrl|faviconLicense): /;
const FAVICON_BLOCKED_RX = /^  faviconBlocked: true$/;

// First pass: collect the bounds of each flagged block + whether
// faviconBlocked is already set.
const blockBounds = new Map();    // id → { start, end, hasBlocked }
let curId = null;
let curStart = -1;
let curHasBlocked = false;
for (let i = 0; i < lines.length; i++) {
  const m = blockStart(lines[i]);
  if (m) {
    if (curId && flagged.has(curId)) {
      blockBounds.set(curId, { start: curStart, end: i - 1, hasBlocked: curHasBlocked });
    }
    curId = m[1].trim();
    curStart = i;
    curHasBlocked = false;
    continue;
  }
  if (curId && FAVICON_BLOCKED_RX.test(lines[i])) curHasBlocked = true;
}
if (curId && flagged.has(curId)) {
  blockBounds.set(curId, { start: curStart, end: lines.length - 1, hasBlocked: curHasBlocked });
}

// Second pass: rebuild the file, stripping favicon-related lines from
// flagged blocks and inserting faviconBlocked.
const idLineSet = new Map([...blockBounds.entries()].map(([id, b]) => [b.start, id]));
const out = [];
let stripping = false;
let activeBounds = null;

for (let i = 0; i < lines.length; i++) {
  const idAtThisLine = idLineSet.get(i);
  if (idAtThisLine !== undefined) {
    activeBounds = blockBounds.get(idAtThisLine);
    stripping = true;
    out.push(lines[i]);                       // the `- id:` line itself
    if (!activeBounds.hasBlocked) {
      out.push(`  faviconBlocked: true`);
    }
    continue;
  }

  // Are we inside a flagged block? Stop when the next `- id:` starts (which
  // we'll handle on the next iteration via idLineSet).
  if (stripping && activeBounds && i > activeBounds.end) {
    stripping = false;
    activeBounds = null;
  }

  if (stripping && FAVICON_LINE_RX.test(lines[i])) {
    // skip the favicon-related line entirely
    continue;
  }
  out.push(lines[i]);
}

const inserted = blockBounds.size - [...blockBounds.values()].filter((b) => b.hasBlocked).length;
console.log(`flag-suspicious: inserted faviconBlocked into ${inserted} blocks (other ${blockBounds.size - inserted} already had it)`);

if (DRY_RUN) {
  console.log('--dry-run, no file written');
  process.exit(0);
}

writeFileSync(YAML_PATH, out.join('\n'));
console.log(`wrote ${YAML_PATH}`);
