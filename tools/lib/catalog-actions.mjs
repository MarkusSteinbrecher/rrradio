/**
 * Catalog actions — the "act" stage of ADR 002 (catalog quality loop).
 *
 * Turns an `actions.json` list from tools/decide-actions.mjs into edits of
 * the two committed catalog files: `data/stations.yaml` (source of truth,
 * edited line by line through yaml-station-edit.mjs so the diff is a few
 * lines per station) and `public/stations.json` (the shipped artifact,
 * patched in memory through catalog-json-patch.mjs so no Radio Browser
 * round trip is needed).
 *
 * Pure functions over in-memory inputs; tools/apply-actions.mjs does the
 * I/O, the check-catalog gate and the PR body. Every action validates
 * everything it needs *before* it mutates, so a refused action leaves both
 * files untouched and `applyActions` can carry on with the rest.
 *
 * Lifecycle fields (YAML only — never published):
 *   status: broken · brokenSince · brokenFrom · brokenBy · brokenReason
 * A row is bot-managed iff `brokenBy: station-probe`; curator-set `broken`
 * rows are never touched.
 */

import {
  setStationScalar,
  removeStationScalar,
  getStationScalar,
  locateStationBlock,
  editStationBlock,
} from './yaml-station-edit.mjs';
import { findStation, patchStationFields, removeStation } from './catalog-json-patch.mjs';

/** Value of `brokenBy` that marks a row as ours. */
export const BOT = 'station-probe';
/** The lifecycle fields an unpublish writes and a republish removes, in file order. */
export const BROKEN_FIELDS = Object.freeze(['brokenSince', 'brokenFrom', 'brokenBy', 'brokenReason']);

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
// Ids name snapshot files under health-data/unpublished/, so they must be
// plain path segments. Catalog ids are slugs; anything else is refused.
const SAFE_ID_RX = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The station's own block text, or null when the id is not in the YAML. */
function blockOf(yamlText, id) {
  const bounds = locateStationBlock(yamlText, id);
  return bounds ? yamlText.slice(bounds.start, bounds.end) : null;
}

/** One-line scalar from a block (already narrowed to the station). */
function field(block, id, name) {
  return getStationScalar(block, id, name).value;
}

function assertId(id) {
  if (typeof id !== 'string' || !SAFE_ID_RX.test(id)) throw new Error(`unsafe station id ${JSON.stringify(id)}`);
}

/** Ids in YAML file order — the order the built JSON follows (modulo the collapse). */
export function yamlOrderOf(yamlText) {
  const ids = [];
  for (const m of yamlText.matchAll(/^- id: (.+)$/gm)) ids.push(m[1].trim());
  return ids;
}

/**
 * Where a republished row goes back into `stations`: right after the
 * nearest id that precedes it in the YAML *and* is still published. With
 * no such neighbour (or an id the YAML does not know) it is appended.
 */
export function insertIndex(yamlOrder, stations, id) {
  const pos = yamlOrder.indexOf(id);
  if (pos < 0) return stations.length;
  const present = new Map(stations.map((s, i) => [s?.id, i]));
  for (let i = pos - 1; i >= 0; i--) {
    const at = present.get(yamlOrder[i]);
    if (at !== undefined) return at + 1;
  }
  return stations.length;
}

/**
 * Unpublish: YAML `status: broken` + the four lifecycle fields, JSON row
 * removed and returned as the snapshot to persist.
 *
 * @param {{yamlText: string, stations: object[], action: {id: string, reason?: string}, day: string,
 *          foldCanonicals?: Set<string>}} input
 * @returns {{yamlText: string, stations: object[], snapshot: object}}
 */
