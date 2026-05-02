#!/usr/bin/env node
/**
 * Usage:
 *   npm run gemma-label-icy
 *   npm run gemma-label-icy -- --model gemma3:4b
 *   npm run gemma-label-icy -- --limit 50
 *
 * Reads data/icy-samples.jsonl, dedupes by raw text, calls a local Ollama
 * model to parse each into {artist, title, kind}, and writes
 * data/icy-labels.jsonl (one row per unique raw string).
 *
 * Idempotent: rows already present in icy-labels.jsonl are skipped on re-run.
 *
 * Requires Ollama running locally (default: http://127.0.0.1:11434) with
 * the requested model pulled, e.g. `ollama pull gemma3:4b`.
 */

import { readFile, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SAMPLES_FILE = path.join(ROOT, 'data', 'icy-samples.jsonl');
const LABELS_FILE = path.join(ROOT, 'data', 'icy-labels.jsonl');

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return args[i + 1];
}
const MODEL = String(flag('model', 'gemma3:4b'));
const ENDPOINT = String(flag('endpoint', 'http://127.0.0.1:11434'));
const LIMIT = Number(flag('limit', 0)) || Infinity;

const SYSTEM_PROMPT = `You parse "now playing" strings from internet radio streams.

Given an ICY StreamTitle, return JSON with this exact schema:
{
  "artist": string | null,
  "title": string | null,
  "kind": "music" | "ad" | "station_id" | "show" | "unknown"
}

Rules:
- "music" = a song. Fill both artist and title.
- "ad" = commercial, sponsor, jingle. Both null.
- "station_id" = station name, slogan, "you're listening to...". Both null.
- "show" = program/host name without a track. Set title to show name, artist null.
- If a field cannot be determined, use null. Do not guess.
- Output only the JSON object. No prose.

Examples:

Input: "Daft Punk - Get Lucky"
Output: {"artist":"Daft Punk","title":"Get Lucky","kind":"music"}

Input: "Get Lucky - Daft Punk"
Output: {"artist":"Daft Punk","title":"Get Lucky","kind":"music"}

Input: "Now Playing: Radiohead — Karma Police"
Output: {"artist":"Radiohead","title":"Karma Police","kind":"music"}

Input: "FM4 - Reality Check"
Output: {"artist":null,"title":"Reality Check","kind":"show"}

Input: "ADVERTISEMENT"
Output: {"artist":null,"title":null,"kind":"ad"}

Input: "BBC Radio 1 - Live"
Output: {"artist":null,"title":null,"kind":"station_id"}

Input: "StreamTitle='Miles Davis: So What';"
Output: {"artist":"Miles Davis","title":"So What","kind":"music"}`;

function readLines(buf) {
  return buf.split('\n').filter((l) => l.trim().length > 0);
}

async function loadJsonl(file) {
  if (!existsSync(file)) return [];
  return readLines(await readFile(file, 'utf8'))
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

function extractJson(text) {
  // Models occasionally wrap JSON in ```json ... ``` or add prose. Find the
  // first balanced object and parse that.
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

async function callOllama(raw) {
  const res = await fetch(`${ENDPOINT}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      system: SYSTEM_PROMPT,
      prompt: `Input: "${raw.replace(/"/g, '\\"')}"\nOutput:`,
      stream: false,
      format: 'json',
      options: { temperature: 0, num_predict: 128 },
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const body = await res.json();
  return body.response ?? '';
}

function validateLabel(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const kinds = new Set(['music', 'ad', 'station_id', 'show', 'unknown']);
  if (!kinds.has(obj.kind)) return null;
  const norm = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { artist: norm(obj.artist), title: norm(obj.title), kind: obj.kind };
}

const samples = await loadJsonl(SAMPLES_FILE);
if (!samples.length) {
  console.error(`No samples found at ${path.relative(ROOT, SAMPLES_FILE)}.`);
  console.error(`Run: npm run sample-icy`);
  process.exit(1);
}

const uniqueRaw = [...new Set(samples.map((s) => s.raw).filter((r) => typeof r === 'string' && r.trim()))];
const existing = await loadJsonl(LABELS_FILE);
const labeled = new Set(existing.map((r) => r.raw));
const todo = uniqueRaw.filter((r) => !labeled.has(r)).slice(0, LIMIT);

console.log(`Samples: ${samples.length} (unique non-empty raw: ${uniqueRaw.length})`);
console.log(`Already labeled: ${labeled.size}`);
console.log(`To label this run: ${todo.length}`);
console.log(`Model: ${MODEL} via ${ENDPOINT}`);

await mkdir(path.dirname(LABELS_FILE), { recursive: true });

let ok = 0;
let bad = 0;
for (let i = 0; i < todo.length; i++) {
  const raw = todo[i];
  try {
    const text = await callOllama(raw);
    const parsed = validateLabel(extractJson(text));
    if (!parsed) {
      bad++;
      await appendFile(LABELS_FILE, JSON.stringify({ raw, error: 'invalid_json', response: text.slice(0, 200) }) + '\n');
    } else {
      ok++;
      await appendFile(LABELS_FILE, JSON.stringify({ raw, parsed }) + '\n');
    }
  } catch (err) {
    bad++;
    await appendFile(LABELS_FILE, JSON.stringify({ raw, error: String(err?.message || err) }) + '\n');
  }
  if ((i + 1) % 10 === 0 || i + 1 === todo.length) {
    process.stdout.write(`  [${i + 1}/${todo.length}] ok=${ok} bad=${bad}\r`);
  }
}
console.log('\nDone.');
console.log(`  labeled: ${ok}`);
console.log(`  errors:  ${bad}`);
console.log(`  written to: ${path.relative(ROOT, LABELS_FILE)}`);
