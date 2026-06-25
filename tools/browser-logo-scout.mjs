#!/usr/bin/env node
/**
 * browser-logo-scout — the headless/unattended counterpart to the parallel
 * Opus-agent logo discovery documented in .claude/skills/curate-logos/SKILL.md.
 *
 * The interactive path (an Opus 4.8 agent per station that browses, downloads,
 * and *looks* at candidates) is strictly more capable — it reasons about
 * rebrands, namesake collisions, and license nuance. Use this only where no
 * harness/human is in the loop (e.g. a future catalog-watch step):
 *
 *   1. Playwright opens each station's homepage, dismisses the consent wall,
 *      and extracts every plausible logo asset from the *live* DOM (header
 *      img/svg, og:image, twitter:image, apple-touch-icon, link rel icon,
 *      web-app-manifest icons) — with position + natural size.
 *   2. tools/lib/logo-candidates.mjs filters to allowed hosts (https, the
 *      broadcaster domain or Wikimedia, never UGC hosts), dedupes, and ranks.
 *   3. A "review packet" (header screenshot + candidate thumbnails + manifest)
 *      is written per station under .cache/logo-scout/<id>/.
 *   4. --judge packet (default): leave the packet for an Opus agent / human to
 *      pick (they Read the images). --judge api: send the packet to Opus 4.8
 *      vision over the Messages API (needs ANTHROPIC_API_KEY) for a headless
 *      pick. Either way the winner is emitted in apply-logos' {id,url,source}
 *      shape so `apply-logos --in` can apply it.
 *
 * Deterministic helpers in logo-candidates.mjs are unit-tested; the browser +
 * network + vision I/O lives in main().
 *
 *   node tools/browser-logo-scout.mjs --cc DE --limit 30
 *   node tools/browser-logo-scout.mjs --id wdr-wdr-2,ndr-ndr-2
 *   node tools/browser-logo-scout.mjs --cc DE --judge api > /tmp/picks.json
 *   ANTHROPIC_API_KEY=... required only for --judge api (model claude-opus-4-8).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { rankCandidates, broadcasterBase } from './lib/logo-candidates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '.cache', 'logo-scout');
const MODEL = 'claude-opus-4-8';
const UA = 'rrradio-logo-scout/1.0 (+https://github.com/MarkusSteinbrecher/rrradio)';

function parseArgs(argv) {
  const out = { ids: new Set(), cc: '', limit: 0, concurrency: 4, timeout: 20000, judge: 'packet', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--id' || a === '--only') for (const id of (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) out.ids.add(id);
    else if (a === '--cc') out.cc = String(argv[++i] ?? '').toUpperCase();
    else if (a === '--limit') out.limit = Number(argv[++i]) || 0;
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i]) || 4);
    else if (a === '--timeout') out.timeout = Math.max(5000, Number(argv[++i]) || 20000);
    else if (a === '--judge') out.judge = String(argv[++i] ?? 'packet');
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') { console.log('usage: browser-logo-scout [--cc XX | --id a,b] [--limit N] [--concurrency N] [--timeout MS] [--judge packet|api] [--json]'); process.exit(0); }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

function selectStations() {
  const raw = JSON.parse(readFileSync(join(ROOT, 'public', 'stations.json'), 'utf8'));
  let list = (Array.isArray(raw) ? raw : raw.stations) || [];
  if (args.ids.size) list = list.filter((s) => args.ids.has(s.id));
  else if (args.cc) list = list.filter((s) => (s.country || '').toUpperCase() === args.cc);
  list = list.filter((s) => s.homepage);
  if (args.limit) list = list.slice(0, args.limit);
  return list;
}

// Runs in the page: harvest every plausible logo asset from the live DOM.
function collectInPage() {
  const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch { return null; } };
  const out = [];
  const push = (kind, url, extra = {}) => { const a = abs(url); if (a) out.push({ kind, url: a, ...extra }); };
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content');
  push('og:image', meta('meta[property="og:image"]'));
  push('twitter:image', meta('meta[name="twitter:image"]') || meta('meta[property="twitter:image"]'));
  for (const l of document.querySelectorAll('link[rel~="apple-touch-icon"]')) push('apple-touch-icon', l.getAttribute('href'), { width: parseInt(l.getAttribute('sizes')) || null });
  for (const l of document.querySelectorAll('link[rel~="icon"]')) push('link-icon', l.getAttribute('href'), { width: parseInt(l.getAttribute('sizes')) || null });
  // header/nav imagery, with on-page geometry
  const headers = [...document.querySelectorAll('header, [role="banner"], nav, .header, #header, .logo, [class*="logo" i]')];
  const seen = new Set();
  for (const root of headers) {
    for (const img of root.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (seen.has(img.currentSrc || img.src)) continue; seen.add(img.currentSrc || img.src);
      push('header-img', img.currentSrc || img.src, { alt: img.alt || '', width: img.naturalWidth || Math.round(r.width) || null, height: img.naturalHeight || Math.round(r.height) || null, inHeader: r.top < 200 });
    }
    for (const svg of root.querySelectorAll('svg')) {
      const r = svg.getBoundingClientRect();
      if (r.width < 24) continue;
      const aria = svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || '';
      if (/logo|brand/i.test(svg.className?.baseVal || svg.id || aria)) push('header-svg', location.href, { alt: aria, inHeader: r.top < 200, inlineSvg: true });
    }
  }
  return out;
}

async function readManifestIcons(page) {
  try {
    const href = await page.getAttribute('link[rel="manifest"]', 'href');
    if (!href) return [];
    const url = new URL(href, page.url()).href;
    const m = await page.evaluate(async (u) => { try { const r = await fetch(u); return await r.json(); } catch { return null; } }, url);
    if (!m?.icons) return [];
    return m.icons.map((ic) => ({ kind: 'manifest-icon', url: new URL(ic.src, url).href, width: parseInt(ic.sizes) || null, height: parseInt(ic.sizes) || null, format: (ic.type || '').split('/')[1] || null }));
  } catch { return []; }
}

const CONSENT = ['button:has-text("Akzeptieren")', 'button:has-text("Alle akzeptieren")', 'button:has-text("Zustimmen")', 'button:has-text("Einverstanden")', 'button:has-text("Accept")', '[id*="accept" i]', '[class*="accept" i]'];
async function dismissConsent(page) {
  for (const sel of CONSENT) {
    try { const el = page.locator(sel).first(); if (await el.isVisible({ timeout: 400 })) { await el.click({ timeout: 800 }); return; } } catch { /* next */ }
  }
}

