/**
 * The judging queue of the logo-fill rule (ADR 002, rule 9). Pure.
 *
 * Finding and guarding a logo is free and runs in CI every morning; saying
 * "yes, that is this station's logo" needs eyes. So the two halves meet in
 * two files on `health-data/logo-fill/`:
 *
 *   candidates.json  written by decide-actions — what the finder turned up
 *                    and nobody has judged yet
 *   verdicts.json    written by the judging session (a scheduled Claude
 *                    session, docs/logo-fill-judge.md) via
 *                    tools/logo-fill-judge.mjs — yes / no / unsure per id
 *
 * The next decide run settles the two: a `yes` becomes a fill-logo action, a
 * `no` / `unsure` waits out the retry window, and both leave the queue. No
 * API key, no model call from CI. If the session never runs, the queue fills
 * to PENDING_MAX, the finder stops, and nothing else changes.
 *
 * @typedef {{url: string, sourceUrl: string, kind: string, site: string, hash: string, size: string, day: string}} Candidate
 * @typedef {{url: string, verdict: 'yes'|'no'|'unsure', why: string, generic?: boolean, day: string}} Verdict
 */

/** The finder stops queueing when this many candidates await a verdict. */
export const PENDING_MAX = 400;
/** An unjudged candidate older than this is dropped (the icon may have moved); the station is found again later. */
export const CANDIDATE_TTL_DAYS = 21;
export const VERDICTS = Object.freeze(['yes', 'no', 'unsure']);

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

/** A verdict counts only for the exact URL it was given for. */
export function verdictFor(id, candidates, verdicts) {
  const c = candidates?.[id];
  const v = verdicts?.[id];
  return c && v && v.url === c.url && VERDICTS.includes(v.verdict) ? v : null;
}

/** Candidates nobody has judged yet, oldest first — what the session looks at. */
export function pendingCandidates(candidates, verdicts) {
  return Object.entries(candidates ?? {})
    .filter(([id]) => !verdictFor(id, candidates, verdicts))
    .sort(([a, ca], [b, cb]) => String(ca.day).localeCompare(String(cb.day)) || a.localeCompare(b))
    .map(([id, c]) => ({ id, ...c }));
}

/**
 * Read the queue at the start of a decide run.
 * @param {{candidates: Record<string, Candidate>, verdicts: Record<string, Verdict>, day: string}} input
 * @returns {{fills: Map<string, {newFavicon: string, sourceUrl: string, kind: string, judge: {verdict: string, why: string}}>,
 *            outcomes: Map<string, {o: string, d?: string}>, generic: string[], expired: string[], pending: number}}
 */
export function settleQueue({ candidates = {}, verdicts = {}, day }) {
  const fills = new Map();
  const outcomes = new Map();
  const generic = [];
  const expired = [];
  let pending = 0;
  for (const id of Object.keys(candidates).sort()) {
    const c = candidates[id];
    const v = verdictFor(id, candidates, verdicts);
    if (!v) {
      if (daysBetween(c.day, day) > CANDIDATE_TTL_DAYS) expired.push(id);
      else pending += 1;
      continue;
    }
    if (v.verdict === 'yes') {
      fills.set(id, { newFavicon: c.url, sourceUrl: c.sourceUrl, kind: c.kind, judge: { verdict: 'yes', why: clean(v.why) } });
    } else {
      outcomes.set(id, { o: `judge-${v.verdict}`, d: clean(v.why) });
      if (v.generic === true && c.hash) generic.push(c.hash);
    }
  }
  return { fills, outcomes, generic, expired, pending };
}

/**
 * The queue files after the policy has had its say. A judged candidate
 * leaves the queue — unless it was a `yes` that the cap or a circuit breaker
 * held back, which keeps its verdict and goes again tomorrow.
 *
 * @param {{candidates: Record<string, Candidate>, verdicts: Record<string, Verdict>,
 *          settled: ReturnType<typeof settleQueue>, added?: Record<string, Candidate>,
 *          result: {actions: Array<{id: string, action: string, proposed?: string}>, skipped: Array<{id: string, why: string}>}}} input
 * @returns {{candidates: Record<string, Candidate>, verdicts: Record<string, Verdict>, proposed: string[], held: string[]}}
 */
export function closeQueue({ candidates = {}, verdicts = {}, settled, added = {}, result }) {
  const acted = new Set(
    (result?.actions ?? []).filter((a) => (a.action === 'review' ? a.proposed : a.action) === 'fill-logo').map((a) => a.id),
  );
  const waiting = new Set(
    (result?.skipped ?? []).filter((s) => s.why === 'cap' || s.why === 'circuit-breaker').map((s) => s.id),
  );
  const drop = new Set([...settled.outcomes.keys(), ...settled.expired]);
  const proposed = [];
  const held = [];
  for (const id of settled.fills.keys()) {
    if (acted.has(id)) proposed.push(id);
    else if (waiting.has(id)) held.push(id);
    // Anything else: the station got a logo, left the catalog, … — stale.
    if (!waiting.has(id) || acted.has(id)) drop.add(id);
  }
  const keep = (obj) => Object.fromEntries(Object.entries(obj).filter(([id]) => !drop.has(id)).sort(([a], [b]) => a.localeCompare(b)));
  const nextCandidates = keep({ ...candidates, ...added });
  // A verdict without its candidate is noise; one for another URL is stale.
  const nextVerdicts = Object.fromEntries(
    Object.entries(keep(verdicts)).filter(([id, v]) => nextCandidates[id]?.url === v.url),
  );
  return { candidates: nextCandidates, verdicts: nextVerdicts, proposed, held };
}

/**
 * Merge a session's answers into verdicts.json. An answer is accepted only
 * for an id that was in the batch the session was shown, with a known
 * verdict — everything else is reported, never guessed.
 *
 * @param {{batch: Array<{id: string, url: string}>, answers: Array<{id: string, verdict: string, why?: string, generic?: boolean}>,
 *          existing?: Record<string, Verdict>, day: string}} input
 * @returns {{verdicts: Record<string, Verdict>, accepted: number, errors: string[], missing: string[]}}
 */
export function mergeVerdicts({ batch, answers, existing = {}, day }) {
  const shown = new Map((batch ?? []).map((b) => [b.id, b.url]));
  const verdicts = { ...existing };
  const errors = [];
  const seen = new Set();
  for (const a of Array.isArray(answers) ? answers : []) {
    const id = a?.id;
    if (typeof id !== 'string' || !shown.has(id)) { errors.push(`${JSON.stringify(id ?? null)}: not in this batch`); continue; }
    if (seen.has(id)) { errors.push(`${id}: answered twice`); continue; }
    if (!VERDICTS.includes(a.verdict)) { errors.push(`${id}: verdict must be yes|no|unsure, got ${JSON.stringify(a.verdict ?? null)}`); continue; }
    seen.add(id);
    const v = { url: shown.get(id), verdict: a.verdict, why: clean(a.why), day };
    if (a.generic === true && a.verdict === 'no') v.generic = true;
    verdicts[id] = v;
  }
  const missing = [...shown.keys()].filter((id) => !seen.has(id));
  return { verdicts: Object.fromEntries(Object.entries(verdicts).sort(([a], [b]) => a.localeCompare(b))), accepted: seen.size, errors, missing };
}
