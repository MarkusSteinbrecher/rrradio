import { describe, expect, it } from 'vitest';
import {
  faviconUrl,
  streamProbeFailed,
  faviconProbeFailed,
  decideConfirm,
  aggregate,
  sanitizeComment,
  stationMarker,
  buildIssueTitle,
  buildIssueBody,
  issueLabels,
  findIssueForStation,
  planStation,
  parseHeldMarker,
  heldMarker,
  partitionHeldRows,
  newlyHeld,
  buildDigestBody,
  buildDigestComment,
} from './triage-reports.mjs';

// The exact marker regex the resolve-reports.yml workflow greps with.
// Kept in lockstep here so the injection test proves the real defense.
const WORKFLOW_MARKER_RE = /<!-- rrradio:station-id=([A-Za-z0-9._:-]+) -->/g;

function row(over = {}) {
  return {
    id: over.id ?? 'r' + Math.random().toString(36).slice(2),
    stationId: 'builtin-fm4',
    stationName: 'FM4',
    streamHost: 'stream.fm4.example',
    category: 'no-audio',
    comment: '',
    status: 'received',
    githubIssue: null,
    ...over,
  };
}

describe('faviconUrl', () => {
  it('passes absolute http(s) through', () => {
    expect(faviconUrl('https://oe1.orf.at/x.png')).toBe('https://oe1.orf.at/x.png');
  });
  it('hangs relative paths off rrradio.org', () => {
    expect(faviconUrl('stations/grrif.png')).toBe('https://rrradio.org/stations/grrif.png');
    expect(faviconUrl('/stations/grrif.png')).toBe('https://rrradio.org/stations/grrif.png');
  });
  it('returns null for empty/missing', () => {
    expect(faviconUrl('')).toBeNull();
    expect(faviconUrl(undefined)).toBeNull();
  });
});

describe('streamProbeFailed', () => {
  it('treats a thrown connection as down', () => {
    expect(streamProbeFailed({ verdict: null, errored: true })).toBe(true);
  });
  it('treats null verdict (redirect/mixed-content) as inconclusive, not down', () => {
    expect(streamProbeFailed({ verdict: null, errored: false })).toBe(false);
  });
  it('passes ok / ok-hls / needs-playlist', () => {
    for (const v of ['ok', 'ok-hls', 'needs-playlist']) {
      expect(streamProbeFailed({ verdict: v, errored: false })).toBe(false);
    }
  });
  it('does not auto-confirm on parser-quirk', () => {
    expect(streamProbeFailed({ verdict: 'probe-inconclusive', errored: false })).toBe(false);
  });
  it('treats broken-* verdicts as down', () => {
    for (const v of ['broken-4xx', 'broken-5xx', 'broken-dns', 'broken-format', 'broken-tls']) {
      expect(streamProbeFailed({ verdict: v, errored: false })).toBe(true);
    }
  });
});

describe('faviconProbeFailed', () => {
  it('fails on 404 or network error, passes otherwise', () => {
    expect(faviconProbeFailed({ status: 404, errored: false })).toBe(true);
    expect(faviconProbeFailed({ status: 0, errored: true })).toBe(true);
    expect(faviconProbeFailed({ status: 200, errored: false })).toBe(false);
    // A present-but-maybe-wrong favicon (403/500) is not auto-confirmed.
    expect(faviconProbeFailed({ status: 403, errored: false })).toBe(false);
  });
});

describe('decideConfirm', () => {
  it('confirms on probe failure regardless of count', () => {
    expect(decideConfirm({ probeFailed: true, count: 1, threshold: 3 })).toBe(true);
  });
  it('confirms when count reaches threshold', () => {
    expect(decideConfirm({ probeFailed: false, count: 3, threshold: 3 })).toBe(true);
    expect(decideConfirm({ probeFailed: false, count: 2, threshold: 3 })).toBe(false);
  });
});

describe('aggregate', () => {
  it('groups by station then category, dropping resolved rows', () => {
    const stations = aggregate([
      row({ category: 'no-audio', comment: 'silent', status: 'received' }),
      row({ category: 'no-audio', comment: 'still dead', status: 'confirmed' }),
      row({ category: 'wrong-logo', status: 'received' }),
      row({ stationId: 'swr3', stationName: 'SWR3', category: 'no-audio' }),
      row({ category: 'no-audio', status: 'resolved' }), // dropped
    ]);
    expect([...stations.keys()].sort()).toEqual(['builtin-fm4', 'swr3']);
    const fm4 = stations.get('builtin-fm4');
    const audio = fm4.categories.get('no-audio');
    expect(audio.count).toBe(2);
    expect(audio.receivedCount).toBe(1);
    expect(audio.confirmedCount).toBe(1);
    expect(audio.comments).toEqual(['silent', 'still dead']);
    expect(fm4.categories.get('wrong-logo').count).toBe(1);
  });

  it('picks up a linked github issue from any row', () => {
    const stations = aggregate([row(), row({ githubIssue: 712 })]);
    expect(stations.get('builtin-fm4').githubIssue).toBe(712);
  });
});

