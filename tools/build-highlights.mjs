#!/usr/bin/env node
/**
 * Reads data/highlights.yaml + the published catalog (public/stations.json)
 * and writes the editorial "Featured by rrradio" feed to
 * public/highlights.json.
 *
 * The feed drives the Browse discovery rail on every client. Each entry
 * REFERENCES a catalog station by id — the station's name, logo, genre,
 * and flag are derived from the catalog at render time, so only the
 * curated fields (badge + blurb + optional scheduling window) live here.
 * The iOS app fetches https://rrradio.org/highlights.json, caches the
 * last good copy, and resolves each `stationId` against its catalog; an
 * unknown id is silently dropped and an empty feed hides the rail. So
 * the featured set changes without an App Store release.
 *
 * Output schema (consumed by rrradio-ios `HighlightsResponse`):
 *
 *   {
 *     "version": "<content hash>",
 *     "highlights": [
 *       { "stationId": "builtin-grrif",
 *         "badge": { "label": "Station of the week", "accent": "#0f8a40" },
 *         "blurb": "Lausanne's indie outpost…",
 *         "startsOn": "2026-06-02", "endsOn": "2026-06-09" }
 *     ]
 *   }
 *
 * Only `stationId` and `badge.label` are required per entry. `accent`,
 * `blurb`, `startsOn`, and `endsOn` are omitted from the JSON when
 * absent (the client decoder treats them as optional).
 *
 * Build is deterministic — `version` is a content hash of the highlights
 * (or an explicit top-level `version:` in the YAML), never a timestamp —
 * so the committed artifact is reproducible and `npm run check-highlights`
 * can byte-compare it in CI.
 *
 *   npm run highlights        — regenerate public/highlights.json
 *   npm run check-highlights  — verify the committed JSON matches the YAML
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate + normalize the raw YAML document into the publishable
 * highlight rows. Pure: no file or network access, no timestamps.
 *
 * @param {unknown} rawDoc            parsed data/highlights.yaml
 * @param {Set<string>} publishedIds  ids present in public/stations.json
 * @returns {{ highlights: object[], errors: string[], warnings: string[] }}
 */
export function validateHighlights(rawDoc, publishedIds = new Set()) {
  const errors = [];
  const warnings = [];
  const highlights = [];

  const entries = Array.isArray(rawDoc) ? rawDoc : rawDoc?.highlights;
  if (!Array.isArray(entries)) {
    errors.push(
      'highlights.yaml: expected a list of highlights (or a map with a `highlights:` list)',
    );
    return { highlights, errors, warnings };
  }

  const seen = new Set();

  entries.forEach((entry, index) => {
    const where = `highlights[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${where}: not a mapping`);
      return;
    }

    // Accept either `station:` (the natural YAML key) or `stationId:`
    // (matching the JSON / iOS field name) so curators can't trip on it.
    const stationId = entry.station ?? entry.stationId;
    if (typeof stationId !== 'string' || stationId.trim() === '') {
      errors.push(`${where}: missing \`station\` (a catalog station id)`);
      return;
    }
    const id = stationId.trim();
    if (publishedIds.size > 0 && !publishedIds.has(id)) {
      errors.push(
        `${where}: station "${id}" is not a published catalog station ` +
          '(only working / stream-only / icy-only stations ship)',
      );
      return;
    }

    const badge = entry.badge;
    if (!badge || typeof badge !== 'object' || Array.isArray(badge)) {
      errors.push(`${where} (${id}): missing \`badge\` mapping`);
      return;
    }
    const label = badge.label;
    if (typeof label !== 'string' || label.trim() === '') {
      errors.push(`${where} (${id}): badge.label must be a non-empty string`);
      return;
    }
    const trimmedLabel = label.trim();

    const out = { stationId: id, badge: { label: trimmedLabel } };

    if (badge.accent !== undefined && badge.accent !== null) {
      if (typeof badge.accent !== 'string' || !HEX_RE.test(badge.accent.trim())) {
        errors.push(
          `${where} (${id}): badge.accent must be a #rrggbb hex color, got ${JSON.stringify(badge.accent)}`,
        );
        return;
      }
      out.badge.accent = badge.accent.trim().toLowerCase();
    }

    if (entry.blurb !== undefined && entry.blurb !== null) {
      if (typeof entry.blurb !== 'string') {
        errors.push(`${where} (${id}): blurb must be a string`);
        return;
      }
      const blurb = entry.blurb.trim();
      if (blurb !== '') out.blurb = blurb;
    }

    let startsOn;
    let endsOn;
    for (const key of ['startsOn', 'endsOn']) {
      const value = entry[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string' || !isValidIsoDate(value)) {
        errors.push(
          `${where} (${id}): ${key} must be a valid YYYY-MM-DD date, got ${JSON.stringify(value)}`,
        );
        return;
      }
      out[key] = value;
      if (key === 'startsOn') startsOn = value;
      else endsOn = value;
    }
    // ISO dates compare lexicographically == chronologically.
    if (startsOn && endsOn && startsOn > endsOn) {
      errors.push(`${where} (${id}): startsOn ${startsOn} is after endsOn ${endsOn}`);
      return;
    }

    // The client's `Identifiable` id is `stationId` + badge label; a
    // repeated pair would collapse in the rail's ForEach.
    const dedupeKey = `${id}\u0001${trimmedLabel}`;
    if (seen.has(dedupeKey)) {
      errors.push(`${where} (${id}): duplicate station + badge "${trimmedLabel}"`);
      return;
    }
    seen.add(dedupeKey);

    highlights.push(out);
  });

  return { highlights, errors, warnings };
}

