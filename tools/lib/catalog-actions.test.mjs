import { describe, it, expect } from 'vitest';
import {
  BOT,
  BROKEN_FIELDS,
  yamlOrderOf,
  insertIndex,
  applyUnpublish,
  applyRepublish,
  applySwapUrl,
  applyActions,
  renderSummary,
} from './catalog-actions.mjs';

const DAY = '2026-09-06';

// Real file shape: one pair per line, RB-import comments *between* rows
// (they belong to the preceding block in the line walk), quoted and
// unquoted dates, a trailing comment inside a block, a curator-set broken
// row (e-five) and a bot-unpublished one (d-four).
const YAML = `# rrradio station catalog — fixture

- id: a-one
  broadcaster: independent
  name: One FM
  streamUrl: https://a.example/one.mp3
  codec: MP3
  status: working
  # trailing comment about a-one

# Auto-imported from Radio Browser (2026-05-04)
- id: b-two
  tags: [pop, rock]
  broadcaster: independent
  name: Two FM
  streamUrl: https://b.example/two
  bitrate: 128
  codec: AAC
  country: BR
  status: stream-only
  stationuuid: 0000-b
  reviewedAt: "2026-05-04"

# Auto-imported from Radio Browser (2026-05-04)
- id: c-three
  broadcaster: independent
  name: Three FM
  streamUrl: https://c.example/three
  status: stream-only
  reviewedAt: 2026-05-04
- id: d-four
  broadcaster: independent
  name: Four FM
  streamUrl: https://d.example/four
  status: broken
  brokenSince: 2026-09-01
  brokenFrom: stream-only
  brokenBy: station-probe
  brokenReason: HTTP 404 ×3 · 2026-08-30→2026-09-01
- id: e-five
  broadcaster: independent
  name: Five FM
  streamUrl: https://e.example/five
  status: broken
  notes: curator set this
- id: f-six
  broadcaster: independent
  name: Six FM
  streamUrl: https://f.example/six
  status: stream-only
`;

const D_FOUR_SNAPSHOT = { id: 'd-four', name: 'Four FM', streamUrl: 'https://d.example/four', status: 'stream-only' };

function stations() {
  return [
    { id: 'a-one', name: 'One FM', streamUrl: 'https://a.example/one.mp3', codec: 'MP3', status: 'working' },
    { id: 'b-two', name: 'Two FM', streamUrl: 'https://b.example/two', codec: 'AAC', status: 'stream-only', stationuuid: '0000-b' },
    { id: 'c-three', name: 'Three FM', streamUrl: 'https://c.example/three', status: 'stream-only' },
    { id: 'f-six', name: 'Six FM', streamUrl: 'https://f.example/six', status: 'stream-only' },
  ];
}
const ids = (list) => list.map((s) => s.id);

/** The fixture with one station's block swapped for `block` (no trailing newline). */
function withBlock(id, block) {
  const start = YAML.indexOf(`\n- id: ${id}\n`) + 1;
  const nextAt = YAML.indexOf('\n- id: ', start + 1);
  const end = nextAt < 0 ? YAML.length : nextAt;
  return YAML.slice(0, start) + block + YAML.slice(end);
}

describe('yamlOrderOf / insertIndex', () => {
  it('lists ids in file order', () => {
    expect(yamlOrderOf(YAML)).toEqual(['a-one', 'b-two', 'c-three', 'd-four', 'e-five', 'f-six']);
  });

  it('inserts after the nearest preceding id that is still published', () => {
    const order = ['a', 'c', 'd', 'b'];
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(insertIndex(order, list, 'd')).toBe(1); // skips the absent `c`
    expect(insertIndex(order, list, 'c')).toBe(1);
  });

  it('appends when nothing precedes it or the id is unknown to the YAML', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(insertIndex(['d', 'a', 'b'], list, 'd')).toBe(2);
    expect(insertIndex(['a', 'b'], list, 'zzz')).toBe(2);
  });
});

