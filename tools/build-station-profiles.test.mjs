import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'data', 'station-profiles');
const OUT = join(root, 'public', 'station-profiles.json');

const yamlFiles = readdirSync(SRC).filter((f) => f.endsWith('.yaml') && !f.startsWith('_'));
const sources = yamlFiles.map((f) => ({ f, p: parseYaml(readFileSync(join(SRC, f), 'utf8')) }));

describe('station profiles', () => {
  it('every YAML has a required id+name and id matches filename', () => {
    for (const { f, p } of sources) {
      expect(p?.id, `${f}: id`).toBeTruthy();
      expect(`${p.id}.yaml`, `${f}: id↔filename`).toBe(f);
      expect(p?.identity?.name, `${f}: identity.name`).toBeTruthy();
    }
  });

  it('ids are unique', () => {
    const ids = sources.map((s) => s.p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('any declared streams are https', () => {
    for (const { f, p } of sources) {
      for (const s of p.streams ?? []) {
        if (s.url) expect(s.url, `${f}: ${s.url}`).toMatch(/^https:\/\//);
      }
    }
  });

  it('compiled public/station-profiles.json is in sync with the YAML (run `npm run station-profiles`)', () => {
    const built = JSON.parse(readFileSync(OUT, 'utf8'));
    expect(built.count).toBe(sources.length);
    const builtIds = new Set(built.profiles.map((p) => p.id));
    for (const { p } of sources) expect(builtIds.has(p.id), `missing ${p.id} in compiled JSON`).toBe(true);
  });
});
