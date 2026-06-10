/**
 * Data layer for the tracker console. Every artifact is a committed static
 * JSON under public/ (no backend — repo decision); loaders memoise so views
 * can re-request freely.
 */

import type { Station } from '../types';

const BASE = import.meta.env.BASE_URL;

export type Verdict = 'ok' | 'warn' | 'bad' | 'na';

export interface FacetEntry {
  v: Verdict;
  since: string;
  d?: string;
}

export interface RunMeta {
  lastRun: string;
  tool: string;
  scope: string;
  checked: number;
  tally: Record<Verdict, number>;
}

export interface HealthRecord {
  version: number;
  runs: Record<string, RunMeta>;
  stations: Record<string, Record<string, FacetEntry>>;
}

/** Column order — mirrors tools/lib/health-record.mjs FACETS. */
export const FACETS = [
  'stream',
  'https',
  'icy',
  'metadata',
  'fetcher',
  'program',
  'logo',
  'homepage',
  'drift',
  'duplicate',
] as const;
export type Facet = (typeof FACETS)[number];

export const FACET_LABEL: Record<Facet, string> = {
  stream: 'Stream',
  https: 'HTTPS',
  icy: 'ICY',
  metadata: 'Meta API',
  fetcher: 'Fetcher',
  program: 'Program',
  logo: 'Logo',
  homepage: 'Homepage',
  drift: 'RB drift',
  duplicate: 'Duplicates',
};

/** Short table-header form. */
export const FACET_SHORT: Record<Facet, string> = {
  stream: 'Strm',
  https: 'TLS',
  icy: 'ICY',
  metadata: 'Meta',
  fetcher: 'Ftch',
  program: 'Prog',
  logo: 'Logo',
  homepage: 'Home',
  drift: 'Drft',
  duplicate: 'Dup',
};

/** Plain-language explanation per facet — tooltips + the table legend.
 *  Semantics mirror docs/station-health.md. */
export const FACET_DESC: Record<Facet, string> = {
  stream: 'Does the stream URL answer with playable audio? ok = 2xx + audio content-type · warn = unexpected content-type · bad = HTTP error / network failure',
  https: 'Is the stream served over HTTPS? http streams are blocked as mixed content in the web player. ok = https · bad = http-only',
  icy: 'Does the stream carry inline ICY now-playing titles? ok = StreamTitle seen · warn = advertised but none received · bad = none · n/a = HLS',
  metadata: 'Does the now-playing metadata source respond? (the station’s metadataUrl or its built-in fetcher)',
  fetcher: 'Is the metadata fetcher key wired to a known broadcaster fetcher? bad = unknown key · n/a = generic ICY',
  program: 'Does the fetcher also supply program / show information? warn = fetcher without program data · n/a = no fetcher',
  homepage: 'Does the station homepage still resolve? warn = bot-blocked (401/403/429) · bad = dead or server error · n/a = no homepage',
  logo: 'Favicon quality: present, reachable, large enough, properly licensed (URL heuristics + real-pixel probe)',
  drift: 'Has the bound Radio Browser record changed upstream since we reviewed it? warn = upstream changed · bad = record gone · n/a = not RB-bound',
  duplicate: 'Does this entry collide with another catalog station? warn = review-tier similarity · bad = blocking collision (same stream)',
};

/** Curation status taxonomy (the publishable subset). */
export const STATUS_DESC: Record<string, string> = {
  working: 'stream + now-playing metadata + cover art all flowing',
  'icy-only': 'stream plays, ICY title supplies now-playing — no broadcaster fetcher',
  'stream-only': 'stream plays, no metadata source available',
};

export interface LogoStatusRow {
  id: string;
  source?: string;
  tier?: string;
  state?: string;
  reason?: string;
  action?: string;
  faviconSource?: string | null;
  faviconSourceUrl?: string | null;
  faviconLicense?: string | null;
  npQuality?: string | null;
  probeWidth?: number | null;
  probeHeight?: number | null;
  probeBytes?: number | null;
  probeError?: string | null;
}