export function applyUnpublish({ yamlText, stations, action, day, foldCanonicals }) {
  const id = action?.id;
  assertId(id);
  if (!DAY_RX.test(String(day))) throw new Error(`day must be YYYY-MM-DD, got ${JSON.stringify(day)}`);
  // Belt to the policy's braces: removing a fold canonical strands its
  // collapsed variants and check-catalog rejects the tree.
  if (foldCanonicals?.has(id)) throw new Error('fold canonical — its collapsed variants need this row; re-point the fold first');

  const block = blockOf(yamlText, id);
  if (block === null) throw new Error('not in data/stations.yaml');
  const status = field(block, id, 'status');
  if (status === 'broken') {
    const by = field(block, id, 'brokenBy');
    throw new Error(by ? `already broken (brokenBy: ${by})` : 'already broken (curator-set)');
  }
  if (!PUBLISHABLE.has(status)) throw new Error(`status is ${status ?? 'missing'} — nothing to unpublish`);
  const row = findStation(stations, id);
  // A publishable YAML row missing from the JSON is a fold member (its id
  // lives only in dedup-report.json). Flipping it would break check-catalog.
  if (!row) throw new Error('not in public/stations.json (folded by the collapse?) — YAML left alone');

  const reason = String(action.reason ?? '').replace(/\s+/g, ' ').trim() || `unpublished by ${BOT}`;
  const written = [
    ['brokenSince', day],
    ['brokenFrom', status],
    ['brokenBy', BOT],
    ['brokenReason', reason],
  ];
  const next = editStationBlock(yamlText, id, (b) => {
    let t = setStationScalar(b, id, 'status', 'broken').text;
    // setStationScalar inserts an absent field right after the `- id:`
    // header, so write last-to-first to end up in BROKEN_FIELDS order.
    for (const [f, v] of [...written].reverse()) t = setStationScalar(t, id, f, v).text;
    return t;
  }).text;

  return { yamlText: next, stations: removeStation(stations, id).stations, snapshot: row };
}

/**
 * Republish: YAML `status ← brokenFrom`, lifecycle fields removed, the
 * snapshot row re-inserted at its YAML-order position. Refuses rows the
 * bot does not own and republishes without a snapshot (an RB-bound row
 * cannot be rebuilt offline).
 *
 * @param {{yamlText: string, yamlOrder: string[], stations: object[],
 *          action: {id: string, to?: string}, snapshot: object|undefined}} input
 * @returns {{yamlText: string, stations: object[]}}
 */
export function applyRepublish({ yamlText, yamlOrder, stations, action, snapshot }) {
  const id = action?.id;
  assertId(id);

  const block = blockOf(yamlText, id);
  if (block === null) throw new Error('not in data/stations.yaml');
  const by = field(block, id, 'brokenBy');
  if (by !== BOT) throw new Error(by ? `brokenBy is ${by}, not ${BOT} — not ours` : `not bot-managed (no brokenBy: ${BOT})`);
  const status = field(block, id, 'status');
  if (status !== 'broken') throw new Error(`status is ${status ?? 'missing'}, expected broken`);
  const to = field(block, id, 'brokenFrom') ?? action.to;
  if (!PUBLISHABLE.has(to)) throw new Error(`brokenFrom ${JSON.stringify(to ?? null)} is not a publishable status`);
  if (!snapshot || typeof snapshot !== 'object' || snapshot.id !== id) {
    throw new Error('no snapshot in health-data/unpublished/ — cannot rebuild the published row');
  }
  if (findStation(stations, id)) throw new Error('already in public/stations.json');

  const next = editStationBlock(yamlText, id, (b) => {
    let t = setStationScalar(b, id, 'status', to).text;
    for (const f of BROKEN_FIELDS) t = removeStationScalar(t, id, f).text;
    return t;
  }).text;

  // The snapshot was taken while the row was published, so its status is
  // normally `to` already; force it so the published row is publishable.
  const row = snapshot.status === to ? snapshot : { ...snapshot, status: to };
  const out = stations.slice();
  out.splice(insertIndex(yamlOrder, out, id), 0, row);
  return { yamlText: next, stations: out };
}

/**
 * Swap the stream URL (and codec when known) in both files. Only https
 * URLs: the catalog is HTTPS-only (audit #71) and decide-actions only
 * proposes https anyway. `stations` is patched in place.
 *
 * @param {{yamlText: string, stations: object[], action: {id: string, newUrl: string, newCodec?: string}}} input
 * @returns {{yamlText: string, stations: object[]}}
 */
