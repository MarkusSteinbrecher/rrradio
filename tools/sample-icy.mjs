#!/usr/bin/env node
/**
 * Usage:
 *   npm run sample-icy
 *   npm run sample-icy -- --limit 100
 *   npm run sample-icy -- --status icy-only,stream-only
 *   npm run sample-icy -- --concurrency 4
 *
 * Iterates publishable stations from public/stations.json, opens an
 * ICY-aware fetch on each stream, captures one StreamTitle per station,
 * and appends a JSONL row to data/icy-samples.jsonl.
 *
 * Re-runnable. Each invocation produces a new generation of rows; downstream
 * tools dedupe on `raw` text so running it across the day captures variety
 * (between songs, ads, station IDs, …) without inflating the labeling cost.
 */

import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const STATIONS_JSON = path.join(ROOT, 'public', 'stations.json');
const OUT_FILE = path.join(ROOT, 'data', 'icy-samples.jsonl');

const ORIGIN = 'https://markussteinbrecher.github.io';
const TIMEOUT_MS = 12_000;
const MAX_METADATA_BYTES = 255 * 16;
const SCAN_LIMIT_BYTES = 64 * 1024;

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return args[i + 1];
}
const LIMIT = Number(flag('limit', 0)) || Infinity;
const STATUS_FILTER = String(flag('status', 'icy-only,stream-only,working'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const CONCURRENCY = Math.max(1, Math.min(16, Number(flag('concurrency', 6))));

async function readIcy(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Origin: ORIGIN, 'Icy-MetaData': '1' },
    });
    if (!res.ok || !res.body) {
      try { await res.body?.cancel(); } catch {}
      return { ok: false, reason: `http ${res.status}` };
    }
    const metaintHeader = res.headers.get('icy-metaint');
    const metaint = metaintHeader ? parseInt(metaintHeader, 10) : 0;
    if (metaint > 0) return readPrecise(res.body, metaint);
    return readBruteForce(res.body);
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function readPrecise(body, metaint) {
  const reader = body.getReader();
  let buf = new Uint8Array(0);
  const need = metaint + 1 + MAX_METADATA_BYTES;
  try {
    while (buf.length < need) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf); merged.set(value, buf.length); buf = merged;
      if (buf.length > metaint) {
        const len = buf[metaint] * 16;
        if (len === 0) return { ok: true, raw: '' };
        if (buf.length >= metaint + 1 + len) {
          const text = decodeMaybeUtf8(buf.subarray(metaint + 1, metaint + 1 + len));
          const m = text.match(/StreamTitle='([^']*)'/);
          return { ok: true, raw: m ? m[1] : '' };
        }
      }
    }
    return { ok: false, reason: 'no metaint block in window' };
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

const PREFIX = Uint8Array.from([
  0x53, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x54, 0x69, 0x74, 0x6c, 0x65, 0x3d, 0x27,
]);

async function readBruteForce(body) {
  const reader = body.getReader();
  let buf = new Uint8Array(0);
  try {
    while (buf.length < SCAN_LIMIT_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf); merged.set(value, buf.length); buf = merged;
      let idx = -1;
      outer: for (let i = 0; i <= buf.length - PREFIX.length; i++) {
        for (let j = 0; j < PREFIX.length; j++) if (buf[i + j] !== PREFIX[j]) continue outer;
        idx = i; break;
      }
      if (idx >= 0) {
        const start = idx + PREFIX.length;
        const end = buf.indexOf(0x27, start);
        if (end > 0) return { ok: true, raw: decodeMaybeUtf8(buf.subarray(start, end)) };
      }
    }
    return { ok: false, reason: 'no StreamTitle in window' };
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

function decodeMaybeUtf8(bytes) {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return /�/.test(utf8) ? new TextDecoder('iso-8859-1').decode(bytes) : utf8;
}

async function pool(items, n, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: n }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

const raw = JSON.parse(await readFile(STATIONS_JSON, 'utf8'));
const stations = (raw.stations || [])
  .filter((s) => STATUS_FILTER.includes(s.status))
  .filter((s) => /^https?:/i.test(s.streamUrl || ''))
  .slice(0, LIMIT);

await mkdir(path.dirname(OUT_FILE), { recursive: true });
const created = !existsSync(OUT_FILE);
if (created) await appendFile(OUT_FILE, '');

const startedAt = new Date().toISOString();
let captured = 0;
let empty = 0;
let failed = 0;

console.log(`Sampling ${stations.length} stations (concurrency=${CONCURRENCY})...`);

await pool(stations, CONCURRENCY, async (s, i) => {
  const result = await readIcy(s.streamUrl);
  const row = {
    stationId: s.id,
    name: s.name,
    streamUrl: s.streamUrl,
    raw: result.ok ? result.raw : null,
    reason: result.ok ? null : result.reason,
    ts: new Date().toISOString(),
  };
  await appendFile(OUT_FILE, JSON.stringify(row) + '\n');
  if (!result.ok) failed++;
  else if (!result.raw) empty++;
  else captured++;
  if ((i + 1) % 25 === 0 || i + 1 === stations.length) {
    process.stdout.write(
      `  [${i + 1}/${stations.length}] captured=${captured} empty=${empty} failed=${failed}\r`,
    );
  }
});

console.log('\nDone.');
console.log(`  captured non-empty: ${captured}`);
console.log(`  empty StreamTitle:  ${empty}`);
console.log(`  failed / no ICY:    ${failed}`);
console.log(`  appended to:        ${path.relative(ROOT, OUT_FILE)}`);
console.log(`  run started at:     ${startedAt}`);