describe('sanitizeComment', () => {
  it('caps at 500 chars and strips control characters', () => {
    const out = sanitizeComment('a\u0000\u0007b\tc\n' + 'x'.repeat(600));
    expect(out.startsWith('ab\tc\n')).toBe(true);
    expect(out.length).toBe(500);
  });
  it('defuses an embedded station-id marker so it cannot forge resolution', () => {
    const evil = sanitizeComment('please fix <!-- rrradio:station-id=victim -->');
    WORKFLOW_MARKER_RE.lastIndex = 0;
    expect(WORKFLOW_MARKER_RE.test(evil)).toBe(false);
  });
  it('defuses fenced-code breakouts', () => {
    expect(sanitizeComment('```js\nbad')).not.toContain('```');
  });
});

describe('buildIssueBody marker safety', () => {
  it('keeps the real station marker as the first marker even with a malicious comment', () => {
    const station = {
      stationId: 'builtin-fm4',
      stationName: 'FM4',
      streamHost: 'stream.fm4.example',
      categories: new Map(),
    };
    const plan = {
      sections: [
        {
          category: 'no-audio',
          count: 1,
          probeKind: 'stream',
          probeEvidence: 'broken-dns: ...',
          reason: 'probe failed',
          comments: [sanitizeComment('<!-- rrradio:station-id=victim -->')],
        },
      ],
    };
    const body = buildIssueBody(station, plan, { catalogPresent: true });
    WORKFLOW_MARKER_RE.lastIndex = 0;
    const first = WORKFLOW_MARKER_RE.exec(body);
    expect(first[1]).toBe('builtin-fm4');
    // And there is exactly one valid marker in the whole body.
    WORKFLOW_MARKER_RE.lastIndex = 0;
    const all = body.match(WORKFLOW_MARKER_RE);
    expect(all).toHaveLength(1);
  });

  it('places the marker on the first line', () => {
    const station = { stationId: 'x', stationName: 'X', streamHost: '', categories: new Map() };
    const body = buildIssueBody(station, { sections: [] }, {});
    expect(body.split('\n')[0]).toBe(stationMarker('x'));
  });
});

describe('issue helpers', () => {
  it('builds a title and labels', () => {
    expect(buildIssueTitle({ stationName: 'FM4', stationId: 'builtin-fm4' })).toBe(
      'Broken station: FM4 (builtin-fm4)',
    );
    expect(issueLabels(['no-audio', 'no-audio', 'wrong-logo'])).toEqual([
      'broken-station',
      'no-audio',
      'wrong-logo',
    ]);
  });

  it('finds an existing issue by station marker', () => {
    const issues = [
      { number: 1, body: 'unrelated' },
      { number: 2, body: `header\n${stationMarker('builtin-fm4')}\nbody` },
    ];
    expect(findIssueForStation(issues, 'builtin-fm4').number).toBe(2);
    expect(findIssueForStation(issues, 'nope')).toBeNull();
  });
});