export function applySwapUrl({ yamlText, stations, action }) {
  const id = action?.id;
  assertId(id);
  const url = action.newUrl;
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error(`newUrl must be https, got ${JSON.stringify(url ?? null)}`);

  const block = blockOf(yamlText, id);
  if (block === null) throw new Error('not in data/stations.yaml');
  const row = findStation(stations, id);
  if (!row) throw new Error('not in public/stations.json');
  if (row.streamUrl === url) throw new Error('already on that URL');
  const codec = action.newCodec ? String(action.newCodec) : undefined;

  const next = editStationBlock(yamlText, id, (b) => {
    let t = setStationScalar(b, id, 'streamUrl', url).text;
    if (codec) t = setStationScalar(t, id, 'codec', codec).text;
    return t;
  }).text;
  patchStationFields(stations, id, { streamUrl: url, codec });
  // Variant rows must keep streams[0].url === streamUrl (check-catalog).
  if (Array.isArray(row.streams) && row.streams[0]) {
    row.streams[0] = { ...row.streams[0], url, ...(codec ? { codec } : {}) };
  }
  return { yamlText: next, stations };
}

/** The concrete edit an action asks for — review rows carry it in `proposed`. */
function kindOf(action) {
  return action?.action === 'review' ? action.proposed : action?.action;
}

/**
 * Apply every action the mode selects: `auto` takes `auto: true`, `review`
 * takes `auto: false` and materialises the proposal (the PR is the review
 * surface). A failing action lands in `errors` and the rest proceed.
 *
 * @param {{yamlText: string, stations: object[], actions: object[],
 *          snapshots?: Record<string, object>|Map<string, object>,
 *          day: string, mode: 'auto'|'review', foldCanonicals?: Set<string>}} input
 * @returns {{yamlText: string, stations: object[], applied: object[],
 *            snapshotsWritten: Record<string, object>, snapshotsDeleted: string[],
 *            errors: {id: string, action: string|undefined, message: string}[]}}
 */
export function applyActions({ yamlText, stations, actions, snapshots = {}, day, mode, foldCanonicals }) {
  if (mode !== 'auto' && mode !== 'review') throw new Error(`mode must be auto|review, got ${JSON.stringify(mode)}`);
  const wantAuto = mode === 'auto';
  const snapshotOf = snapshots instanceof Map ? (id) => snapshots.get(id) : (id) => snapshots?.[id];

  const applied = [];
  const errors = [];
  const snapshotsWritten = {};
  const snapshotsDeleted = [];
  let yamlOrder = null;

  for (const action of actions ?? []) {
    if (!action || (action.auto === true) !== wantAuto) continue;
    const id = action.id;
    const kind = kindOf(action);
    const entry = {
      id,
      name: null,
      action: kind,
      proposed: !wantAuto,
      tier: action.tier ?? null,
      reason: String(action.reason ?? '').replace(/\s+/g, ' ').trim(),
      streamUrl: null,
      newUrl: null,
      stationuuid: null,
      edge: action.edge ?? null,
      from: null,
      to: null,
    };
    try {
      if (kind === 'unpublish') {
        const before = findStation(stations, id);
        const r = applyUnpublish({ yamlText, stations, action, day, foldCanonicals });
        yamlText = r.yamlText;
        stations = r.stations;
        snapshotsWritten[id] = r.snapshot;
        Object.assign(entry, {
          name: r.snapshot.name ?? id,
          streamUrl: r.snapshot.streamUrl ?? null,
          stationuuid: r.snapshot.stationuuid ?? null,
          from: before?.status ?? action.from ?? null,
        });
      } else if (kind === 'republish') {
        yamlOrder ??= yamlOrderOf(yamlText);
        const snapshot = snapshotOf(id);
        const r = applyRepublish({ yamlText, yamlOrder, stations, action, snapshot });
        yamlText = r.yamlText;
        stations = r.stations;
        snapshotsDeleted.push(id);
        const row = findStation(stations, id);
        Object.assign(entry, {
          name: row?.name ?? id,
          streamUrl: row?.streamUrl ?? null,
          stationuuid: row?.stationuuid ?? null,
          to: row?.status ?? null,
        });
      } else if (kind === 'swap-url') {
        const row = findStation(stations, id);
        const oldUrl = row?.streamUrl ?? null;
        const r = applySwapUrl({ yamlText, stations, action });
        yamlText = r.yamlText;
        stations = r.stations;
        Object.assign(entry, {
          name: row?.name ?? id,
          streamUrl: oldUrl,
          newUrl: action.newUrl,
          stationuuid: row?.stationuuid ?? null,
        });
      } else {
        throw new Error(`unknown action ${JSON.stringify(kind ?? null)}`);
      }
      applied.push(entry);
    } catch (err) {
      errors.push({ id: typeof id === 'string' ? id : String(id), action: kind, message: err.message });
    }
  }

  return { yamlText, stations, applied, snapshotsWritten, snapshotsDeleted, errors };
}

