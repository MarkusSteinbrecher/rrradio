import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  parseStationId,
  categoriesFromLabels,
  branchName,
  streamProbePassed,
  normaliseTags,
  buildPrTitle,
  buildPrBody,
  buildResearchComment,
  applyFixes,
} from './propose-station-fix.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);

describe('parseStationId', () => {
  it('reads the station-id marker P2 writes', () => {
    expect(parseStationId('<!-- rrradio:station-id=builtin-grrif -->\n\nbody')).toBe('builtin-grrif');
    expect(parseStationId('text\n<!-- rrradio:station-id=de.br-b1 -->')).toBe('de.br-b1');
  });
  it('returns null when absent', () => {
    expect(parseStationId('no marker here')).toBeNull();
    expect(parseStationId('')).toBeNull();
    expect(parseStationId(null)).toBeNull();
  });
  it('does not match a zero-width-space defused marker (injection guard)', () => {
    // P2 neutralizes reporter comments by inserting a ZWSP after `<!`.
    expect(parseStationId('<!​-- rrradio:station-id=evil -->')).toBeNull();
  });
});

describe('categoriesFromLabels', () => {
  it('keeps known categories, drops the umbrella + noise labels', () => {
    expect(categoriesFromLabels(['broken-station', 'no-audio', 'wrong-logo', 'enhancement'])).toEqual([
      'no-audio',
      'wrong-logo',
    ]);
  });
  it('dedups and tolerates empty', () => {
    expect(categoriesFromLabels(['no-audio', 'no-audio'])).toEqual(['no-audio']);
    expect(categoriesFromLabels([])).toEqual([]);
    expect(categoriesFromLabels(undefined)).toEqual([]);
  });
});

describe('branchName', () => {
  it('is a stable per-station bot branch', () => {
    expect(branchName('builtin-grrif')).toBe('bot/broken-fix/builtin-grrif');
  });
  it('sanitizes ids with odd characters', () => {
    expect(branchName('rb:abc/def 1')).toBe('bot/broken-fix/rb-abc-def-1');
  });
});

describe('streamProbePassed', () => {
  it('passes only on play-able verdicts', () => {
    expect(streamProbePassed('ok')).toBe(true);
    expect(streamProbePassed('ok-hls')).toBe(true);
    expect(streamProbePassed('needs-playlist')).toBe(true);
    expect(streamProbePassed('broken-format')).toBe(false);
    expect(streamProbePassed(null)).toBe(false);
  });
});

describe('normaliseTags', () => {
  it('splits, lowercases, dedups, and caps at 6', () => {
    expect(normaliseTags('Rock, Pop; rock,Jazz')).toEqual(['rock', 'pop', 'jazz']);
    expect(normaliseTags('')).toEqual([]);
    expect(normaliseTags(null)).toEqual([]);
  });
});

describe('buildPrTitle', () => {
  it('names the station and id', () => {
    expect(buildPrTitle('One FM', 'a-one')).toBe('Fix broken station: One FM (a-one)');
  });
});

const station = { id: 'a-one', name: 'One FM' };