describe('applyUnpublish', () => {
  const action = { id: 'b-two', action: 'unpublish', auto: true, reason: 'HTTP 404 ×3 · 2026-09-04→2026-09-06' };

  it('flips the YAML row, writes the lifecycle fields in order and leaves neighbours alone', () => {
    const r = applyUnpublish({ yamlText: YAML, stations: stations(), action, day: DAY });
    const expected = withBlock(
      'b-two',
      [
        '- id: b-two',
        `  brokenSince: ${DAY}`,
        '  brokenFrom: stream-only',
        `  brokenBy: ${BOT}`,
        '  brokenReason: HTTP 404 ×3 · 2026-09-04→2026-09-06',
        '  tags: [pop, rock]',
        '  broadcaster: independent',
        '  name: Two FM',
        '  streamUrl: https://b.example/two',
        '  bitrate: 128',
        '  codec: AAC',
        '  country: BR',
        '  status: broken',
        '  stationuuid: 0000-b',
        '  reviewedAt: "2026-05-04"',
        '',
        '# Auto-imported from Radio Browser (2026-05-04)',
      ].join('\n'),
    );
    expect(r.yamlText).toBe(expected);
    expect(ids(r.stations)).toEqual(['a-one', 'c-three', 'f-six']);
    expect(r.snapshot).toEqual(stations()[1]);
  });

  it('records the previous status in brokenFrom', () => {
    const r = applyUnpublish({ yamlText: YAML, stations: stations(), action: { id: 'a-one', reason: 'x' }, day: DAY });
    expect(r.yamlText).toContain('- id: a-one\n  brokenSince: 2026-09-06\n  brokenFrom: working\n');
    expect(r.yamlText).toContain('  status: broken\n  # trailing comment about a-one');
  });

  it('refuses an id the YAML does not know', () => {
    expect(() => applyUnpublish({ yamlText: YAML, stations: stations(), action: { id: 'nope' }, day: DAY })).toThrow(/not in data\/stations.yaml/);
  });

  it('refuses rows that are already broken — bot-set or curator-set', () => {
    expect(() => applyUnpublish({ yamlText: YAML, stations: stations(), action: { id: 'd-four' }, day: DAY })).toThrow(/already broken \(brokenBy: station-probe\)/);
    expect(() => applyUnpublish({ yamlText: YAML, stations: stations(), action: { id: 'e-five' }, day: DAY })).toThrow(/already broken \(curator-set\)/);
  });

  it('refuses a publishable row that is not in the JSON (fold member) without touching the YAML', () => {
    const list = stations().filter((s) => s.id !== 'f-six');
    expect(() => applyUnpublish({ yamlText: YAML, stations: list, action: { id: 'f-six' }, day: DAY })).toThrow(/not in public\/stations.json/);
  });

  it('refuses a malformed day and an unsafe id', () => {
    expect(() => applyUnpublish({ yamlText: YAML, stations: stations(), action: { id: 'b-two' }, day: '6 Sep' })).toThrow(/YYYY-MM-DD/);
    expect(() => applyUnpublish({ yamlText: YAML, stations: stations(), action: { id: '../etc' }, day: DAY })).toThrow(/unsafe station id/);
  });
});