interface LogoStatusReport {
  generatedAt?: string;
  totals?: Record<string, number>;
  stations?: LogoStatusRow[];
}

export interface DriftEntry {
  id: string;
  reason?: string;
  stationuuid?: string;
  storedChangeuuid?: string;
  currentChangeuuid?: string;
  upstream?: Record<string, unknown>;
}

interface DriftReport {
  checkedAt?: string;
  drift?: DriftEntry[];
  missing?: { id: string }[];
}

export interface DuplicateGroup {
  severity: 'blocking' | 'review';
  signalKinds?: string[];
  entries: { id: string; name?: string; streamUrl?: string }[];
}

interface DuplicatesReport {
  generatedAt?: string;
  duplicateGroups?: DuplicateGroup[];
}

export interface SourceSummary {
  id: string;
  name: string;
  abbr?: string;
  kind?: string;
  homepage?: string | null;
  description?: string | null;
  candidateCount?: number;
  importedCount?: number;
  availableCount?: number;
  /** Candidate rows tallied by disposition (imported | available |
   *  duplicate | broken | unprobed) — precomputed by build-sources. */
  dispositionTotals?: Record<string, number>;
}

interface SourcesIndex {
  generatedAt?: string;
  catalogTotal?: number;
  sources?: SourceSummary[];
}

/** catalog-id → source-id, compact: majority source is the default,
 *  only minority-source stations appear in overrides. */
interface CatalogSourceMap {
  generatedAt?: string;
  defaultSource?: string;
  overrides?: Record<string, string>;
}

/** One row per catalog station with everything the console knows about it. */
export interface StationRow {
  station: Station;
  facets: Record<string, FacetEntry | undefined>;
  logo: LogoStatusRow | undefined;
  /** Provenance — source id from data/sources.yaml (via catalog-source-map). */
  source: string | undefined;
  badCount: number;
  warnCount: number;
  lastChange: string;
}

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadCatalog = memo(async (): Promise<Station[]> => {
  const raw = await getJson<{ stations?: Station[] } | Station[]>('stations.json');
  const stations = Array.isArray(raw) ? raw : raw.stations;
  if (!Array.isArray(stations)) throw new Error('stations.json: missing stations[]');
  return stations;
});

export const loadHealth = memo(async (): Promise<HealthRecord | null> => {
  try {
    const rec = await getJson<HealthRecord>('station-health.json');
    return rec.version === 1 && typeof rec.stations === 'object' ? rec : null;
  } catch {
    return null;
  }
});

export const loadLogoStatus = memo(async (): Promise<LogoStatusReport | null> => {
  try {
    return await getJson<LogoStatusReport>('station-logo-status.json');
  } catch {
    return null;
  }
});

export const loadDrift = memo(async (): Promise<DriftReport | null> => {
  try {
    return await getJson<DriftReport>('station-drift.json');
  } catch {
    return null;
  }
});

export const loadDuplicates = memo(async (): Promise<DuplicatesReport | null> => {
  try {
    return await getJson<DuplicatesReport>('station-duplicates.json');
  } catch {
    return null;
  }
});

/** Source registry summary (data/sources.yaml → public/sources.json). */
export const loadSourcesIndex = memo(async (): Promise<SourcesIndex | null> => {
  try {
    return await getJson<SourcesIndex>('sources.json');
  } catch {
    return null;
  }
});

/** Candidate dispositions tallied across every source — the donut data. */
export async function loadDispositionTotals(): Promise<Map<string, number>> {
  const index = await loadSourcesIndex();
  const totals = new Map<string, number>();
  for (const s of index?.sources ?? []) {
    for (const [d, n] of Object.entries(s.dispositionTotals ?? {})) {
      totals.set(d, (totals.get(d) ?? 0) + n);
    }
  }
  return totals;
}

