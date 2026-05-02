#!/usr/bin/env node
/**
 * Usage:
 *   npm run evaluate-icy-parser
 *   npm run evaluate-icy-parser -- --show 30
 *
 * Runs the current heuristic parser (mirrored from src/icyMetadata.ts)
 * against the Gemma-labeled corpus and reports where it agrees, where it
 * disagrees, and what the top failure modes look like.
 *
 * Read-only — does not modify YAML or source. The point is to surface the
 * shape of the long tail so the heuristic in src/icyMetadata.ts can be
 * tightened against real data instead of guesses.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const LABELS_FILE = path.join(ROOT, 'data', 'icy-labels.jsonl');

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return args[i + 1];
}
const SHOW = Number(flag('show', 20));

// Mirrored from src/icyMetadata.ts:parseStreamTitle. Keep in sync.
function parseStreamTitle(raw) {
  const t = raw.trim();
  if (!t) return null;
  const idx = t.indexOf(' - ');
  if (idx > 0 && idx < t.length - 3) {
    return { artist: t.slice(0, idx).trim(), track: t.slice(idx + 3).trim(), raw: t };
  }
  return { track: t, raw: t };
}

if (!existsSync(LABELS_FILE)) {
  console.error(`No labels at ${path.relative(ROOT, LABELS_FILE)}.`);
  console.error(`Run: npm run sample-icy && npm run gemma-label-icy`);
  process.exit(1);
}

const labels = (await readFile(LABELS_FILE, 'utf8'))
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l))
  .filter((row) => row.parsed); // skip error rows

const total = labels.length;
if (!total) {
  console.error('Labels file is empty.');
  process.exit(1);
}

const eq = (a, b) => (a ?? null) === (b ?? null);
const lower = (s) => (s ? s.toLowerCase() : s);
const eqCaseless = (a, b) => lower(a ?? null) === lower(b ?? null);

// What does the current parser claim, mapped into Gemma's vocabulary?
//   - artist + track  → effectively "music" claim
//   - track only      → ambiguous, current code surfaces as music title
function currentClaim(raw) {
  const p = parseStreamTitle(raw);
  if (!p) return { kind: 'empty', artist: null, title: null };
  return {
    kind: p.artist ? 'music_split' : 'music_unsplit',
    artist: p.artist || null,
    title: p.track || null,
  };
}

const counts = {
  total,
  byKind: {},
  // Outcomes:
  perfectMusic: 0,         // gemma=music, current split correctly (artist+title match)
  reversedMusic: 0,        // gemma=music, current swapped artist <> title
  partialMusic: 0,         // gemma=music, current got one of artist/title right
  missedSplitMusic: 0,     // gemma=music, current returned track-only (no split)
  wrongSplitNonMusic: 0,   // gemma!=music but current split it as if it were music
  trackOnlyMatched: 0,     // gemma!=music and current returned track-only (acceptable for show/station_id)
};

const failures = [];

for (const row of labels) {
  const g = row.parsed; // gemma label
  const c = currentClaim(row.raw);
  counts.byKind[g.kind] = (counts.byKind[g.kind] || 0) + 1;

  if (g.kind === 'music') {
    const split = c.kind === 'music_split';
    const matchAT = split && eqCaseless(c.artist, g.artist) && eqCaseless(c.title, g.title);
    const reversedAT = split && eqCaseless(c.artist, g.title) && eqCaseless(c.title, g.artist);
    const oneRight =
      split && (eqCaseless(c.artist, g.artist) || eqCaseless(c.title, g.title));
    if (matchAT) counts.perfectMusic++;
    else if (reversedAT) {
      counts.reversedMusic++;
      failures.push({ kind: 'reversed', raw: row.raw, gemma: g, current: c });
    } else if (!split) {
      counts.missedSplitMusic++;
      failures.push({ kind: 'missed_split', raw: row.raw, gemma: g, current: c });
    } else if (oneRight) {
      counts.partialMusic++;
      failures.push({ kind: 'partial', raw: row.raw, gemma: g, current: c });
    } else {
      failures.push({ kind: 'wrong_split', raw: row.raw, gemma: g, current: c });
    }
  } else {
    // gemma classified as ad / station_id / show / unknown
    if (c.kind === 'music_split') {
      counts.wrongSplitNonMusic++;
      failures.push({ kind: `nonmusic_split:${g.kind}`, raw: row.raw, gemma: g, current: c });
    } else {
      counts.trackOnlyMatched++;
    }
  }
}

const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;

console.log(`Evaluated ${total} labeled samples`);
console.log('');
console.log('Gemma kind distribution:');
for (const [k, v] of Object.entries(counts.byKind).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)}  ${pct(v)}`);
}
console.log('');
console.log('Current parser outcomes:');
console.log(`  music · perfect split        ${String(counts.perfectMusic).padStart(5)}  ${pct(counts.perfectMusic)}`);
console.log(`  music · reversed artist/title ${String(counts.reversedMusic).padStart(4)}  ${pct(counts.reversedMusic)}`);
console.log(`  music · partial (1 of 2)     ${String(counts.partialMusic).padStart(5)}  ${pct(counts.partialMusic)}`);
console.log(`  music · missed split          ${String(counts.missedSplitMusic).padStart(4)}  ${pct(counts.missedSplitMusic)}`);
console.log(`  non-music · falsely split    ${String(counts.wrongSplitNonMusic).padStart(5)}  ${pct(counts.wrongSplitNonMusic)}`);
console.log(`  non-music · track-only ok    ${String(counts.trackOnlyMatched).padStart(5)}  ${pct(counts.trackOnlyMatched)}`);

const passing = counts.perfectMusic + counts.trackOnlyMatched;
console.log('');
console.log(`Agreement (perfect music + non-music handled gracefully): ${pct(passing)}`);

if (failures.length === 0) {
  console.log('No failures.');
  process.exit(0);
}

console.log('');
console.log(`Top ${Math.min(SHOW, failures.length)} failures (of ${failures.length}):`);
const grouped = {};
for (const f of failures) {
  grouped[f.kind] = (grouped[f.kind] || 0) + 1;
}
for (const [k, v] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} ${String(v).padStart(5)}`);
}
console.log('');
console.log('Sample failures:');
for (const f of failures.slice(0, SHOW)) {
  console.log(`  [${f.kind}]`);
  console.log(`    raw:     ${JSON.stringify(f.raw)}`);
  console.log(`    gemma:   ${JSON.stringify(f.gemma)}`);
  console.log(`    current: ${JSON.stringify(f.current)}`);
}