describe('applyRepublish', () => {
  const order = yamlOrderOf(YAML);
  const action = { id: 'd-four', action: 'republish', auto: true, to: 'stream-only' };

  it('restores brokenFrom, drops the lifecycle fields and re-inserts the snapshot after its YAML neighbour', () => {
    const r = applyRepublish({ yamlText: YAML, yamlOrder: order, stations: stations(), action, snapshot: D_FOUR_SNAPSHOT });
    const expected = withBlock(
      'd-four',
      ['- id: d-four', '  broadcaster: independent', '  name: Four FM', '  streamUrl: https://d.example/four', '  status: stream-only'].join('\n'),
    );
    expect(r.yamlText).toBe(expected);
    for (const f of BROKEN_FIELDS) expect(r.yamlText).not.toContain(`  ${f}:`);
    expect(ids(r.stations)).toEqual(['a-one', 'b-two', 'c-three', 'd-four', 'f-six']);
    expect(r.stations[3]).toBe(D_FOUR_SNAPSHOT); // status already matches — same object
  });

  it('forces the snapshot status to brokenFrom when they disagree', () => {
    const snapshot = { ...D_FOUR_SNAPSHOT, status: 'working' };
    const r = applyRepublish({ yamlText: YAML, yamlOrder: order, stations: stations(), action, snapshot });
    expect(r.stations[3].status).toBe('stream-only');
  });

  it('appends when no preceding YAML neighbour is published', () => {
    const list = stations().filter((s) => s.id === 'f-six');
    const r = applyRepublish({ yamlText: YAML, yamlOrder: order, stations: list, action, snapshot: D_FOUR_SNAPSHOT });
    expect(ids(r.stations)).toEqual(['f-six', 'd-four']);
  });

  it('refuses a row the bot does not own', () => {
    expect(() => applyRepublish({ yamlText: YAML, yamlOrder: order, stations: stations(), action: { id: 'e-five' }, snapshot: { id: 'e-five' } })).toThrow(/not bot-managed/);
    const curator = YAML.replace('  brokenBy: station-probe', '  brokenBy: markus');
    expect(() => applyRepublish({ yamlText: curator, yamlOrder: order, stations: stations(), action, snapshot: D_FOUR_SNAPSHOT })).toThrow(/brokenBy is markus/);
  });

  it('refuses without a snapshot, with a foreign snapshot, or when already published', () => {
    expect(() => applyRepublish({ yamlText: YAML, yamlOrder: order, stations: stations(), action, snapshot: undefined })).toThrow(/no snapshot/);
    expect(() => applyRepublish({ yamlText: YAML, yamlOrder: order, stations: stations(), action, snapshot: { id: 'b-two' } })).toThrow(/no snapshot/);
    const list = [...stations(), D_FOUR_SNAPSHOT];
    expect(() => applyRepublish({ yamlText: YAML, yamlOrder: order, stations: list, action, snapshot: D_FOUR_SNAPSHOT })).toThrow(/already in public/);
  });

  it('refuses when brokenFrom is missing and the action carries no publishable `to`', () => {
    const noFrom = YAML.replace('  brokenFrom: stream-only\n', '');
    expect(() => applyRepublish({ yamlText: noFrom, yamlOrder: order, stations: stations(), action: { id: 'd-four' }, snapshot: D_FOUR_SNAPSHOT })).toThrow(/not a publishable status/);
    const r = applyRepublish({ yamlText: noFrom, yamlOrder: order, stations: stations(), action, snapshot: D_FOUR_SNAPSHOT });
    expect(r.yamlText).toContain('- id: d-four\n  broadcaster: independent\n  name: Four FM\n  streamUrl: https://d.example/four\n  status: stream-only\n');
  });
});

describe('applySwapUrl', () => {
  const action = { id: 'b-two', action: 'swap-url', auto: true, newUrl: 'https://b.example/new.mp3', newCodec: 'MP3' };

  it('rewrites streamUrl and codec in both files', () => {
    const list = stations();
    const r = applySwapUrl({ yamlText: YAML, stations: list, action });
    expect(r.yamlText).toContain('  streamUrl: https://b.example/new.mp3\n  bitrate: 128\n  codec: MP3\n');
    expect(r.yamlText).not.toContain('https://b.example/two');
    expect(r.yamlText).toContain('  streamUrl: https://c.example/three'); // neighbour intact
    expect(list[1]).toMatchObject({ streamUrl: 'https://b.example/new.mp3', codec: 'MP3' });
  });

  it('keeps streams[0].url in step on variant rows', () => {
    const list = stations();
    list[1].streams = [
      { url: 'https://b.example/two', codec: 'AAC', tier: 'best' },
      { url: 'https://b.example/two-lo', codec: 'AAC', tier: 'low' },
    ];
    applySwapUrl({ yamlText: YAML, stations: list, action });
    expect(list[1].streams[0]).toEqual({ url: 'https://b.example/new.mp3', codec: 'MP3', tier: 'best' });
    expect(list[1].streams[1].url).toBe('https://b.example/two-lo');
  });

  it('refuses http URLs, unknown rows and a no-op swap', () => {
    expect(() => applySwapUrl({ yamlText: YAML, stations: stations(), action: { ...action, newUrl: 'http://b.example/x' } })).toThrow(/must be https/);
    expect(() => applySwapUrl({ yamlText: YAML, stations: stations(), action: { ...action, id: 'd-four' } })).toThrow(/not in public/);
    expect(() => applySwapUrl({ yamlText: YAML, stations: stations(), action: { ...action, newUrl: 'https://b.example/two' } })).toThrow(/already on that URL/);
  });
});

