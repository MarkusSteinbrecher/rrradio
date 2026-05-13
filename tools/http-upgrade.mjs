#!/usr/bin/env node
/**
 * Mechanical HTTP→HTTPS favicon upgrade.
 *
 * For each station whose favicon starts with http://, HEAD-checks the
 * https:// equivalent and emits an apply-logos patch for the ones that
 * respond with a successful image.  Stations on the skip list (TuneIn CDN,
 * domain-parking, etc.) are skipped regardless.
 *
 *   node tools/http-upgrade.mjs               # check + write patch
 *   node tools/http-upgrade.mjs --dry-run     # report only, no patch file
 *   node tools/http-upgrade.mjs --concurrency 16
 *
 * Output: /tmp/rrradio-logo-patches/http-upgraded.json
 * Apply:  npm run apply-logos -- --in /tmp/rrradio-logo-patches/http-upgraded.json --replace
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const argv = process.argv.slice(2);
const argFlag = (n) => argv.includes(n);
const argVal = (n, fb) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : fb; };
const DRY_RUN = argFlag('--dry-run');
const CONCURRENCY = Math.max(1, Math.min(32, Number(argVal('--concurrency', 12))));
const FETCH_TIMEOUT_MS = 8_000;

// Domains whose HTTPS logos we must not use.
const SKIP_DOMAINS = new Set([
  'cdn-profiles.tunein.com',   // TuneIn CDN — licensed
  'img.sedoparking.com',       // domain parking placeholder
  'webradiodirectory.com',     // third-party directory
  'static.radio.de',           // radio.de CDN — licensed
  'img.radio.de',              // radio.de CDN — licensed
  'img.nts.live',              // NTS — verify separately
]);

const data = JSON.parse(readFileSync(join(root, 'public/stations.json'), 'utf8'));
const stations = data.stations ?? data;

const candidates = stations.filter(s => s.favicon && s.favicon.startsWith('http://'));
console.log(`http-upgrade: ${candidates.length} HTTP favicon(s) found`);

const skipped = candidates.filter(s => {
  try { return SKIP_DOMAINS.has(new URL(s.favicon.replace(/^http:\/\//, 'https://')).hostname); }
  catch { return false; }
});
const toCheck = candidates.filter(s => !skipped.includes(s));
console.log(`  skipping ${skipped.length} (licensed/parking domains), checking ${toCheck.length}`);

async function headCheck(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'rrradio-logo-bot/1.0 (https://github.com/MarkusSteinbrecher/rrradio; redsukramst@gmail.com)' },
    });
    const ct = res.headers.get('content-type') ?? '';
    return res.ok && (ct.startsWith('image/') || ct === 'application/octet-stream');
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// Run concurrency-limited HEAD checks.
const accepted = [];
const failed = [];

async function runAll() {
  let i = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < toCheck.length) {
      const s = toCheck[i++];
      const httpsUrl = s.favicon.replace(/^http:\/\//, 'https://');
      const ok = await headCheck(httpsUrl);
      if (ok) {
        accepted.push({ id: s.id, url: httpsUrl, source: 'http-upgraded' });
        process.stdout.write('.');
      } else {
        failed.push({ id: s.id, from: s.favicon });
        process.stdout.write('x');
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write('\n');
}

await runAll();

console.log(`\nResults: ${accepted.length} upgradeable, ${failed.length} HTTPS not available, ${skipped.length} skipped`);

if (failed.length > 0) {
  console.log('\nFailed (no HTTPS equivalent):');
  for (const f of failed.slice(0, 20)) {
    console.log(`  ${f.id}: ${f.from}`);
  }
  if (failed.length > 20) console.log(`  …and ${failed.length - 20} more`);
}

if (DRY_RUN) {
  console.log('\n--dry-run: not writing patch file');
  process.exit(0);
}

if (accepted.length === 0) {
  console.log('\nNothing to write.');
  process.exit(0);
}

const outDir = '/tmp/rrradio-logo-patches';
mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}/http-upgraded.json`;
writeFileSync(outPath, JSON.stringify(accepted, null, 2) + '\n');
console.log(`\nPatch written → ${outPath}`);
console.log('Apply with:');
console.log(`  npm run apply-logos -- --in ${outPath} --replace`);