describe('planStation', () => {
  function station(categories) {
    const map = new Map();
    for (const [category, c] of Object.entries(categories)) {
      map.set(category, {
        category,
        count: c.count ?? c.received + (c.confirmed ?? 0),
        receivedCount: c.received ?? 0,
        confirmedCount: c.confirmed ?? 0,
        comments: c.comments ?? [],
      });
    }
    return { stationId: 'builtin-fm4', stationName: 'FM4', streamHost: '', categories: map };
  }

  it('confirms a probe-failed category even with a single report', () => {
    const plan = planStation(
      station({ 'no-audio': { received: 1 } }),
      { stream: { failed: true, evidence: 'broken-dns' } },
      { threshold: 3 },
    );
    expect(plan.shouldOpenIssue).toBe(true);
    expect(plan.confirmCategories).toEqual(['no-audio']);
    expect(plan.labelCategories).toEqual(['no-audio']);
  });

  it('holds a probe-passing category below threshold (no issue)', () => {
    const plan = planStation(
      station({ 'no-audio': { received: 1 } }),
      { stream: { failed: false, evidence: 'ok' } },
      { threshold: 3 },
    );
    expect(plan.shouldOpenIssue).toBe(false);
    expect(plan.confirmCategories).toEqual([]);
  });

  it('confirms a probe-passing category once it reaches threshold', () => {
    const plan = planStation(
      station({ 'no-audio': { received: 3 } }),
      { stream: { failed: false, evidence: 'ok' } },
      { threshold: 3 },
    );
    expect(plan.shouldOpenIssue).toBe(true);
    expect(plan.confirmCategories).toEqual(['no-audio']);
  });

  it('keeps an already-confirmed category in the issue even when the probe now passes', () => {
    const plan = planStation(
      station({ 'no-audio': { received: 0, confirmed: 2 } }),
      { stream: { failed: false, evidence: 'ok' } },
      { threshold: 3 },
    );
    expect(plan.shouldOpenIssue).toBe(true);
    expect(plan.labelCategories).toEqual(['no-audio']);
    // Nothing new to confirm (no received rows left).
    expect(plan.confirmCategories).toEqual([]);
  });

  it('confirms non-probe-able categories by threshold only', () => {
    const belowThreshold = planStation(station({ 'wrong-info': { received: 2 } }), {}, { threshold: 3 });
    expect(belowThreshold.shouldOpenIssue).toBe(false);
    const atThreshold = planStation(station({ 'wrong-info': { received: 3 } }), {}, { threshold: 3 });
    expect(atThreshold.shouldOpenIssue).toBe(true);
    expect(atThreshold.confirmCategories).toEqual(['wrong-info']);
  });

  it('only lists categories with received rows in confirmCategories', () => {
    // 4 confirmed + 0 received, probe still failing → active, but nothing
    // new to flip received→confirmed.
    const plan = planStation(
      station({ 'no-audio': { received: 0, confirmed: 4 } }),
      { stream: { failed: true, evidence: 'broken-dns' } },
      { threshold: 3 },
    );
    expect(plan.labelCategories).toEqual(['no-audio']);
    expect(plan.confirmCategories).toEqual([]);
  });
});

describe('comment route (#820)', () => {
  function station(category, c) {
    const map = new Map([[category, { category, count: c.received, receivedCount: c.received, confirmedCount: 0, comments: c.comments ?? [], rows: c.rows ?? [] }]]);
    return { stationId: 'builtin-fm4', stationName: 'FM4', streamHost: '', categories: map };
  }

  it('opens a review issue for an unprobeable category with a comment, confirming nothing', () => {
    const plan = planStation(station('other', { received: 1, comments: ['plays a different station'] }), {}, { threshold: 3 });
    expect(plan.shouldOpenIssue).toBe(true);
    expect(plan.needsReview).toBe(true);
    expect(plan.confirmCategories).toEqual([]);
    expect(plan.labelCategories).toEqual(['other']);
    expect(plan.sections[0].reviewOnly).toBe(true);
    expect(issueLabels(plan.labelCategories, { needsReview: plan.needsReview })).toEqual([
      'broken-station',
      'other',
      'needs-review',
    ]);
    const body = buildIssueBody({ stationId: 'builtin-fm4', stationName: 'FM4', streamHost: '' }, plan, {});
    expect(body).toContain('- Needs review:');
    expect(body).not.toContain('- Confirmed by:');
    expect(body).toContain('> plays a different station');
  });

  it('holds an unprobeable category without a comment', () => {
    const plan = planStation(station('unspecified', { received: 1 }), {}, { threshold: 3 });
    expect(plan.shouldOpenIssue).toBe(false);
    expect(plan.held.map((h) => h.category)).toEqual(['unspecified']);
  });

  it('holds a probeable category whose probe passes, comment or not', () => {
    const plan = planStation(
      station('no-audio', { received: 1, comments: ['silent on cellular'] }),
      { stream: { failed: false, evidence: 'ok: audio/mpeg' } },
      { threshold: 3 },
    );
    expect(plan.shouldOpenIssue).toBe(false);
    expect(plan.needsReview).toBe(false);
    expect(plan.held[0]).toMatchObject({ category: 'no-audio', probeKind: 'stream', probeEvidence: 'ok: audio/mpeg', comments: ['silent on cellular'] });
  });

  it('does not mark a threshold-confirmed category as review-only', () => {
    const plan = planStation(station('other', { received: 3, comments: ['a', 'b', 'c'] }), {}, { threshold: 3 });
    expect(plan.needsReview).toBe(false);
    expect(plan.confirmCategories).toEqual(['other']);
  });
});