describe('applyActions', () => {
  const actions = [
    { id: 'b-two', action: 'unpublish', auto: true, tier: 'long-tail', from: 'stream-only', reason: 'HTTP 404 ×3' },
    { id: 'd-four', action: 'republish', auto: true, tier: 'unpublished', to: 'stream-only', reason: 'ok ×3' },
    { id: 'c-three', action: 'review', auto: false, tier: 'curated', proposed: 'unpublish', edge: { o: 'bad', d: 'timeout' }, reason: 'timeout ×5' },
    { id: 'f-six', action: 'review', auto: false, tier: 'curated', proposed: 'swap-url', newUrl: 'https://f.example/new', reason: 'RB url_resolved differs' },
  ];
  const snapshots = { 'd-four': D_FOUR_SNAPSHOT };

  it('mode auto takes only auto: true actions', () => {
    const r = applyActions({ yamlText: YAML, stations: stations(), actions, snapshots, day: DAY, mode: 'auto' });
    expect(r.errors).toEqual([]);
    expect(r.applied.map((a) => [a.id, a.action, a.proposed])).toEqual([
      ['b-two', 'unpublish', false],
      ['d-four', 'republish', false],
    ]);
    expect(Object.keys(r.snapshotsWritten)).toEqual(['b-two']);
    expect(r.snapshotsDeleted).toEqual(['d-four']);
    expect(ids(r.stations)).toEqual(['a-one', 'c-three', 'd-four', 'f-six']);
    expect(r.yamlText).toContain('- id: c-three\n  broadcaster: independent\n  name: Three FM\n  streamUrl: https://c.example/three\n  status: stream-only\n');
  });

  it('mode review materialises the proposals and only those', () => {
    const r = applyActions({ yamlText: YAML, stations: stations(), actions, snapshots, day: DAY, mode: 'review' });
    expect(r.errors).toEqual([]);
    expect(r.applied.map((a) => [a.id, a.action, a.proposed])).toEqual([
      ['c-three', 'unpublish', true],
      ['f-six', 'swap-url', true],
    ]);
    expect(r.applied[0]).toMatchObject({ name: 'Three FM', streamUrl: 'https://c.example/three', edge: { o: 'bad', d: 'timeout' } });
    expect(r.applied[1]).toMatchObject({ streamUrl: 'https://f.example/six', newUrl: 'https://f.example/new' });
    expect(ids(r.stations)).toEqual(['a-one', 'b-two', 'f-six']);
    expect(r.yamlText).toContain('- id: b-two\n  tags: [pop, rock]'); // auto action not applied here
  });

  it('records a failing action and carries on with the rest', () => {
    const bad = [
      { id: 'nope', action: 'unpublish', auto: true, reason: 'x' },
      { id: 'd-four', action: 'republish', auto: true, reason: 'no snapshot this time' },
      { id: 'a-one', action: 'frobnicate', auto: true },
      ...actions.slice(0, 1),
    ];
    const r = applyActions({ yamlText: YAML, stations: stations(), actions: bad, snapshots: {}, day: DAY, mode: 'auto' });
    expect(r.errors.map((e) => e.id)).toEqual(['nope', 'd-four', 'a-one']);
    expect(r.errors[1].message).toMatch(/no snapshot/);
    expect(r.errors[2].message).toMatch(/unknown action "frobnicate"/);
    expect(r.applied.map((a) => a.id)).toEqual(['b-two']);
  });

  it('is idempotent: re-applying an unpublish is a skipped error, not a corruption', () => {
    const first = applyActions({ yamlText: YAML, stations: stations(), actions: actions.slice(0, 1), day: DAY, mode: 'auto' });
    const second = applyActions({ yamlText: first.yamlText, stations: first.stations, actions: actions.slice(0, 1), day: DAY, mode: 'auto' });
    expect(second.applied).toEqual([]);
    expect(second.errors).toEqual([{ id: 'b-two', action: 'unpublish', message: 'already broken (brokenBy: station-probe)' }]);
    expect(second.yamlText).toBe(first.yamlText);
    expect(ids(second.stations)).toEqual(ids(first.stations));
    expect(second.snapshotsWritten).toEqual({});
  });

  it('round-trips: unpublish then republish restores both files byte for byte', () => {
    const down = applyActions({ yamlText: YAML, stations: stations(), actions: actions.slice(0, 1), day: DAY, mode: 'auto' });
    const up = applyActions({
      yamlText: down.yamlText,
      stations: down.stations,
      actions: [{ id: 'b-two', action: 'republish', auto: true, reason: 'ok ×3' }],
      snapshots: down.snapshotsWritten,
      day: '2026-09-12',
      mode: 'auto',
    });
    expect(up.errors).toEqual([]);
    expect(up.yamlText).toBe(YAML);
    expect(up.stations).toEqual(stations());
    expect(up.snapshotsDeleted).toEqual(['b-two']);
  });

  it('rejects an unknown mode', () => {
    expect(() => applyActions({ yamlText: YAML, stations: stations(), actions, day: DAY, mode: 'yolo' })).toThrow(/mode must be/);
  });
});