/** True for a syntactically AND calendrically valid YYYY-MM-DD string. */
function isValidIsoDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * Build the full publishable payload from the raw YAML document.
 * Deterministic: `version` defaults to a content hash of the highlights.
 *
 * @returns {{ payload: object|null, errors: string[], warnings: string[] }}
 */
export function buildHighlightsPayload(rawDoc, publishedIds = new Set()) {
  const { highlights, errors, warnings } = validateHighlights(rawDoc, publishedIds);
  if (errors.length > 0) return { payload: null, errors, warnings };

  const explicitVersion =
    rawDoc && !Array.isArray(rawDoc) && typeof rawDoc.version === 'string'
      ? rawDoc.version.trim()
      : '';
  const version = explicitVersion || contentVersion(highlights);

  const payload = {
    $schema:
      'generated by tools/build-highlights.mjs from data/highlights.yaml — do not edit by hand',
    version,
    highlights,
  };
  return { payload, errors, warnings };
}

/** Stable 12-char hash of the highlight rows — a cache-busting signal. */
export function contentVersion(highlights) {
  return createHash('sha256').update(JSON.stringify(highlights)).digest('hex').slice(0, 12);
}

/** Canonical on-disk form: pretty JSON + trailing newline (matches stations.json). */
export function serializePayload(payload) {
  return JSON.stringify(payload, null, 2) + '\n';
}

// ─── CLI ────────────────────────────────────────────────────────────────
// Only runs when invoked directly (`node tools/build-highlights.mjs`),
// never when imported by the test or the checker.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const root = join(__dirname, '..');

  const fail = (msg) => {
    console.error(`build-highlights: ${msg}`);
    process.exit(1);
  };

  const highlightsDoc = parseYaml(readFileSync(join(root, 'data/highlights.yaml'), 'utf8'));

  let publishedIds = new Set();
  try {
    const catalog = JSON.parse(readFileSync(join(root, 'public/stations.json'), 'utf8'));
    const stations = Array.isArray(catalog) ? catalog : catalog.stations;
    if (Array.isArray(stations)) publishedIds = new Set(stations.map((s) => s.id));
  } catch {
    console.warn(
      'build-highlights: public/stations.json not found — skipping station-id validation (run `npm run catalog` first)',
    );
  }

  const { payload, errors } = buildHighlightsPayload(highlightsDoc, publishedIds);
  if (errors.length > 0) {
    for (const e of errors) console.error(`build-highlights: ${e}`);
    fail(`${errors.length} validation error(s) — nothing written`);
  }

  const outPath = join(root, 'public/highlights.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serializePayload(payload));
  console.log(
    `highlights: ${payload.highlights.length} featured station(s) → public/highlights.json (version ${payload.version})`,
  );
}
