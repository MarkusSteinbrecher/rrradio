#!/usr/bin/env node
/**
 * Per-station status report. Reads data/stations.yaml, runs the
 * automated checks documented in docs/curation-checklist.md, and:
 *   1. prints a markdown table to stdout (CI / human reading)
 *   2. writes public/station-status.json (admin dashboard reads this)
 *
 *   npm run analyze
 *
 * Probes are sequential to keep output readable and to avoid hammering
 * any one broadcaster from a single IP.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);
const ORIGIN = 'https://rrradio.org';
const TIMEOUT_MS = 8_000;

// Fetchers we have wired today. Keep in sync with FETCHERS_BY_KEY in
// src/builtins.ts.
const KNOWN_FETCHERS = new Set(['grrif', 'orf', 'br-radioplayer']);
// Of those, which expose program (show) info beyond just track titles.
const PROGRAM_CAPABLE = new Set(['orf', 'br-radioplayer']);
// Fetchers that hardcode their own metadata endpoint (don't depend on
// the YAML's metadataUrl). For these, the meta column reports the
// built-in source rather than "not declared".
const SELF_CONTAINED_FETCHERS = new Set(['grrif']);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function timed(promise) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return [promise(ctrl.signal), () => clearTimeout(timer)];
}

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const C = COLOR
  ? { ok: '\x1b[32m', warn: '\x1b[33m', bad: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { ok: '', warn: '', bad: '', dim: '', reset: '' };

const STATE = {
  ok: { glyph: '✓', color: C.ok },
  warn: { glyph: '~', color: C.warn },
  bad: { glyph: '✗', color: C.bad },
  na: { glyph: '·', color: C.dim },
};

function badge(state) {
  const s = STATE[state];
  return `${s.color}${s.glyph}${C.reset}`;
}

// ─────────────────────────────────────────────────────────────
// Probes
// ─────────────────────────────────────────────────────────────

async function probeStream(url) {
  const [p, done] = timed((signal) =>
    fetch(url, { signal, headers: { Origin: ORIGIN, 'Icy-MetaData': '1' } }),
  );
  try {
    const res = await p;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const metaint = res.headers.get('icy-metaint');
    let icyTitle = null;
    if (res.ok && res.body) {
      // Read up to 64 KB and brute-force scan for StreamTitle, similar
      // to the runtime brute-force fallback. Cheaper than chasing
      // metaint when the icy-metaint header is hidden by CORS.
      const PREFIX = Buffer.from("StreamTitle='", 'utf8');
      const reader = res.body.getReader();
      let buf = Buffer.alloc(0);
      try {
        while (buf.length < 64 * 1024) {
          const { value, done: rdDone } = await reader.read();
          if (rdDone) break;
          if (!value) continue;
          buf = Buffer.concat([buf, Buffer.from(value)]);
          const idx = buf.indexOf(PREFIX);
          if (idx >= 0) {
            const start = idx + PREFIX.length;
            const end = buf.indexOf(0x27, start);
            if (end > 0) {
              icyTitle = buf.slice(start, end).toString('utf8');
              break;
            }
          }
        }
      } finally {
        try { await reader.cancel(); } catch {}
      }
    }
    try { await res.body?.cancel(); } catch {}
    return {
      status: res.status,
      contentType: ct,
      metaintAdvertised: !!metaint,
      icyTitle,
    };
  } catch (err) {
    return { status: 'failed', error: String(err).slice(0, 80) };
  } finally {
    done();
  }
}

async function probeMetadataUrl(url) {
  const [p, done] = timed((signal) =>
    fetch(url, { signal, headers: { Origin: ORIGIN } }),
  );
  try {
    const res = await p;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    try { await res.body?.cancel(); } catch {}
    return { status: res.status, contentType: ct };
  } catch (err) {
    return { status: 'failed', error: String(err).slice(0, 80) };
  } finally {
    done();
  }
}

// ─────────────────────────────────────────────────────────────
// Per-station analysis
// ─────────────────────────────────────────────────────────────

function classifyStream(probe) {
  if (probe.status === 'failed') return { state: 'bad', detail: probe.error || 'unreachable' };
  if (typeof probe.status === 'number' && probe.status >= 400) return { state: 'bad', detail: `HTTP ${probe.status}` };
  const ct = probe.contentType || '';
  const audioLike = ct.startsWith('audio/') || ct.includes('mpegurl') || ct.includes('octet-stream');
  if (!audioLike) return { state: 'warn', detail: `content-type "${ct || '?'}"` };
  return { state: 'ok', detail: ct };
}

function classifyHttps(streamUrl) {
  return /^https:\/\//i.test(streamUrl)
    ? { state: 'ok' }
    : { state: 'bad', detail: 'http (mixed content)' };
}

function classifyIcy(probe, codec) {
  // HLS streams don't carry ICY by design — they multiplex metadata
  // through the manifest instead. Mark as N/A rather than failed.
  if ((codec ?? '').toUpperCase() === 'HLS') return { state: 'na', detail: 'HLS — metadata via manifest' };
  if (probe.icyTitle) return { state: 'ok', detail: `"${probe.icyTitle.slice(0, 40)}"` };
  if (probe.metaintAdvertised) return { state: 'warn', detail: 'icy-metaint advertised but no StreamTitle in first 64 KB' };
  return { state: 'bad', detail: 'no ICY metadata' };
}

function classifyMetadataApi(metadataUrl, probe, metadataKey) {
  if (!metadataUrl) {
    if (metadataKey && SELF_CONTAINED_FETCHERS.has(metadataKey)) {
      return { state: 'ok', detail: `built into ${metadataKey} fetcher` };
    }
    return { state: 'na', detail: 'not declared' };
  }
  if (!probe || probe.status === 'failed') return { state: 'bad', detail: probe?.error || 'unreachable' };
  if (typeof probe.status === 'number' && probe.status >= 400) return { state: 'bad', detail: `HTTP ${probe.status}` };
  if (!probe.contentType?.includes('json')) {
    return { state: 'warn', detail: `content-type "${probe.contentType || '?'}"` };
  }
  return { state: 'ok' };
}

function classifyFetcher(metadataKey) {
  if (!metadataKey) return { state: 'na', detail: 'generic' };
  if (KNOWN_FETCHERS.has(metadataKey)) return { state: 'ok', detail: metadataKey };
  return { state: 'bad', detail: `unknown key "${metadataKey}"` };
}

function classifyProgram(metadataKey) {
  if (!metadataKey) return { state: 'na' };
  return PROGRAM_CAPABLE.has(metadataKey) ? { state: 'ok' } : { state: 'warn', detail: 'fetcher does not expose program info' };
}

function classifyLogo(favicon) {
  if (!favicon) return { state: 'bad', detail: 'no favicon' };
  if (/^stations\//.test(favicon)) return { state: 'ok', detail: favicon };
  if (/^https?:\/\//.test(favicon)) return { state: 'warn', detail: 'imported (Radio Browser favicon)' };
  return { state: 'warn', detail: favicon };
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

const broadcasters = parseYaml(readFileSync(join(root, 'data/broadcasters.yaml'), 'utf8')) ?? {};
const stations = parseYaml(readFileSync(join(root, 'data/stations.yaml'), 'utf8'));
if (!Array.isArray(stations)) {
  console.error('analyze: stations.yaml is not a list');
  process.exit(1);
}
const targets = stations.filter((s) => PUBLISHABLE.has(s?.status));

console.log('');
console.log(`analyzing ${targets.length} publishable stations…`);
console.log('');

const HEADER = ['stream', 'https', 'icy', 'meta', 'fetch', 'prog', 'logo'];
const colWidth = 'station                       ';
console.log(
  `${colWidth} ${HEADER.map((h) => h.padEnd(5)).join(' ')}  status`,
);
console.log(`${''.padEnd(colWidth.length, '─')} ${HEADER.map(() => '─────').join(' ')}  ──────`);

const report = [];

for (const s of targets) {
  const broadcaster = broadcasters[s.broadcaster] ?? {};
  const metadataKey = s.metadata ?? broadcaster.metadata ?? null;

  const streamProbe = await probeStream(s.streamUrl);
  const metaProbe = s.metadataUrl ? await probeMetadataUrl(s.metadataUrl) : null;

  const checks = {
    stream: classifyStream(streamProbe),
    https: classifyHttps(s.streamUrl),
    icy: classifyIcy(streamProbe, s.codec),
    metadataApi: classifyMetadataApi(s.metadataUrl, metaProbe, metadataKey),
    fetcher: classifyFetcher(metadataKey),
    program: classifyProgram(metadataKey),
    logo: classifyLogo(s.favicon),
  };

  const row = [
    s.id.padEnd(colWidth.length),
    badge(checks.stream.state).padEnd(5),
    badge(checks.https.state).padEnd(5),
    badge(checks.icy.state).padEnd(5),
    badge(checks.metadataApi.state).padEnd(5),
    badge(checks.fetcher.state).padEnd(5),
    badge(checks.program.state).padEnd(5),
    badge(checks.logo.state).padEnd(5),
  ].join(' ');
  console.log(`${row} ${s.status}`);

  report.push({
    id: s.id,
    name: s.name,
    broadcaster: s.broadcaster,
    status: s.status,
    streamUrl: s.streamUrl,
    metadataUrl: s.metadataUrl ?? null,
    favicon: s.favicon ?? null,
    metadataKey,
    checks,
  });
}

console.log('');

// Write the JSON consumed by the admin dashboard. Public-readable —
// it's just catalog metadata, no secrets.
const outPath = join(root, 'public/station-status.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), stations: report }, null, 2) + '\n',
);
console.log(`wrote ${outPath}`);
console.log('');