describe('renderSummary', () => {
  const countable = (md) => md.split('\n').filter((l) => l.startsWith('- `'));

  it('writes a one-line body when there is nothing to do', () => {
    expect(renderSummary({ applied: [], errors: [], mode: 'auto', day: DAY })).toBe(`Nothing to do — no automatic actions for ${DAY}.\n`);
    expect(renderSummary({ applied: [], errors: [], mode: 'review', day: DAY })).toMatch(/^Nothing to do — no review proposals/);
  });

  it('auto: counts, one countable line per action, skipped lines not countable', () => {
    const r = applyActions({
      yamlText: YAML,
      stations: stations(),
      actions: [
        { id: 'b-two', action: 'unpublish', auto: true, reason: 'HTTP 404 ×3 · 2026-09-04→2026-09-06' },
        { id: 'd-four', action: 'republish', auto: true, reason: 'ok ×3' },
        { id: 'e-five', action: 'unpublish', auto: true, reason: 'x' },
      ],
      snapshots: { 'd-four': D_FOUR_SNAPSHOT },
      day: DAY,
      mode: 'auto',
    });
    const md = renderSummary({ ...r, mode: 'auto', day: DAY });
    expect(md).toContain(`## Catalog actions · ${DAY}`);
    expect(md).toContain('unpublish 1 · republish 1 · swap-url 0 · skipped 1');
    expect(countable(md)).toEqual([
      '- `b-two` · Two FM · unpublish · HTTP 404 ×3 · 2026-09-04→2026-09-06',
      '- `d-four` · Four FM · republish · ok ×3',
    ]);
    expect(md).toContain('### Skipped (1)');
    expect(md).toContain('- skipped `e-five` · unpublish · already broken (curator-set)');
    expect(md).not.toContain('What to check');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('review: adds a what-to-check line per proposal that the counter ignores', () => {
    const r = applyActions({
      yamlText: YAML,
      stations: stations(),
      actions: [
        { id: 'c-three', action: 'review', auto: false, proposed: 'unpublish', edge: { o: 'bad', d: 'timeout' }, reason: 'timeout ×5' },
        { id: 'b-two', action: 'review', auto: false, proposed: 'swap-url', newUrl: 'https://b.example/new', reason: 'RB differs' },
      ],
      day: DAY,
      mode: 'review',
    });
    const md = renderSummary({ ...r, mode: 'review', day: DAY });
    expect(md).toContain(`## Catalog review · ${DAY}`);
    expect(countable(md)).toHaveLength(2);
    const lines = md.split('\n');
    const i = lines.indexOf('- `c-three` · Three FM · unpublish · timeout ×5');
    expect(lines[i + 1]).toMatch(/^  - What to check: open https:\/\/c.example\/three in a player; edge says bad · timeout; look at the Radio Browser record/);
    const j = lines.indexOf('- `b-two` · Two FM · swap-url · RB differs');
    expect(lines[j + 1]).toMatch(/play the new URL https:\/\/b.example\/new and the old one https:\/\/b.example\/two/);
    expect(lines[j + 1]).toContain('stationuuid 0000-b');
  });
});
