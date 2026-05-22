#!/usr/bin/env node
/**
 * Sweep `analyze-rb` across every country in the raw RB snapshot.
 *
 *   npm run analyze-rb-all                       # skip countries with fresh reports
 *   npm run analyze-rb-all -- --force            # re-probe everything
 *   npm run analyze-rb-all -- --max-age 30d      # custom freshness window
 *   npm run analyze-rb-all -- --concurrency 6    # passed through to per-country runs
 *   npm run analyze-rb-all -- --countries CH,AT  # subset
 *
 * Iterates countries in the order data/sources/radio-browser/index.json
 * lists them (alphabetic). For each: if public/rb-analysis-<CC>.json is
 * older than `--max-age` (default 14d) or missing, run analyze-rb.mjs
 * in-process and write the verdict file. Otherwise skip — `--resume`
 * inside analyze-rb would also reuse, but skipping at this level avoids
 * the YAML parse + snapshot load entirely.
 *
 * Politeness: countries run sequentially. Within a country, analyze-rb
 * runs with the configured concurrency. A small delay between countries
 * gives broadcaster origins time to breathe.
 *
 * Logs each country's verdict counts. On Ctrl-C, the in-progress
 * country's report is left as-is; re-running picks up where we stopped.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RAW_INDEX = join(ROOT, 'data', 'sources', 'radio-browser', 'index.json');
const PUBLIC_DIR = join(ROOT, 'public');
const ANALYZER = join(ROOT, 'tools', 'analyze-rb.mjs');

const args = process.argv.slice(2);
function flag(name) { return args.includes(name); }
function value(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
function parseDuration(s) {
  const m = /^(\d+)([dhms])?$/.exec(s || '');
  if (!m) throw new Error(`bad duration '${s}'`);
  return Number(m[1]) * ({ d: 86400, h: 3600, m: 60, s: 1 }[m[2] || 'd']) * 1000;
}

const force = flag('--force');
const onlyMissing = flag('--only-missing');
const concurrency = value('--concurrency', '5');
const maxAge = parseDuration(value('--max-age', '14d'));
const explicitCountries = value('--countries', null);
const interCountryDelayMs = Number(value('--between-ms', '500'));
// Forwarded to analyze-rb so a country sweep can re-probe only stations
// with specific stale verdicts (e.g. after a probe-logic change) and
// leave OK ones alone.
const reprobeVerdicts = value('--reprobe-verdicts', null);

if (!existsSync(RAW_INDEX)) {
  console.error('analyze-rb-all: no data/sources/radio-browser/index.json — run `npm run fetch-rb-raw` first');
  process.exit(1);
}
const index = JSON.parse(readFileSync(RAW_INDEX, 'utf8'));
let countries = Object.keys(index.countries || {}).sort();
if (explicitCountries) {
  const allow = new Set(explicitCountries.split(',').map((s) => s.trim().toUpperCase()));
  countries = countries.filter((c) => allow.has(c));
}
console.log(`analyze-rb-all: ${countries.length} country code(s) in scope`);

function reportFresh(cc) {
  const p = join(PUBLIC_DIR, `rb-analysis-${cc}.json`);
  if (!existsSync(p)) return false;
  if (onlyMissing) return true;  // any report counts as "already done"
  // When --reprobe-verdicts is set, never skip — analyze-rb itself
  // decides per-station whether to reuse or re-probe.
  if (reprobeVerdicts) return false;
  const age = Date.now() - statSync(p).mtimeMs;
  return age < maxAge;
}

function runOne(cc) {
  const childArgs = [ANALYZER, cc, '--concurrency', String(concurrency), '--resume'];
  if (reprobeVerdicts) {
    childArgs.push('--reprobe-verdicts', reprobeVerdicts);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (code !== 0) {
        process.stderr.write(stderr);
        return reject(new Error(`analyze-rb ${cc} exited ${code}`));
      }
      // Echo only the summary line(s) from analyze-rb so this stays
      // readable when sweeping 200+ countries.
      const summary = stdout
        .split('\n')
        .filter((l) => /analyze-rb:|by verdict|total=/.test(l))
        .join('\n');
      resolve(summary);
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let probed = 0;
let skipped = 0;
const startTs = Date.now();

for (const cc of countries) {
  if (!force && reportFresh(cc)) {
    skipped++;
    continue;
  }
  const expected = index.countries[cc]?.count ?? '?';
  process.stdout.write(`\n[${probed + skipped + 1}/${countries.length}] ${cc} (${expected} stations)…\n`);
  try {
    const summary = await runOne(cc);
    process.stdout.write(summary + '\n');
  } catch (err) {
    console.error(`analyze-rb-all: ${cc} failed — ${err.message}`);
  }
  probed++;
  if (interCountryDelayMs > 0) await sleep(interCountryDelayMs);
}

const elapsedMin = ((Date.now() - startTs) / 60_000).toFixed(1);
console.log(
  `\nanalyze-rb-all: done. probed=${probed} skipped=${skipped} ` +
  `(of ${countries.length}) in ${elapsedMin} min`,
);