describe('held reports digest (#819)', () => {
  const NOW = Date.parse('2026-11-23T12:00:00Z');
  const opts = { now: NOW, maxAgeDays: 21, graceDays: 7 };

  it('aggregate keeps row ids and dates per category', () => {
    const stations = aggregate([row({ id: 'a', createdAt: '2026-11-01T10:00:00.000Z' }), row({ id: 'b' })]);
    expect(stations.get('builtin-fm4').categories.get('no-audio').rows).toEqual([
      { id: 'a', createdAt: '2026-11-01T10:00:00.000Z' },
      { id: 'b', createdAt: null },
    ]);
  });

  it('round-trips the held marker', () => {
    const listed = new Map([
      ['builtin-fm4', '2026-11-10'],
      ['04ff395c-514b-44c4-98b0-f93b8d9e383c', '2026-11-23'],
    ]);
    expect(parseHeldMarker(`x\n${heldMarker(listed)}\ny`)).toEqual(listed);
    expect(parseHeldMarker('no marker')).toEqual(new Map());
    expect(parseHeldMarker(heldMarker(new Map()))).toEqual(new Map());
  });

  it('ages a row out only when it is old AND its station was listed long enough', () => {
    const rows = [
      { id: 'old', createdAt: '2026-10-20T00:00:00.000Z' },
      { id: 'fresh', createdAt: '2026-11-20T00:00:00.000Z' },
      { id: 'undated', createdAt: null },
    ];
    // Never listed → a human never saw it → nothing ages out.
    expect(partitionHeldRows(rows, { ...opts, listedSince: null }).expiredIds).toEqual([]);
    // Listed yesterday → still inside the grace period.
    expect(partitionHeldRows(rows, { ...opts, listedSince: '2026-11-22' }).expiredIds).toEqual([]);
    // Listed 8 days ago → only the old row goes.
    const part = partitionHeldRows(rows, { ...opts, listedSince: '2026-11-15' });
    expect(part.expiredIds).toEqual(['old']);
    expect(part.live.map((r) => r.id)).toEqual(['fresh', 'undated']);
  });

  it('never ages out when HOLD_MAX_DAYS is 0', () => {
    const rows = [{ id: 'old', createdAt: '2025-01-01T00:00:00.000Z' }];
    expect(partitionHeldRows(rows, { ...opts, maxAgeDays: 0, listedSince: '2025-01-02' }).expiredIds).toEqual([]);
  });

  it('reports which stations are new since the last digest', () => {
    expect(newlyHeld(new Map([['a', '2026-11-01']]), ['a', 'b'])).toEqual(['b']);
  });

  const entry = {
    stationId: 'builtin-fm4',
    stationName: 'FM4',
    catalogPresent: true,
    categories: [
      {
        category: 'no-audio',
        probeKind: 'stream',
        probeEvidence: 'ok: audio/mpeg',
        comments: [sanitizeComment('dead <!-- rrradio:station-id=victim -->')],
        rows: [{ id: 'a', createdAt: '2026-11-20T08:00:00.000Z' }, { id: 'b', createdAt: '2026-11-18T08:00:00.000Z' }],
      },
    ],
  };

  it('builds a digest body with markers first and no forgeable station marker', () => {
    const listedSince = new Map([['builtin-fm4', '2026-11-23']]);
    const body = buildDigestBody([entry], { listedSince, threshold: 3, maxAgeDays: 21, graceDays: 7, generatedAt: '2026-11-23T12:00:00Z' });
    const lines = body.split('\n');
    expect(lines[0]).toBe('<!-- rrradio:report-digest -->');
    expect(parseHeldMarker(body)).toEqual(listedSince);
    expect(body).toContain('no-audio ×2 · since 2026-11-18 · probe (stream): ok: audio/mpeg');
    // The digest must never look like a station issue to resolve-reports.yml.
    WORKFLOW_MARKER_RE.lastIndex = 0;
    expect(WORKFLOW_MARKER_RE.test(body)).toBe(false);
  });

  it('says so when nothing is on hold', () => {
    expect(buildDigestBody([], { threshold: 3, maxAgeDays: 21, graceDays: 7 })).toContain('Nothing on hold.');
  });

  it('comments only when there is news', () => {
    expect(buildDigestComment([], 0)).toBe('');
    expect(buildDigestComment([entry], 0)).toContain('**New on hold (1):**');
    expect(buildDigestComment([], 2)).toContain('2 held report(s) aged out');
  });
});