/** One row of a source's candidates artifact (sources/<id>-candidates.json). */
export interface Candidate {
  stationuuid?: string;
  name?: string;
  country?: string;
  votes?: number;
  clickcount?: number;
  verdict?: string | null;
  /** Stamped by build-sources: imported | available | duplicate | broken | unprobed. */
  disposition?: string;
  duplicateOf?: string | null;
  duplicateOfName?: string | null;
  duplicateVia?: string | null;
  matchedCatalogId?: string | null;
  streamHost?: string;
  streamUrl?: string | null;
  /** URL the playability probe actually played, when it differs from the
   *  record URL — e.g. the verified https upgrade of an http record. */
  playableUrl?: string | null;
  homepage?: string | null;
  favicon?: string | null;
  /** Source id, attached at load time. */
  sourceId: string;
}

/** Every candidate across all sources. Heavy (the RB artifact is multi-MB) —
 *  only awaited by views that actually list candidates. */
export const loadAllCandidates = memo(async (): Promise<Candidate[]> => {
  const index = await loadSourcesIndex();
  const ids = (index?.sources ?? []).map((s) => s.id);
  const lists = await Promise.all(
    ids.map(async (id) => {
      try {
        const raw = await getJson<{ candidates?: Omit<Candidate, 'sourceId'>[] }>(`sources/${id}-candidates.json`);
        return (raw.candidates ?? []).map((c) => ({ ...c, sourceId: id }));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
});

const loadSourceMap = memo(async (): Promise<CatalogSourceMap | null> => {
  try {
    return await getJson<CatalogSourceMap>('sources/catalog-source-map.json');
  } catch {
    return null;
  }
});

/** Merged per-station rows — the working set for Stations + detail views.
 *  Note: the logo-status artifact only carries *actionable* rows; stations
 *  missing from it have a healthy/curated logo (see tools/logo-status.mjs). */
export const loadRows = memo(async (): Promise<StationRow[]> => {
  const [catalog, health, logoReport, sourceMap] = await Promise.all([
    loadCatalog(),
    loadHealth(),
    loadLogoStatus(),
    loadSourceMap(),
  ]);
  const logoById = new Map((logoReport?.stations ?? []).map((r) => [r.id, r]));
  const rows: StationRow[] = [];
  for (const station of catalog) {
    const facets = health?.stations[station.id] ?? {};
    const source = sourceMap ? (sourceMap.overrides?.[station.id] ?? sourceMap.defaultSource) : undefined;
    let badCount = 0;
    let warnCount = 0;
    let lastChange = '';
    for (const facet of FACETS) {
      const f = facets[facet];
      if (!f) continue;
      if (f.v === 'bad') badCount += 1;
      else if (f.v === 'warn') warnCount += 1;
      if (f.since > lastChange) lastChange = f.since;
    }
    rows.push({ station, facets, logo: logoById.get(station.id), source, badCount, warnCount, lastChange });
  }
  return rows;
});

export const loadRowById = memo(async (): Promise<Map<string, StationRow>> => {
  const rows = await loadRows();
  return new Map(rows.map((r) => [r.station.id, r]));
});

/** Duplicate groups indexed by member station id. */
export const loadDuplicateGroupsById = memo(async (): Promise<Map<string, DuplicateGroup[]>> => {
  const report = await loadDuplicates();
  const map = new Map<string, DuplicateGroup[]>();
  for (const g of report?.duplicateGroups ?? []) {
    for (const e of g.entries) {
      const list = map.get(e.id) ?? [];
      list.push(g);
      map.set(e.id, list);
    }
  }
  return map;
});

/** Drift entries indexed by station id. */
export const loadDriftById = memo(async (): Promise<Map<string, DriftEntry>> => {
  const report = await loadDrift();
  return new Map((report?.drift ?? []).map((d) => [d.id, d]));
});
