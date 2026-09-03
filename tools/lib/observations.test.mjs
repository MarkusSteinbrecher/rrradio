import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normaliseObservation,
  serialiseObservation,
  appendObservations,
  parseObservations,
  readObservations,
  observationPath,
  dayOf,
} from './observations.mjs';

const base = {
  id: 'de-dlf',
  at: '2026-09-04T05:12:03.456Z',
  v: 'gha',
  f: 'stream',
  o: 'bad',
  c: 'soft',
  s: null,
  ct: null,
  ms: 8004.4,
  d: 'timeout',
  icy: 'na',
  r: true,
};

describe('normaliseObservation', () => {
  it('fixes key order, trims sub-second precision, rounds ms', () => {
    const row = normaliseObservation(base);
    expect(Object.keys(row)).toEqual(['id', 'at', 'v', 'f', 'o', 'c', 's', 'ct', 'ms', 'd', 'icy', 'r']);
    expect(row.at).toBe('2026-09-04T05:12:03Z');
    expect(row.ms).toBe(8004);
  });

  it('drops the class on non-bad outcomes and lower-cases content-type', () => {
    const row = normaliseObservation({ ...base, o: 'ok', c: 'hard', s: 200, ct: 'Audio/MPEG', d: 'audio/mpeg' });
    expect(row.c).toBeNull();
    expect(row.ct).toBe('audio/mpeg');
    expect(row.s).toBe(200);
  });

  it('requires a class on bad outcomes', () => {
    expect(() => normaliseObservation({ ...base, c: null })).toThrow(/bad class/);
  });

  it('rejects unknown vantage / facet / outcome', () => {
    expect(() => normaliseObservation({ ...base, v: 'laptop' })).toThrow(/vantage/);
    expect(() => normaliseObservation({ ...base, f: 'homepage' })).toThrow(/facet/);
    expect(() => normaliseObservation({ ...base, o: 'meh' })).toThrow(/outcome/);
  });

  it('omits icy on non-stream facets and defaults it to na on stream rows', () => {
    const logo = normaliseObservation({ ...base, f: 'logo', icy: undefined });
    expect('icy' in logo).toBe(false);
    const stream = normaliseObservation({ ...base, icy: undefined });
    expect(stream.icy).toBe('na');
  });
});

describe('NDJSON round trip', () => {
  it('serialises one newline-terminated line and parses it back', () => {
    const line = serialiseObservation(base);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n').filter(Boolean)).toHaveLength(1);
    expect(parseObservations(line)[0]).toEqual(normaliseObservation(base));
  });

  it('parseObservations skips blank lines and names the bad line', () => {
    expect(parseObservations('\n\n')).toEqual([]);
    expect(() => parseObservations('{"id":"a"}\nnot json\n')).toThrow(/line 2/);
  });

  it('appendObservations creates directories and appends across calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obs-'));
    const path = observationPath(dir, '2026-09-04');
    appendObservations(path, [base]);
    appendObservations(path, [{ ...base, id: 'fr-fip', o: 'ok', c: null, s: 200, d: 'audio/aac' }]);
    appendObservations(path, []);
    const rows = parseObservations(readFileSync(path, 'utf8'));
    expect(rows.map((r) => r.id)).toEqual(['de-dlf', 'fr-fip']);
  });
});

describe('readObservations', () => {
  it('returns [] without an observations directory', () => {
    expect(readObservations(mkdtempSync(join(tmpdir(), 'obs-')))).toEqual([]);
  });

  it('reads day files in date order and honours sinceDay', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obs-'));
    mkdirSync(join(dir, 'observations'));
    writeFileSync(observationPath(dir, '2026-09-05'), serialiseObservation({ ...base, id: 'b' }));
    writeFileSync(observationPath(dir, '2026-09-03'), serialiseObservation({ ...base, id: 'a' }));
    writeFileSync(join(dir, 'observations', 'notes.txt'), 'ignored');
    expect(readObservations(dir).map((r) => r.id)).toEqual(['a', 'b']);
    expect(readObservations(dir, { sinceDay: '2026-09-04' }).map((r) => r.id)).toEqual(['b']);
  });
});

describe('dayOf', () => {
  it('is the UTC calendar day', () => {
    expect(dayOf('2026-09-04T23:59:59Z')).toBe('2026-09-04');
    expect(dayOf('2026-09-04T23:59:59-02:00')).toBe('2026-09-05');
  });
});
