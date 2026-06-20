/**
 * Catalog-layer de-duplication: collapse same-station records (different
 * bitrate/codec renditions of ONE broadcast) into a single published station
 * carrying ordered stream variants.
 *
 * This is the publish-time complement to `dedupe-raw.mjs` (which dedupes the
 * raw Radio Browser pool). The build merges `data/stations.yaml` into one row
 * per YAML entry; the same physical station can appear as several rows (a
 * curated `builtin-fm4` 192k + a bulk-imported `at-fm4-orf` 128k). Left alone
 * they ship as duplicate search results. `collapseCatalog` groups them by
 * union-find, picks ONE canonical record for identity/metadata/favicon, and
 * folds the other members' stream URLs into a ranked `streams[]` (best→worst).
 *
 * **Precision over recall.** A published catalog must never *hide* a real
 * station by wrongly merging it. So the grouping uses only high-precision,
 * country-scoped structural signals:
 *
 *   1. exact stream URL (same audio bytes; `?ch=`/`?i=` channel selectors kept)
 *   2. stream fingerprint with the channel-number guard (delivery variants of
 *      one feed: bitrate/codec/`q<N>a` stripped, but `Bayern 1` ≠ `Bayern 2`)
 *   + curator overrides (force-merge / not-duplicate), keyed by catalog id.
 *
 * These two structural signals only ever merge rows that share an actual
 * stream path, so they cannot hide a distinct station: they catch the genuine
 * bitrate/codec-variant cases (FM4, DLF, every SomaFM channel) and nothing
 * else. A weaker "same brand name + same homepage" signal was deliberately
 * NOT included — it correctly merges format-feed clusters (GBH 89.7's feeds,
 * SWR3) but also over-merges distinct sub-channels that share a generic brand
 * name (Radio Minor's jazz/rock/indie), i.e. it can hide a real station. Such
 * clusters are recovered explicitly via a `force-merge` override after review
 * of `public/dedup-report.json` — opt-in, never automatic.
 *
 * It likewise does NOT trust `dedupe.json`'s raw-pool grouping (it tolerates
 * noisy cross-country / shared-CDN merges that would bridge unrelated
 * stations: Radio Gong → Kiss FM).
 *
 * The wire model is additive: `streamUrl` stays the required default (= the
 * best variant), `streams[]` is optional metadata a v1 client ignores. See
 * `docs/spec/contracts/catalog-schema.md` ("Stream quality model").
 *
 * Pure + side-effect free (no fs writes, no Date) so it is unit-testable and
 * reusable by the CI gates. `loadCatalogOverrides` reads the curator file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { numberSignature } from './station-name-signature.mjs';
import { normalizeStreamUrl, streamFingerprint } from './dedupe-normalize.mjs';
import { streamQualityLevel } from './stream-quality.mjs';

// Stronger signals win when stamping a member's `via` provenance (mirrors
// dedupe-raw's SIGNAL_RANK).
const SIGNAL_RANK = {
  override: 0,
  'stream-url': 1,
  'stream-fingerprint': 2,
};

const STATUS_RANK = { working: 0, 'icy-only': 1, 'stream-only': 2 };

/**
 * Curator overrides for the catalog layer, keyed by catalog `id` (not RB uuid
 * — the catalog reasons about curated rows). Same vocabulary as the RB
 * `overrides.yaml`:
 *
 *   force-merge:
 *     - canonical: builtin-fm4
 *       duplicates: [at-fm4-orf]      # collapse these into one station
 *   not-duplicate:
 *     - ids: [fip-main, fip-jazz]     # never collapse these together
 *
 * @param {string} root repo root
 * @returns {{forceMerge: string[][], notDuplicate: Set<string>}}
 */
export function loadCatalogOverrides(root) {
  const file = join(root, 'data', 'sources', 'catalog-dedupe-overrides.yaml');
  const empty = { forceMerge: [], notDuplicate: new Set() };
  if (!existsSync(file)) return empty;
  try {
    const parsed = YAML.parse(readFileSync(file, 'utf8')) || {};
    const forceMerge = [];
    for (const g of parsed['force-merge'] || []) {
      const ids = [];
      if (g?.canonical) ids.push(g.canonical);
      if (Array.isArray(g?.duplicates)) ids.push(...g.duplicates);
      if (ids.length >= 2) forceMerge.push(ids);
    }
    const notDuplicate = new Set();
    for (const entry of parsed['not-duplicate'] || []) {
      for (const id of entry?.ids || []) notDuplicate.add(id);
    }
    return { forceMerge, notDuplicate };
  } catch {
    return empty;
  }
}