async function scoutStation(context, station) {
  const id = station.id;
  const dir = join(OUT_DIR, id);
  mkdirSync(dir, { recursive: true });
  const page = await context.newPage();
  const result = { id, name: station.name, homepage: station.homepage, candidates: [], error: null };
  try {
    await page.goto(station.homepage, { waitUntil: 'domcontentloaded', timeout: args.timeout });
    await dismissConsent(page);
    const [raw, manifestIcons] = await Promise.all([page.evaluate(collectInPage), readManifestIcons(page)]);
    const ranked = rankCandidates([...raw, ...manifestIcons], { stationName: station.name || '', broadcasterHost: broadcasterBase(station.homepage), limit: 8 });
    // header screenshot for the vision judge
    try { await page.screenshot({ path: join(dir, 'header.png'), clip: { x: 0, y: 0, width: 1280, height: 240 } }); } catch { /* non-fatal */ }
    result.candidates = ranked;
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    result.error = String(err?.message || err).slice(0, 200);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

// --judge api: ask Opus 4.8 to pick the correct station logo from the shortlist.
async function judgeWithApi(result) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('--judge api needs ANTHROPIC_API_KEY');
  if (!result.candidates.length) return { id: result.id, decision: 'skip', reason: 'no candidates' };
  const list = result.candidates.map((c, i) => `[${i}] kind=${c.kind} fmt=${c.format} ${c.width || '?'}x${c.height || '?'} ${c.url}`).join('\n');
  const prompt = `You are curating the logo for the radio station "${result.name}" (homepage ${result.homepage}). Pick the ONE candidate below that is this station's own current, station-specific logo — NOT a generic parent-network logo, placeholder, or unrelated image. Reply ONLY as JSON {"index": <n or -1 if none good>, "reason": "..."}.\n\nCandidates:\n${list}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, thinking: { type: 'adaptive' }, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`anthropic http ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const pick = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (pick.index == null || pick.index < 0) return { id: result.id, decision: 'skip', reason: pick.reason || 'judge declined' };
  const c = result.candidates[pick.index];
  return { id: result.id, decision: 'apply', url: c.url, source: c.kind === 'manifest-icon' || c.kind.startsWith('header') || c.kind.includes('image') ? 'broadcaster-site' : 'broadcaster-site', license: 'broadcaster-implicit', reason: pick.reason };
}

async function pool(items, n, fn) {
  const results = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx]); }
  }));
  return results;
}

async function main() {
  const stations = selectStations();
  if (!stations.length) { console.error('browser-logo-scout: no matching stations with a homepage'); process.exit(1); }
  console.error(`browser-logo-scout: ${stations.length} station(s), judge=${args.judge}, concurrency=${args.concurrency}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
  const picks = [];
  try {
    const scouted = await pool(stations, args.concurrency, (s) => scoutStation(context, s));
    for (const r of scouted) {
      if (r.error) { console.error(`  ✗ ${r.id}  ${r.error}`); continue; }
      console.error(`  · ${r.id}  ${r.candidates.length} candidate(s)  → .cache/logo-scout/${r.id}/`);
      if (args.judge === 'api') {
        try { const p = await judgeWithApi(r); picks.push(p); console.error(`      judge: ${p.decision}${p.url ? ' ' + p.url : ''}`); }
        catch (e) { console.error(`      judge error: ${e.message}`); }
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (args.judge === 'api') process.stdout.write(JSON.stringify(picks.filter((p) => p.decision === 'apply').map(({ id, url, source, license }) => ({ id, url, source, license })), null, 2) + '\n');
  else console.error(`\nReview packets in ${OUT_DIR}/<id>/ — an Opus agent (or you) can Read header.png + candidate manifests and pick, then feed apply-logos.`);
}

main().catch((e) => { console.error('browser-logo-scout failed:', e); process.exit(1); });