function edgeText(edge) {
  if (!edge || typeof edge !== 'object') return 'no edge opinion';
  return `edge says ${edge.o ?? '?'}${edge.d ? ` · ${edge.d}` : ''}`;
}

/** One line telling a reviewer how to confirm or reject a proposal. */
function whatToCheck(a) {
  const rb = a.stationuuid ? `the Radio Browser record (stationuuid ${a.stationuuid})` : 'the Radio Browser record';
  if (a.action === 'unpublish') {
    return `open ${a.streamUrl ?? 'the stream'} in a player; ${edgeText(a.edge)}; look at ${rb} for a newer URL. Merge = unpublish, close = keep.`;
  }
  if (a.action === 'swap-url') {
    return `play the new URL ${a.newUrl} and the old one ${a.streamUrl ?? '(none)'}; confirm it is the same station; ${edgeText(a.edge)}; the new URL is ${rb}'s url_resolved.`;
  }
  if (a.action === 'republish') {
    return `open ${a.streamUrl ?? 'the stream'} and confirm it plays; ${edgeText(a.edge)}. Merge = back in the catalog as ${a.to ?? 'its previous status'}.`;
  }
  return 'inspect the diff.';
}

/**
 * Markdown PR body. Each applied action is exactly one top-level line
 * shaped `` - `id` · name · action · reason `` — the workflow counts lines
 * starting with "- `" to title the PR — so skipped items deliberately do
 * not start that way. No raw logs.
 */
export function renderSummary({ applied = [], errors = [], mode, day }) {
  const review = mode === 'review';
  if (applied.length === 0 && errors.length === 0) {
    return `Nothing to do — no ${review ? 'review proposals' : 'automatic actions'} for ${day}.\n`;
  }
  const count = (k) => applied.filter((a) => a.action === k).length;
  const lines = [
    `## Catalog ${review ? 'review' : 'actions'} · ${day}`,
    '',
    review
      ? `${applied.length} curated-tier proposal(s) from station-probe, materialised as a diff so the PR is the review. Nothing here merges on its own (ADR 002).`
      : `${applied.length} automatic long-tail action(s) from station-probe (ADR 002).`,
    '',
    `unpublish ${count('unpublish')} · republish ${count('republish')} · swap-url ${count('swap-url')} · skipped ${errors.length}`,
    '',
  ];
  for (const a of applied) {
    const name = String(a.name ?? a.id).replace(/\s+/g, ' ').trim() || a.id;
    lines.push(`- \`${a.id}\` · ${name} · ${a.action} · ${a.reason || '—'}`);
    if (review) lines.push(`  - What to check: ${whatToCheck(a)}`);
  }
  if (errors.length > 0) {
    lines.push('', `### Skipped (${errors.length})`, '');
    for (const e of errors) lines.push(`- skipped \`${e.id}\` · ${e.action ?? '?'} · ${e.message}`);
  }
  return `${lines.join('\n')}\n`;
}
