/**
 * The weekly catalog-quality digest (ADR 002 — "Report").
 *
 * Decision-shaped Markdown: three headline metrics with week-over-week
 * deltas, then only the stations a human would act on. Deliberately not a
 * log dump — the previous tracking issue was 21 KB of probe output and
 * nobody read it, so every list here is capped and every section collapses
 * to one line when it is empty.
 *
 * Pure: takes already-parsed inputs, returns a string. The CLI does the I/O
 * and never throws.
 *
 * @typedef {{o: string, c: string|null, n: number, first: string, last: string}} Streak
 */

const DAY_MS = 86_400_000;

/** Hysteresis thresholds — a station is "failing" only past these. */
export const HARD_DAYS = 3;
export const SOFT_DAYS = 5;
/** Recovery needs two days of `ok`, matching the phase-2 republish rule. */
export const RECOVERED_DAYS = 2;
/** Per-group cap; the rest is summarised as a count. */
export const LIST_CAP = 40;
/** Cap for the actions list — one screen of what the bot did this week. */
export const ACTIONS_CAP = 20;

/**
 * @typedef {{day: string, actions?: object[], skipped?: Array<{id: string, why: string}>,
 *            circuitBreaker?: boolean}} ActionsDay one `health-data/actions/<day>.json`
 *
 * @param {{record: object, streaks: Record<string, Record<string, Streak>>,
 *          metrics: object, history?: object[]|null, plan?: object|null,
 *          catalog?: Array<{id: string, name?: string, status?: string}>,
 *          rows?: object[], actionsLog?: ActionsDay[]|null, days?: number, now: string}} input
 * @returns {string} Markdown
 */
