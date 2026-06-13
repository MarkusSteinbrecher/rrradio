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
