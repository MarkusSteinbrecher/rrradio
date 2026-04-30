#!/usr/bin/env node
/**
 * Probes every publishable station in data/stations.yaml and prints
 * an ok/changed/broken verdict per station. Detects rot before users
 * hit it. Read-only — does not modify YAML.
 *
 *   npm run validate-catalog
 *
 * Verdicts:
 *   OK       stream returned 2xx with an audio/* (or octet-stream) body
 *   META?    stream OK but the declared metadataUrl errored / CORS-blocks
 *   CHANGED  stream returned 2xx but with a content-type we don't expect
 *   BROKEN   stream did not return 2xx, or the connection failed
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);
const ORIGIN = 'https://rrradio.org';
const TIMEOUT_MS = 8_000;

const stations = parseYaml(readFileSync(join(root, 'data/stations.yaml'), 'utf8'));
if (!Array.isArray(stations)) {
  console.error('validate-catalog: stations.yaml is not a list');
  process.exit(1);
}

// Resolved-URL lookup: RB-bound entries don't carry streamUrl in the
// YAML — the build pulls it from Radio Browser. Read the build
// artifact so we can probe those entries instead of failing on
// undefined.
let resolvedById = {};
try {
  const built = JSON.parse(readFileSync(join(root, 'public/stations.json'), 'utf8'));
  const list = Array.isArray(built) ? built : built.stations || [];
  for (const s of list) {
    if (s?.id) resolvedById[s.id] = s;
  }
} catch {
  // No artifact yet — skip resolution; missing-streamUrl rows will
  // surface as BROKEN, which is still a useful signal.
}

const targets = stations
  .filter((s) => PUBLISHABLE.has(s?.status))
  .map((s) => ({
    ...s,
    streamUrl: s.streamUrl ?? resolvedById[s.id]?.streamUrl,
    metadataUrl: s.metadataUrl ?? resolvedById[s.id]?.metadataUrl,
  }));

function timed(promise) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return [promise(ctrl.signal), () => clearTimeout(timer)];
}

async function probeStream(url) {
  const [p, done] = timed((signal) =>
    fetch(url, {
      signal,
      headers: { Origin: ORIGIN, 'Icy-MetaData': '1' },
    }),
  );
  try {
    const res = await p;
    const ct = res.headers.get('content-type') ?? '';
    try { await res.body?.cancel(); } catch {}
    return { status: res.status, contentType: ct };
  } catch (err) {
    return { status: 'failed', error: String(err) };
  } finally {
    done();
  }
}

async function probeMeta(url) {
  const [p, done] = timed((signal) =>
    fetch(url, { signal, headers: { Origin: ORIGIN } }),
  );
  try {
    const res = await p;
    try { await res.body?.cancel(); } catch {}
    return { status: res.status };
  } catch (err) {
    return { status: 'failed', error: String(err) };
  } finally {
    done();
  }
}

function classify(streamRes, metaRes) {
  if (streamRes.status === 'failed' || (typeof streamRes.status === 'number' && streamRes.status >= 400)) {
    return 'BROKEN';
  }
  const ct = (streamRes.contentType ?? '').toLowerCase();
  const audioLike = ct.startsWith('audio/') || ct.includes('mpegurl') || ct.includes('octet-stream');
  if (!audioLike) return 'CHANGED';
  if (metaRes && (metaRes.status === 'failed' || (typeof metaRes.status === 'number' && metaRes.status >= 400))) {
    return 'META?';
  }
  return 'OK';
}

// Skip ANSI escapes when piped (CI / file redirect). The workflow
// posts the captured output into a GitHub issue body, where escapes
// would leak through as garbage.
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const ICON = COLOR
  ? { OK: '\x1b[32m✓\x1b[0m', 'META?': '\x1b[33m!\x1b[0m', CHANGED: '\x1b[33m~\x1b[0m', BROKEN: '\x1b[31m✗\x1b[0m' }
  : { OK: '✓', 'META?': '!', CHANGED: '~', BROKEN: '✗' };
const tally = { OK: 0, 'META?': 0, CHANGED: 0, BROKEN: 0 };

console.log(`\nvalidating ${targets.length} publishable stations…\n`);

// Sequential probes — keeps output readable + spares broadcasters from
// a parallel storm out of one IP.
for (const s of targets) {
  process.stdout.write(`  ${s.id.padEnd(28)} `);
  const stream = await probeStream(s.streamUrl);
  const meta = s.metadataUrl ? await probeMeta(s.metadataUrl) : undefined;
  const v = classify(stream, meta);
  tally[v] += 1;
  const detail =
    v === 'BROKEN' ? `stream ${stream.status}${stream.error ? ` (${stream.error.slice(0, 60)})` : ''}` :
    v === 'CHANGED' ? `unexpected content-type "${stream.contentType ?? '?'}"` :
    v === 'META?' ? `metadata ${meta?.status}` :
    '';
  console.log(`${ICON[v]} ${v.padEnd(8)} ${detail}`);
}

console.log('');
console.log(
  `summary: ${tally.OK} ok, ${tally['META?']} meta?, ${tally.CHANGED} changed, ${tally.BROKEN} broken`,
);
console.log('');

if (tally.BROKEN > 0 || tally.CHANGED > 0) process.exit(2);