describe('buildPrBody', () => {
  it('leads with Closes #N and lists each fix with evidence', () => {
    const body = buildPrBody(
      station,
      [
        { categories: ['no-audio'], action: 'stream-swap', url: 'https://x/s.aac', codec: 'AAC', bitrate: 128, evidence: 'dead → x probes ok' },
        { categories: ['wrong-logo'], action: 'favicon-clear', evidence: 'favicon 404' },
      ],
      [{ categories: ['wrong-info'], reason: 'needs human', evidence: 'RB diff' }],
      { issue: 42, generatedAt: '2026-06-13T00:00:00Z' },
    );
    expect(body).toMatch(/^Closes #42/);
    expect(body).toContain('swap dead stream → `https://x/s.aac` (AAC 128kbps)');
    expect(body).toContain('clear dead favicon');
    expect(body).toContain('## Needs human follow-up');
    expect(body).toContain('needs human');
  });
  it('adds the removed-label tip when a station is marked broken', () => {
    const body = buildPrBody(station, [{ categories: ['no-audio'], action: 'mark-broken', evidence: 'dead, no replacement' }], [], { issue: 7 });
    expect(body).toContain('status: broken');
    expect(body).toContain('resolved:removed');
  });
});

describe('buildResearchComment', () => {
  it('carries the idempotency marker and the findings', () => {
    const c = buildResearchComment(station, [
      { categories: ['no-audio'], reason: 'probes OK now', evidence: 'verdict ok', suggest: 'resolved:not-reproducible' },
    ]);
    expect(c).toMatch(/^<!-- rrradio:fix-bot -->/);
    expect(c).toContain('no confident automated fix');
    expect(c).toContain('probes OK now');
    expect(c).toContain('`resolved:not-reproducible`');
  });
});

// Integration: surgical edits against the REAL catalog must keep
// stations.json consistent with stations.yaml the way check-catalog
// verifies (publishable id-set + count). No disk writes. Parsing the
// 31k-row YAML is slow, so each case re-parses the edited YAML at most
// once and the block runs with a generous timeout.
describe('applyFixes (real catalog consistency)', () => {
  const yamlText = readFileSync(join(ROOT, 'data/stations.yaml'), 'utf8');
  const jsonPayload = JSON.parse(readFileSync(join(ROOT, 'public/stations.json'), 'utf8'));
  const yamlList = parseYaml(yamlText);
  const target = yamlList.find((s) => s && PUBLISHABLE.has(s.status) && s.streamUrl);
  const baselinePub = new Set(yamlList.filter((s) => s && PUBLISHABLE.has(s.status)).map((s) => s.id));

  const publishableIds = (text) =>
    new Set(parseYaml(text).filter((s) => s && PUBLISHABLE.has(s.status)).map((s) => s.id));
  const jsonIds = (payload) => new Set(payload.stations.map((s) => s.id));
  const sorted = (set) => [...set].sort();

  it('a stream-swap keeps both sides in sync (same ids, same count)', () => {
    const fix = [{ categories: ['no-audio'], action: 'stream-swap', url: 'https://example.test/replacement.aac', codec: 'AAC', bitrate: 128 }];
    const { yaml, json } = applyFixes(yamlText, jsonPayload, target.id, fix);
    expect(yaml).toContain('  streamUrl: https://example.test/replacement.aac');
    expect(json.stations.find((s) => s.id === target.id).streamUrl).toBe('https://example.test/replacement.aac');
    // check-catalog invariant: edited publishable YAML ids === JSON ids === baseline
    expect(sorted(publishableIds(yaml))).toEqual(sorted(jsonIds(json)));
    expect(sorted(jsonIds(json))).toEqual(sorted(baselinePub));
    expect(json.$schema).toBe(jsonPayload.$schema); // payload shape preserved
  }, 30000);

  it('a mark-broken removes the station from BOTH sides', () => {
    const fix = [{ categories: ['no-audio'], action: 'mark-broken' }];
    const { yaml, json } = applyFixes(yamlText, jsonPayload, target.id, fix);
    const editedPub = publishableIds(yaml);
    expect(editedPub.has(target.id)).toBe(false);
    expect(jsonIds(json).has(target.id)).toBe(false);
    expect(sorted(editedPub)).toEqual(sorted(jsonIds(json)));
    expect(json.stations.length).toBe(jsonPayload.stations.length - 1);
  }, 30000);

  it('does not mutate the caller-supplied payload', () => {
    const before = jsonPayload.stations.length;
    applyFixes(yamlText, jsonPayload, target.id, [{ categories: ['no-audio'], action: 'mark-broken' }]);
    expect(jsonPayload.stations.length).toBe(before);
  }, 30000);
});
