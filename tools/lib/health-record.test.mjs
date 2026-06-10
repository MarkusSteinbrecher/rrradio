import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyRecord,
  applyFacet,
  pruneStations,
  loadHealth,
  saveHealth,
  serialiseHealth,
  HEALTH_PATH,
} from './health-record.mjs';

const AT = '2026-06-10T07:00:00.000Z';
const LATER = '2026-06-17T07:00:00.000Z';
const META = { tool: 'test', at: AT };

describe('applyFacet', () => {
  it('records a new verdict with the run date as transition date', () => {
    const rec = emptyRecord();
    const res = applyFacet(rec, 'stream', { 'de-dlf': { v: 'ok', d: 'audio/mpeg' } }, META);
    expect(rec.stations['de-dlf'].stream).toEqual({ v: 'ok', since: '2026-06-10', d: 'audio/mpeg' });
    expect(res).toEqual({ checked: 1, transitions: 1, tally: { ok: 1, warn: 0, bad: 0, na: 0 } });
  });

  it('keeps `since` when the verdict and detail are unchanged on a later run', () => {
    const rec = emptyRecord();
    applyFacet(rec, 'stream', { 'de-dlf': { v: 'ok', d: 'audio/mpeg' } }, META);
    const res = applyFacet(rec, 'stream', { 'de-dlf': { v: 'ok', d: 'audio/mpeg' } }, { tool: 'test', at: LATER });
    expect(rec.stations['de-dlf'].stream.since).toBe('2026-06-10');
    expect(res.transitions).toBe(0);
    // …but the run header still moves: "last checked" lives there.
    expect(rec.runs.stream.lastRun).toBe(LATER);
  });

  it('bumps `since` on a verdict transition', () => {
    const rec = emptyRecord();
    applyFacet(rec, 'stream', { 'de-dlf': { v: 'ok' } }, META);
    applyFacet(rec, 'stream', { 'de-dlf': { v: 'bad', d: 'HTTP 404' } }, { tool: 'test', at: LATER });
    expect(rec.stations['de-dlf'].stream).toEqual({ v: 'bad', since: '2026-06-17', d: 'HTTP 404' });
  });

  it('bumps `since` when only the detail changes', () => {
    const rec = emptyRecord();
    applyFacet(rec, 'homepage', { 'de-dlf': { v: 'bad', d: 'HTTP 404' } }, META);
    applyFacet(rec, 'homepage', { 'de-dlf': { v: 'bad', d: 'HTTP 410' } }, { tool: 'test', at: LATER });
    expect(rec.stations['de-dlf'].homepage.since).toBe('2026-06-17');
  });

  it('leaves stations outside a scoped run untouched', () => {
    const rec = emptyRecord();
    applyFacet(rec, 'stream', { 'de-dlf': { v: 'ok' }, 'fr-fip': { v: 'ok' } }, META);
    applyFacet(rec, 'stream', { 'de-dlf': { v: 'bad' } }, { tool: 'test', at: LATER, scope: 'cc:DE' });
    expect(rec.stations['fr-fip'].stream.v).toBe('ok');
    expect(rec.runs.stream.scope).toBe('cc:DE');
  });

  it('rejects unknown facets and verdicts', () => {
    const rec = emptyRecord();
    expect(() => applyFacet(rec, 'vibes', {}, META)).toThrow(/unknown facet/);
    expect(() => applyFacet(rec, 'stream', { x: { v: 'meh' } }, META)).toThrow(/invalid verdict/);
  });
});

describe('pruneStations', () => {
  it('removes stations that left the catalog', () => {
    const rec = emptyRecord();
    applyFacet(rec, 'stream', { keep: { v: 'ok' }, gone: { v: 'bad' } }, META);
    expect(pruneStations(rec, new Set(['keep']))).toBe(1);
    expect(rec.stations.gone).toBeUndefined();
    expect(rec.stations.keep).toBeDefined();
  });
});

describe('serialisation', () => {
  it('round-trips through save + load', () => {
    const root = mkdtempSync(join(tmpdir(), 'health-'));
    const rec = emptyRecord();
    applyFacet(rec, 'stream', { b: { v: 'ok' }, a: { v: 'bad', d: 'HTTP 500' } }, META);
    applyFacet(rec, 'logo', { a: { v: 'warn', d: 'generic favicon' } }, META);
    saveHealth(root, rec);
    const loaded = loadHealth(root);
    expect(loaded).toEqual(rec);
  });

  it('writes one sorted station per line (stable git diffs)', () => {
    const rec = emptyRecord();
    applyFacet(rec, 'stream', { zz: { v: 'ok' }, aa: { v: 'ok' } }, META);
    const text = serialiseHealth(rec);
    const lines = text.split('\n');
    const aa = lines.findIndex((l) => l.startsWith('"aa":'));
    const zz = lines.findIndex((l) => l.startsWith('"zz":'));
    expect(aa).toBeGreaterThan(-1);
    expect(zz).toBe(aa + 1);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('returns an empty record when the file does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'health-'));
    expect(loadHealth(root)).toEqual(emptyRecord());
  });

  it('refuses an unrecognised shape instead of silently rebuilding', () => {
    const root = mkdtempSync(join(tmpdir(), 'health-'));
    mkdirSync(join(root, 'public'), { recursive: true });
    writeFileSync(join(root, HEALTH_PATH), '{"version": 99}');
    expect(() => loadHealth(root)).toThrow(/unrecognised shape/);
  });

  it('orders facet keys canonically regardless of apply order', () => {
    const rec = emptyRecord();
    applyFacet(rec, 'duplicate', { a: { v: 'ok' } }, META);
    applyFacet(rec, 'stream', { a: { v: 'ok' } }, META);
    const row = serialiseHealth(rec).split('\n').find((l) => l.startsWith('"a":'));
    expect(row.indexOf('stream')).toBeLessThan(row.indexOf('duplicate'));
  });
});
