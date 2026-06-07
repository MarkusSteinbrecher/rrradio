#!/usr/bin/env node
/**
 * Detects brand FAMILIES in the curated catalog (data/stations.yaml).
 *
 * A family is a set of regional / sub-brand siblings of ONE brand — e.g.
 * "Bayern 1 Oberbayern" + "Bayern 1 Franken" + "Bayern 1 Schwaben", or the many
 * "bigFM <genre>" channels. They are NOT duplicates: the redesign keeps them
 * DISTINCT but flags the family so the catalog's "many slightly-renamed entries"
 * read as one coherent group in the admin/tracker UI rather than noise.
 *
 * This is the FAMILY level of the shared dedupe identity model (FEED → FAMILY →
 * DISTINCT); the FEED level lives in check-duplicates.mjs / dedupe-raw.mjs. All
 * three share tools/lib/{station-name-signature,dedupe-normalize,station-family}.
 *
 *   npm run detect-families
 *
 * Read-only on the YAML. Writes public/station-families.json for the dashboard.
 * Always exits 0 — families are informational, never a gate.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { detectFamilies } from './lib/station-family.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIONS_YAML = join(ROOT, 'data', 'stations.yaml');
const OUTPUT_JSON = join(ROOT, 'public', 'station-families.json');

const stations = YAML.parse(readFileSync(STATIONS_YAML, 'utf8'));
if (!Array.isArray(stations)) {
  console.error('detect-families: data/stations.yaml did not parse as a list');
  process.exit(1);
}

const PUBLISHABLE = new Set(['working', 'icy-only', 'stream-only']);
const candidates = stations.filter((s) => PUBLISHABLE.has(s.status));
console.log(
  `detect-families: scanning ${candidates.length} publishable station(s) ` +
    `(of ${stations.length} total in YAML)…`,
);

const detected = detectFamilies(candidates);

const families = detected
  .map((f) => {
    const [country, host] = f.bucket.split('|');
    return {
      id: f.id,
      country,
      host,
      core: f.core,
      size: f.members.length,
      members: f.members
        .map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          stationuuid: s.stationuuid ?? null,
          streamUrl: s.streamUrl,
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    };
  })
  .sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));

const memberCount = families.reduce((n, f) => n + f.size, 0);
const byCountry = {};
for (const f of families) byCountry[f.country] = (byCountry[f.country] ?? 0) + 1;

const summary = {
  generatedAt: new Date().toISOString(),
  totalScanned: candidates.length,
  familyCount: families.length,
  memberCount,
  byCountry,
  families,
};

mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2) + '\n', 'utf8');

console.log(
  `detect-families: ${families.length} family(ies), ${memberCount} station(s) in a family`,
);
for (const f of families.slice(0, 15)) {
  console.log(`  [${String(f.size).padStart(3)}] ${f.country} «${f.core}» (${f.host})`);
}
if (families.length > 15) console.log(`  … and ${families.length - 15} more`);
console.log(`Report written to ${OUTPUT_JSON.replace(ROOT + '/', '')}`);