export function renderDigest({ record, streaks, metrics, history, plan, catalog, rows, actionsLog, days = 7, now }) {
  const windowStart = new Date(Date.parse(now) - days * DAY_MS).toISOString().slice(0, 10);
  const names = new Map((catalog ?? []).map((s) => [s.id, s.name ?? s.id]));
  const statuses = new Map((catalog ?? []).map((s) => [s.id, s.status ?? null]));
  const streamStreak = (id) => streaks?.[id]?.stream ?? null;
  const detailOf = (id) => record?.stations?.[id]?.stream?.d ?? null;

  const out = [`## Catalog quality — ${now.slice(0, 10)}`, '', `Window: ${windowStart} → ${now.slice(0, 10)} (${days} days).`, ''];

  out.push(...metricsTable(metrics, history, plan, record), '');

  // ─── newly failing ────────────────────────────────────────────────
  const failing = Object.keys(streaks ?? {})
    .filter((id) => names.size === 0 || names.has(id))
    .map((id) => ({ id, streak: streamStreak(id) }))
    .filter(({ streak }) => streak && streak.o === 'bad' && overThreshold(streak) && streak.first >= windowStart)
    .sort((a, b) => b.streak.n - a.streak.n || a.id.localeCompare(b.id));

  const curated = failing.filter(({ id }) => isCurated(id, plan, statuses));
  const longTail = failing.filter(({ id }) => !isCurated(id, plan, statuses));
  const failLine = ({ id, streak }) =>
    `- \`${id}\` · ${names.get(id) ?? id} · ${detailOf(id) ?? streak.c ?? 'bad'} · ${streak.n} days`;

  out.push(`### Newly failing (${failing.length})`, '');
  out.push('**Curated**', '', ...capped(curated, failLine), '');
  out.push('**Long tail**', '', ...capped(longTail, failLine), '');

  // ─── recovered ────────────────────────────────────────────────────
  // The record only holds the current verdict, so "was failing" is read off
  // the log: a `bad` row for this station before the ok streak began.
  const badBefore = badDaysBefore(rows ?? [], windowStart);
  const recovered = Object.keys(streaks ?? {})
    .filter((id) => names.size === 0 || names.has(id))
    .map((id) => ({ id, streak: streamStreak(id) }))
    .filter(({ id, streak }) => {
      if (!streak || streak.o !== 'ok' || streak.n < RECOVERED_DAYS || streak.first < windowStart) return false;
      return (badBefore.get(id) ?? []).some((day) => day < streak.first);
    })
    .sort((a, b) => b.streak.n - a.streak.n || a.id.localeCompare(b.id));

  out.push(`### Recovered (${recovered.length})`, '');
  out.push(...capped(recovered, ({ id, streak }) => `- \`${id}\` · ${names.get(id) ?? id} · ok for ${streak.n} days`), '');

  // ─── actions this week (phase 2) ──────────────────────────────────
  out.push(...actionsSection(actionsLog ?? [], windowStart), '');

  // ─── hot set failing right now ────────────────────────────────────
  const plays = plan?.plays ?? {};
  const hotBad = (plan?.hot ?? [])
    .filter((id) => streamStreak(id)?.o === 'bad')
    .sort((a, b) => (plays[b] ?? 0) - (plays[a] ?? 0) || a.localeCompare(b));

  out.push(`### Hot-set stations failing now (${hotBad.length})`, '');
  out.push(
    ...capped(hotBad, (id) => {
      const streak = streamStreak(id);
      return `- \`${id}\` · ${names.get(id) ?? id} · ${detailOf(id) ?? streak.c ?? 'bad'} · ${plays[id] ?? 0} plays · ${streak.n} days`;
    }),
    '',
  );

  // ─── top failure details ──────────────────────────────────────────
  const tally = new Map();
  for (const id of Object.keys(streaks ?? {})) {
    if (streamStreak(id)?.o !== 'bad') continue;
    const detail = detailOf(id) ?? 'unknown';
    tally.set(detail, (tally.get(detail) ?? 0) + 1);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  out.push('### Top failure details', '');
  out.push(...(top.length ? top.map(([d, n]) => `- ${n} × ${d}`) : ['none']), '');

  // ─── freshness ────────────────────────────────────────────────────
  out.push('### Facet freshness', '');
  const runs = Object.entries(record?.runs ?? {});
  out.push(
    ...(runs.length
      ? runs.map(([facet, run]) => `- \`${facet}\` — ${run.checked ?? 0} checked, last run ${ageInDays(run.lastRun, now)}`)
      : ['none']),
  );

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** Short digest for a run whose inputs could not be read. Never throws. */
export function renderMissingDigest(missing, now) {
  return [
    `## Catalog quality — ${now.slice(0, 10)}`,
    '',
    'No digest this week: the derive step did not leave usable inputs on `health-data`.',
    '',
    ...missing.map((m) => `- missing or unreadable: \`${m}\``),
    '',
    'This is a tooling problem, not a catalog problem — check the latest `station-probe` run.',
    '',
  ].join('\n');
}

// ─── helpers ─────────────────────────────────────────────────────────

function overThreshold(streak) {
  return (streak.c === 'hard' && streak.n >= HARD_DAYS) || (streak.c === 'soft' && streak.n >= SOFT_DAYS);
}

/**
 * Curated tier per the plan; without a plan fall back to the catalog status
 * (`working` / `icy-only` are hand-curated, bulk imports are `stream-only`).
 */
function isCurated(id, plan, statuses) {
  const tier = plan?.tiers?.[id];
  if (tier) return tier === 'curated';
  const status = statuses.get(id);
  return status === 'working' || status === 'icy-only';
}

/** id → sorted days on which a `bad` stream row was observed inside the window. */
function badDaysBefore(rows, windowStart) {
  const map = new Map();
  for (const row of rows) {
    if (row.f !== 'stream' || row.o !== 'bad') continue;
    const day = row.at.slice(0, 10);
    if (day < windowStart) continue;
    if (!map.has(row.id)) map.set(row.id, []);
    map.get(row.id).push(day);
  }
  return map;
}

/**
 * What the decide/act loop did inside the window, from the per-day audit
 * files. A station is counted once per action even when the same proposal
 * repeats on consecutive days (a review stays open until a human acts, so
 * it is re-proposed daily); the newest occurrence is the one listed.
 *
 * @param {ActionsDay[]} actionsLog
 * @param {string} windowStart `YYYY-MM-DD`
 * @returns {string[]} Markdown lines
 */
function actionsSection(actionsLog, windowStart) {
  const days = actionsLog
    .filter((d) => typeof d?.day === 'string' && d.day >= windowStart)
    .sort((a, b) => b.day.localeCompare(a.day)); // newest first
  /** @type {Map<string, {day: string, id: string, action: string, reason: string}>} key id|action */
  const seen = new Map();
  const skippedBy = new Map();
  const tripped = [];
  for (const d of days) {
    if (d.circuitBreaker === true) tripped.push(d.day);
    for (const a of d.actions ?? []) {
      if (!a?.id || !a?.action) continue;
      const label = a.action === 'review' ? `review (${a.proposed ?? 'unpublish'})` : a.action;
      const key = `${a.id}|${label}`;
      if (!seen.has(key)) seen.set(key, { day: d.day, id: a.id, action: label, reason: a.reason ?? '' });
    }
    for (const sk of d.skipped ?? []) {
      if (!sk?.why) continue;
      skippedBy.set(sk.why, (skippedBy.get(sk.why) ?? 0) + 1);
    }
  }
  const all = [...seen.values()];
  const count = (pred) => all.filter(pred).length;
  const unpublished = count((a) => a.action === 'unpublish');
  const republished = count((a) => a.action === 'republish');
  const swapped = count((a) => a.action === 'swap-url');
  const awaiting = new Set(all.filter((a) => a.action.startsWith('review')).map((a) => a.id)).size;

  const out = [`### Actions this week (${all.length})`, ''];
  if (!all.length && !skippedBy.size && !tripped.length) return [...out, 'none'];
  out.push(`- unpublished ${unpublished} · republished ${republished} · swapped ${swapped} · awaiting review ${awaiting}`);
  if (skippedBy.size) {
    const parts = [...skippedBy.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([why, n]) => `${why} ${n}`);
    out.push(`- skipped: ${parts.join(', ')}`);
  }
  if (tripped.length) out.push(`- circuit breaker tripped on ${tripped.sort().join(', ')}`);
  if (all.length) {
    out.push('');
    const shown = all.slice(0, ACTIONS_CAP).map((a) => `- \`${a.id}\` · ${a.action} · ${a.reason}`);
    if (all.length > ACTIONS_CAP) shown.push(`- …and ${all.length - ACTIONS_CAP} more`);
    out.push(...shown);
  }
  return out;
}

function capped(items, line) {
  if (!items.length) return ['none'];
  const shown = items.slice(0, LIST_CAP).map(line);
  if (items.length > LIST_CAP) shown.push(`- …and ${items.length - LIST_CAP} more`);
  return shown;
}

function metricsTable(metrics, history, plan, record) {
  const prev = previousMetrics(history, metrics?.at);
  const rows = [
    ['Availability (play-weighted)', pct(metrics?.availability), deltaPp(metrics?.availability, prev?.availability)],
    ['Freshness (observed 7d ÷ published)', pct(metrics?.freshness), deltaPp(metrics?.freshness, prev?.freshness)],
    // The logo facet has no probe yet (phase 1 is stream-only), so this reads
    // "n/a" until logo observations exist — one word, on purpose.
    ['Hot-set logo coverage', logoCoverage(plan, record), '—'],
  ];
  return [
    '| Metric | Now | Δ 7d |',
    '| --- | --- | --- |',
    ...rows.map(([label, value, delta]) => `| ${label} | ${value} | ${delta} |`),
  ];
}

/** Nearest history row at least 7 days older than `at`; null when there is none. */
function previousMetrics(history, at) {
  if (!Array.isArray(history) || !at) return null;
  // Compare as instants, not strings: history rows are written by different
  // runs and mix `…:00Z` with `…:00.000Z`.
  const cutoff = Date.parse(at) - 7 * DAY_MS;
  const older = history.filter((row) => typeof row?.at === 'string' && Date.parse(row.at) <= cutoff);
  if (!older.length) return null;
  return older.reduce((best, row) => (Date.parse(row.at) > Date.parse(best.at) ? row : best));
}

/**
 * Share of the hot set with an `ok` logo verdict. Phase 1 probes only the
 * stream facet, so until logo verdicts land in the record this is "n/a" —
 * a headline metric with no data must say so rather than read 0%.
 */
function logoCoverage(plan, record) {
  const hot = plan?.hot ?? [];
  if (!hot.length) return 'n/a';
  const graded = hot.filter((id) => record?.stations?.[id]?.logo?.v);
  if (!graded.length) return 'n/a';
  return pct(hot.filter((id) => record.stations[id].logo.v === 'ok').length / hot.length);
}

function pct(value) {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function deltaPp(now, before) {
  if (typeof now !== 'number' || typeof before !== 'number') return '—';
  const pp = (now - before) * 100;
  if (Math.abs(pp) < 0.05) return '±0.0pp';
  return `${pp > 0 ? '+' : '−'}${Math.abs(pp).toFixed(1)}pp`;
}

function ageInDays(lastRun, now) {
  if (!lastRun) return 'never';
  const days = Math.floor((Date.parse(now) - Date.parse(lastRun)) / DAY_MS);
  if (!Number.isFinite(days)) return 'never';
  return days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
}
