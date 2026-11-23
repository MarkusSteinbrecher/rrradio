#!/usr/bin/env node
/**
 * The judging session's two commands for the logo-fill rule (ADR 002, rule 9;
 * runbook: docs/logo-fill-judge.md). The session is a scheduled Claude
 * session: it looks at pictures and says yes / no / unsure. Everything else —
 * fetching, numbering, validating, writing the file — is done here so the
 * session cannot mislabel a station or hand-edit JSON.
 *
 *   node tools/logo-fill-judge.mjs sheets --data health-data --out <dir> [--max 100]
 *       Fetches every candidate awaiting a verdict the way the app would,
 *       and writes numbered contact sheets (<dir>/sheet-01.png …, 20 tiles
 *       each, on the app's dark background) plus <dir>/batch.json — the
 *       number → station list — and an empty <dir>/answers.json to fill in.
 *
 *   node tools/logo-fill-judge.mjs record --data health-data --out <dir>
 *       Validates <dir>/answers.json against <dir>/batch.json and merges it
 *       into health-data/logo-fill/verdicts.json. The next decide-actions
 *       run turns each `yes` into a fill-logo action.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { hamming } from './lib/logo-fill.mjs';
import { DARK_BG, fetchCapped, inspectImage, TILE } from './lib/logo-fill-fetch.mjs';
import { mergeVerdicts, pendingCandidates } from './lib/logo-fill-queue.mjs';
import { dayOf } from './lib/observations.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => { console.error(`logo-fill-judge: ${msg}`); process.exit(1); };

const [command, ...rest] = process.argv.slice(2);
const args = { data: null, out: null, max: 100, catalog: join(root, 'public/stations.json') };
for (let i = 0; i < rest.length; i += 1) {
  const a = rest[i];
  if (a === '--data') args.data = rest[++i];
  else if (a === '--out') args.out = rest[++i];
  else if (a === '--max') args.max = Math.max(1, Number(rest[++i]) || 100);
  else if (a === '--catalog') args.catalog = rest[++i];
  else fail(`unknown argument "${a}"`);
}
if (!['sheets', 'record'].includes(command) || !args.data || !args.out) {
  fail('usage: logo-fill-judge <sheets|record> --data <health-data dir> --out <work dir> [--max 100]');
}
const fillDir = join(resolve(args.data), 'logo-fill');
const outDir = resolve(args.out);
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 1) + '\n');

const COLS = 5;
const PER_SHEET = 20;
const GAP = 10;
const CELL = TILE + GAP;
/** Two fetches of one logo hash alike; a replaced picture does not. */
const CHANGED_GAP = 10;

function label(n) {
  const w = 14 + String(n).length * 11;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="26"><rect width="${w}" height="26" fill="#000"/>` +
      `<rect x="0.5" y="0.5" width="${w - 1}" height="25" fill="none" stroke="#fff"/>` +
      `<text x="${w / 2}" y="19" font-family="Helvetica, Arial, DejaVu Sans, Liberation Sans, sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${n}</text></svg>`,
  );
}