// ─── Grouping ────────────────────────────────────────────────────────────

const cc = (r) => String(r.country ?? '').toUpperCase();

/**
 * Partition catalog records into logical-station groups via union-find over
 * the country-scoped structural signals. Every record lands in exactly one
 * group (singletons included), so callers can `.filter((g) => g.length > 1)`.
 *
 * @param {Array<{id:string, streamUrl?:string, name?:string, homepage?:string, country?:string}>} records
 * @param {object} [ctx]
 * @param {{forceMerge?:string[][], notDuplicate?:Set<string>|string[]}} [ctx.overrides]
 * @returns {{groups: Array<Array<object>>, signalOf: Map<string,string>}}
 */
export function groupCatalog(records, ctx = {}) {
  const forceMerge = ctx.overrides?.forceMerge || [];
  const notDuplicate =
    ctx.overrides?.notDuplicate instanceof Set
      ? ctx.overrides.notDuplicate
      : new Set(ctx.overrides?.notDuplicate || []);

  const parent = new Map();
  const signalOf = new Map();
  for (const r of records) parent.set(r.id, r.id);

  function find(x) {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function recordSignal(id, sig) {
    const prev = signalOf.get(id);
    if (prev === undefined || SIGNAL_RANK[sig] < SIGNAL_RANK[prev]) signalOf.set(id, sig);
  }
  function union(a, b, sig) {
    recordSignal(a, sig);
    recordSignal(b, sig);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  function unionByKey(keyFn, sig) {
    const buckets = new Map();
    for (const r of records) {
      const k = keyFn(r);
      if (!k) continue;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(r);
    }
    for (const list of buckets.values()) {
      for (let i = 1; i < list.length; i++) union(list[0].id, list[i].id, sig);
    }
  }

  // Strongest first so its provenance wins on shared members.
  for (const ids of forceMerge) {
    const present = ids.filter((id) => parent.has(id));
    for (let i = 1; i < present.length; i++) union(present[0], present[i], 'override');
  }
  // Exact stream within one country (query kept — `?ch=`/`?i=` are identity).
  unionByKey(
    (r) => (cc(r) && r.streamUrl ? `u:${cc(r)}|${normalizeStreamUrl(r.streamUrl, { dropQuery: false })}` : ''),
    'stream-url',
  );
  // Delivery variants of one feed; channel-number guard keeps Bayern 1 ≠ 2.
  unionByKey((r) => {
    const fp = streamFingerprint(r.streamUrl);
    return cc(r) && fp ? `f:${cc(r)}|${fp}|#${numberSignature(r.name)}` : '';
  }, 'stream-fingerprint');

  // Materialize; pull curator-asserted not-duplicate ids out as singletons.
  const rootToMembers = new Map();
  for (const r of records) {
    const root = find(r.id);
    if (!rootToMembers.has(root)) rootToMembers.set(root, []);
    rootToMembers.get(root).push(r);
  }
  const groups = [];
  for (const members of rootToMembers.values()) {
    const rest = [];
    for (const m of members) {
      if (notDuplicate.has(m.id)) groups.push([m]);
      else rest.push(m);
    }
    if (rest.length) groups.push(rest);
  }
  return { groups, signalOf };
}

// ─── Canonical selection + variant assembly ──────────────────────────────

function isLocalFavicon(fav) {
  return !!fav && !/^https?:\/\//i.test(String(fav));
}

function compareCanonical(a, b) {
  // 1. publishable status: working > icy-only > stream-only.
  const sr = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
  if (sr !== 0) return sr;
  // 2. has a now-playing metadata endpoint.
  const meta = (a.metadataUrl ? 0 : 1) - (b.metadataUrl ? 0 : 1);
  if (meta !== 0) return meta;
  // 3. curated/local favicon, then any favicon at all.
  const loc = (isLocalFavicon(a.favicon) ? 0 : 1) - (isLocalFavicon(b.favicon) ? 0 : 1);
  if (loc !== 0) return loc;
  const fav = (a.favicon ? 0 : 1) - (b.favicon ? 0 : 1);
  if (fav !== 0) return fav;
  // 4. editorially featured.
  const feat = (a.featured === true ? 0 : 1) - (b.featured === true ? 0 : 1);
  if (feat !== 0) return feat;
  // 5. higher derived quality.
  const q = streamQualityLevel(b.codec, b.bitrate) - streamQualityLevel(a.codec, a.bitrate);
  if (q !== 0) return q;
  // 6. stable lexical id — unique per row, so the order is total.
  return String(a.id).localeCompare(String(b.id));
}

function compareVariant(a, b) {
  const q = streamQualityLevel(b.codec, b.bitrate) - streamQualityLevel(a.codec, a.bitrate);
  if (q !== 0) return q;
  const br = (b.bitrate ?? 0) - (a.bitrate ?? 0);
  if (br !== 0) return br;
  const can = (a.isCanonical ? 0 : 1) - (b.isCanonical ? 0 : 1);
  if (can !== 0) return can;
  return String(a.url).localeCompare(String(b.url));
}

/** Build the ordered, deduped, tiered variant list for one group. */
function buildVariants(group, canonical, { allowHttp }) {
  let raw = group
    .filter((m) => m.streamUrl)
    .map((m) => ({
      url: m.streamUrl,
      bitrate: typeof m.bitrate === 'number' ? m.bitrate : undefined,
      codec: m.codec || undefined,
      isCanonical: m.id === canonical.id,
    }));
  if (!allowHttp) {
    // The public catalog is HTTPS-only; never fold an http variant in.
    raw = raw.filter((v) => v.isCanonical || /^https:/i.test(v.url));
  }
  // Dedupe by normalized URL (query kept) — keep the most informative copy.
  const byKey = new Map();
  for (const v of raw) {
    const key = normalizeStreamUrl(v.url, { dropQuery: false });
    const prev = byKey.get(key);
    if (!prev || compareVariant(v, prev) < 0) byKey.set(key, v);
  }
  const variants = [...byKey.values()].sort(compareVariant);
  const n = variants.length;
  return variants.map((v, i) => {
    const tier = i === 0 ? 'best' : i === n - 1 ? 'data' : 'balanced';
    return {
      url: v.url,
      ...(typeof v.bitrate === 'number' ? { bitrate: v.bitrate } : {}),
      ...(v.codec ? { codec: v.codec } : {}),
      tier,
    };
  });
}

/**
 * Collapse same-station records into one published row each, attaching a
 * ranked `streams[]` (and re-pointing `streamUrl` at the best variant) when a
 * logical station has more than one stream.
 *
 * @param {Array<object>} records merged catalog records (one per YAML entry)
 * @param {object} [ctx]
 * @param {{forceMerge?:string[][], notDuplicate?:Set<string>|string[]}} [ctx.overrides]
 * @param {boolean} [ctx.allowHttp=false] keep http variants (iOS-local artifact only)
 * @returns {{stations: Array<object>, report: object}}
 */
export function collapseCatalog(records, ctx = {}) {
  const allowHttp = ctx.allowHttp === true;
  const { groups, signalOf } = groupCatalog(records, ctx);

  const groupIndexById = new Map();
  groups.forEach((g, gi) => {
    for (const r of g) groupIndexById.set(r.id, gi);
  });
  const canonicalOfGroup = groups.map((g) =>
    g.length === 1 ? g[0] : [...g].sort(compareCanonical)[0],
  );

  const out = [];
  const reportGroups = [];
  const emitted = new Set();
  // Emit at each group's first appearance to preserve original ordering.
  for (const rec of records) {
    const gi = groupIndexById.get(rec.id);
    if (emitted.has(gi)) continue;
    emitted.add(gi);
    const group = groups[gi];
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const canonical = canonicalOfGroup[gi];
    const variants = buildVariants(group, canonical, { allowHttp });
    const merged = { ...canonical };
    if (variants.length >= 2) {
      merged.streamUrl = variants[0].url;
      merged.streams = variants;
    }
    out.push(merged);
    reportGroups.push({
      canonicalId: canonical.id,
      members: [...group]
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((m) => ({
          id: m.id,
          streamUrl: m.streamUrl,
          via: m.id === canonical.id ? 'canonical' : signalOf.get(m.id) || 'union',
        })),
      ...(variants.length >= 2 ? { streams: variants } : {}),
    });
  }
  reportGroups.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));

  const report = {
    totals: {
      inputRecords: records.length,
      logicalStations: out.length,
      collapsedRows: records.length - out.length,
      multiVariantStations: reportGroups.filter((g) => g.streams).length,
      groups: reportGroups.length,
    },
    groups: reportGroups,
  };
  return { stations: out, report };
}