async function sheets() {
  const catalogRaw = readJson(resolve(args.catalog), null) ?? fail(`catalog not found at ${args.catalog}`);
  const byId = new Map((Array.isArray(catalogRaw) ? catalogRaw : catalogRaw.stations ?? []).map((s) => [s.id, s]));
  const pending = pendingCandidates(readJson(join(fillDir, 'candidates.json'), {}), readJson(join(fillDir, 'verdicts.json'), {})).slice(0, args.max);
  mkdirSync(outDir, { recursive: true });
  if (pending.length === 0) {
    writeJson(join(outDir, 'batch.json'), { day: dayOf(new Date().toISOString()), items: [], unusable: [] });
    console.log('logo-fill-judge: nothing awaits a verdict.');
    return;
  }

  // Fetch as the app will (foreign Referer). A picture that no longer loads,
  // or is no longer the one the finder hashed, is answered `no` without
  // bothering the judge.
  const fetched = new Array(pending.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < pending.length) {
      const i = next++;
      const c = pending[i];
      try {
        const res = await fetchCapped(c.url, { maxBytes: 3_000_000, accept: 'image/*,*/*;q=0.8', referer: 'https://rrradio.org/' });
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
        const info = await inspectImage(res.buf);
        if (hamming(info.hash, c.hash) > CHANGED_GAP) throw new Error('picture changed since it was found');
        fetched[i] = { tile: info.tile };
      } catch (err) {
        fetched[i] = { error: String(err?.message ?? err).slice(0, 80) };
      }
    }
  }));

  const items = [];
  const unusable = [];
  pending.forEach((c, i) => {
    const s = byId.get(c.id);
    const base = { id: c.id, url: c.url, name: String(s?.name ?? c.id).replace(/\s+/g, ' ').trim(), country: s?.country ?? '', site: c.site, kind: c.kind };
    if (fetched[i].error) unusable.push({ ...base, why: fetched[i].error });
    else items.push({ n: items.length + 1, ...base, tile: fetched[i].tile });
  });

  const files = [];
  for (let start = 0; start < items.length; start += PER_SHEET) {
    const page = items.slice(start, start + PER_SHEET);
    const rows = Math.ceil(page.length / COLS);
    const composite = [];
    page.forEach((item, k) => {
      const left = GAP + (k % COLS) * CELL;
      const top = GAP + Math.floor(k / COLS) * CELL;
      composite.push({ input: item.tile, left, top }, { input: label(item.n), left, top });
    });
    const file = `sheet-${String(files.length + 1).padStart(2, '0')}.png`;
    await sharp({ create: { width: GAP + COLS * CELL, height: GAP + rows * CELL, channels: 3, background: '#6a6a6a' } }).composite(composite).png().toFile(join(outDir, file));
    for (const item of page) item.sheet = file;
    files.push(file);
  }

  const listed = items.map(({ tile, ...rest }) => rest);
  writeJson(join(outDir, 'batch.json'), { day: dayOf(new Date().toISOString()), items: listed, unusable });
  writeJson(join(outDir, 'answers.json'), listed.map((i) => ({ n: i.n, id: i.id, verdict: '', why: '' })));
  console.log(`logo-fill-judge: ${items.length} candidate(s) on ${files.length} sheet(s) in ${outDir} (tiles are on ${DARK_BG}); ${unusable.length} no longer load and will be recorded as "no".`);
  for (const file of files) {
    console.log(`\n${file}`);
    for (const i of listed.filter((x) => x.sheet === file)) console.log(`  ${String(i.n).padStart(3)}  ${i.name} · ${i.country || '??'} · ${i.site} · ${i.kind}`);
  }
  console.log(`\nFill in ${join(outDir, 'answers.json')} (verdict: yes | no | unsure; "generic": true on a "no" that is a platform / framework default), then run: node tools/logo-fill-judge.mjs record --data ${args.data} --out ${args.out}`);
}

function record() {
  const batch = readJson(join(outDir, 'batch.json'), null) ?? fail(`no batch.json in ${outDir} — run "sheets" first`);
  const answers = readJson(join(outDir, 'answers.json'), null) ?? fail(`no answers.json in ${outDir}`);
  const day = dayOf(new Date().toISOString());
  const auto = (batch.unusable ?? []).map((u) => ({ id: u.id, verdict: 'no', why: `not judged: ${u.why}` }));
  const merged = mergeVerdicts({
    batch: [...(batch.items ?? []), ...(batch.unusable ?? [])],
    answers: [...answers.filter((a) => a?.verdict !== ''), ...auto],
    existing: readJson(join(fillDir, 'verdicts.json'), {}),
    day,
  });
  if (merged.errors.length) {
    for (const e of merged.errors) console.error(`  ${e}`);
    fail(`${merged.errors.length} answer(s) rejected — nothing written. Fix answers.json and run "record" again.`);
  }
  mkdirSync(fillDir, { recursive: true });
  writeJson(join(fillDir, 'verdicts.json'), merged.verdicts);
  const tally = { yes: 0, no: 0, unsure: 0 };
  for (const a of answers) if (a?.verdict in tally) tally[a.verdict] += 1;
  console.log(
    `logo-fill-judge: recorded ${merged.accepted} verdict(s) — yes ${tally.yes}, no ${tally.no + auto.length} (${auto.length} no longer load), unsure ${tally.unsure}; ` +
      `${merged.missing.length} left unanswered (they stay in the queue) → ${join(fillDir, 'verdicts.json')}`,
  );
}

if (command === 'sheets') await sheets();
else record();
