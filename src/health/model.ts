/**
 * Catalog-health page model: parse the dashboard artifact, filter/sort its
 * rows for the station lookup, and round-trip the filter state through URL search params so a
 * filtered view is a shareable link. Pure — no DOM, fully unit-tested.
 *
 * Grades live in score.ts.
 *
 * Artifact contract: tools/lib/health-dashboard.mjs (COLS). Rows are read
 * by column name via the `cols` header, never by position.
 */

import { DIMENSIONS, grade, needsAttention, problemRank, type Dimension } from './score';

export type Verdict = 'ok' | 'warn' | 'bad' | 'na' | '';
export type Tier = 'curated' | 'long-tail';
export type NowPlaying = 'api' | 'icy' | 'silent' | 'hls' | 'none' | '';

export interface HealthRow {
  id: string;
  name: string;
  cc: string;
  tier: Tier;
  status: string;
  stream: Verdict;
  streamDetail: string;
  streamSince: string;
  streakDays: number;
  streakClass: 'hard' | 'soft' | '';
  checked: string;
  np: NowPlaying;
  logo: Verdict;
  logoDetail: string;
  home: Verdict;
  /** Lower-cased search haystack, built once. */
  haystack: string;
}

export interface HistoryPoint {
  day: string;
  published: number | null;
  availability: number | null;
  freshness: number | null;
  ok: number | null;
  warn: number | null;
  bad: number | null;
  hard: number | null;
  soft: number | null;
  hotBad: number | null;
}

export interface DashboardMetrics {
  at?: string;
  published?: number;
  observed7d?: number;
  freshness?: number | null;
  plays7d?: number;
  availability?: number | null;
  stream?: { ok: number; warn: number; bad: number; hard: number; soft: number };
  hotSet?: { size: number; bad: number };
}

/** One day of the catalog-actions loop (tools/lib/health-dashboard.mjs). */
export interface AutomationPoint {
  day: string;
  retired: number;
  recovered: number;
  urlSwapped: number;
  logoCleared: number;
  logoUpgraded: number;
  review: number;
  held: boolean;
}

export interface Dashboard {
  version: number;
  generatedAt: string;
  counts: { published: number; curated: number; longTail: number; countries: number };
  runs: Record<string, string>;
  metrics: DashboardMetrics | null;
  history: HistoryPoint[];
  automation: AutomationPoint[];
  rows: HealthRow[];
}

interface RawDashboard {
  version?: number;
  generatedAt?: string;
  counts?: Partial<Dashboard['counts']>;
  runs?: Record<string, string>;
  metrics?: DashboardMetrics | null;
  history?: HistoryPoint[];
  automation?: AutomationPoint[];
  cols?: string[];
  rows?: unknown[][];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function verdict(v: unknown): Verdict {
  return v === 'ok' || v === 'warn' || v === 'bad' || v === 'na' ? v : '';
}

/** Parse the fetched JSON into typed rows. Unknown columns are ignored,
 *  missing ones read as empty — an older cached page survives a newer
 *  artifact and vice versa. */
export function parseDashboard(raw: RawDashboard): Dashboard {
  const cols = raw.cols ?? [];
  const at = (name: string): number => cols.indexOf(name);
  const ix = {
    id: at('id'), name: at('name'), cc: at('cc'), tier: at('tier'), status: at('status'),
    stream: at('stream'), streamDetail: at('streamDetail'), streamSince: at('streamSince'),
    streakDays: at('streakDays'), streakClass: at('streakClass'), checked: at('checked'),
    np: at('np'), logo: at('logo'), logoDetail: at('logoDetail'), home: at('home'),
  };
  const get = (r: unknown[], i: number): unknown => (i < 0 ? undefined : r[i]);
  const rows: HealthRow[] = [];
  for (const r of raw.rows ?? []) {
    if (!Array.isArray(r)) continue;
    const id = str(get(r, ix.id));
    if (!id) continue;
    const name = str(get(r, ix.name)).replace(/\s+/g, ' ').trim() || id;
    const cc = str(get(r, ix.cc)).toUpperCase();
    const tierRaw = get(r, ix.tier);
    const npRaw = get(r, ix.np);
    const streakRaw = get(r, ix.streakClass);
    const days = get(r, ix.streakDays);
    rows.push({
      id,
      name,
      cc,
      tier: tierRaw === 'curated' ? 'curated' : 'long-tail',
      status: str(get(r, ix.status)),
      stream: verdict(get(r, ix.stream)),
      streamDetail: str(get(r, ix.streamDetail)),
      streamSince: str(get(r, ix.streamSince)),
      streakDays: typeof days === 'number' && days > 0 ? days : 0,
      streakClass: streakRaw === 'hard' || streakRaw === 'soft' ? streakRaw : '',
      checked: str(get(r, ix.checked)),
      np: npRaw === 'api' || npRaw === 'icy' || npRaw === 'silent' || npRaw === 'hls' || npRaw === 'none' ? npRaw : '',
      logo: verdict(get(r, ix.logo)),
      logoDetail: str(get(r, ix.logoDetail)),
      home: verdict(get(r, ix.home)),
      haystack: `${name} ${id} ${cc}`.toLowerCase(),
    });
  }
  return {
    version: raw.version ?? 0,
    generatedAt: raw.generatedAt ?? '',
    counts: {
      published: raw.counts?.published ?? rows.length,
      curated: raw.counts?.curated ?? rows.filter((r) => r.tier === 'curated').length,
      longTail: raw.counts?.longTail ?? rows.filter((r) => r.tier === 'long-tail').length,
      countries: raw.counts?.countries ?? new Set(rows.map((r) => r.cc).filter(Boolean)).size,
    },
    runs: raw.runs ?? {},
    metrics: raw.metrics ?? null,
    history: Array.isArray(raw.history) ? raw.history : [],
    automation: Array.isArray(raw.automation) ? raw.automation : [],
    rows,
  };
}

/* ── Station lookup: filters, sort, URL state ────────────────────── */

export type View = 'all' | 'curated' | 'attention';
export type SortKey = 'curated' | 'problems' | 'name';
export type FacetKey = Dimension | '';
export type FacetLevel = 'weak' | 'bad' | '';

export interface Filters {
  q: string;
  cc: string;
  view: View;
  /** Set by the score breakdown: "show me the stations failing this". */
  facet: FacetKey;
  level: FacetLevel;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Readonly<Filters> = Object.freeze({
  q: '',
  cc: 'all',
  view: 'all',
  facet: '',
  level: '',
  sort: 'curated',
});

/** Whitespace-insensitive contains (the app's search behaves the same:
 *  "WDR5" finds "WDR 5"). */
function matchesQuery(row: HealthRow, q: string): boolean {
  if (!q) return true;
  if (row.haystack.includes(q)) return true;
  const squashed = q.replace(/\s+/g, '');
  return squashed.length > 0 && row.haystack.replace(/\s+/g, '').includes(squashed);
}

export function filterRows(rows: HealthRow[], f: Filters): HealthRow[] {
  const q = f.q.trim().toLowerCase();
  const cc = f.cc.toUpperCase();
  return rows.filter((r) => {
    if (cc !== 'ALL' && r.cc !== cc) return false;
    if (f.view === 'curated' && r.tier !== 'curated') return false;
    if (f.view === 'attention' && !needsAttention(r)) return false;
    if (f.facet) {
      const g = grade(r, f.facet);
      if (f.level ? g !== f.level : g !== 'weak' && g !== 'bad') return false;
    }
    return matchesQuery(r, q);
  });
}

// One collator instead of localeCompare per pair: 29k rows sort in tens of
// milliseconds rather than seconds.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Radio Browser names like "__1oldies" or "#1 Hits" sort after real
 *  names, so an unfiltered list doesn't open on punctuation. */
function sortName(name: string): string {
  return /^[\p{L}\p{N}]/u.test(name) ? name : `\u{10FFFF}${name}`;
}

function byName(a: HealthRow, b: HealthRow): number {
  return collator.compare(sortName(a.name), sortName(b.name)) || collator.compare(a.id, b.id);
}

export function sortRows(rows: HealthRow[], sort: SortKey): HealthRow[] {
  const out = [...rows];
  const rank = new Map(out.map((r) => [r, problemRank(r)]));
  const tier = (r: HealthRow): number => (r.tier === 'curated' ? 0 : 1);
  switch (sort) {
    case 'problems':
      // Not playing first (longest streak on top), then the barest extras.
      out.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0) || b.streakDays - a.streakDays || byName(a, b));
      break;
    case 'name':
      out.sort(byName);
      break;
    default:
      out.sort((a, b) => tier(a) - tier(b) || byName(a, b));
  }
  return out;
}

const VIEWS: View[] = ['all', 'curated', 'attention'];
const SORT_KEYS: SortKey[] = ['curated', 'problems', 'name'];
const FACETS: FacetKey[] = ['', ...DIMENSIONS];
const LEVELS: FacetLevel[] = ['', 'weak', 'bad'];

function oneOf<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function filtersFromParams(params: URLSearchParams): Filters {
  const cc = (params.get('cc') ?? 'all').toUpperCase();
  const facet = oneOf(params.get('facet'), FACETS, '');
  return {
    q: params.get('q') ?? '',
    cc: cc === 'ALL' ? 'all' : cc,
    view: oneOf(params.get('view'), VIEWS, 'all'),
    facet,
    level: facet ? oneOf(params.get('level'), LEVELS, '') : '',
    sort: oneOf(params.get('sort'), SORT_KEYS, 'curated'),
  };
}

/** Only non-default values are written, so the bare URL stays bare. */
export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.cc !== 'all') p.set('cc', f.cc.toUpperCase());
  if (f.view !== 'all') p.set('view', f.view);
  if (f.facet) {
    p.set('facet', f.facet);
    if (f.level) p.set('level', f.level);
  }
  if (f.sort !== 'curated') p.set('sort', f.sort);
  return p;
}

export function isDefaultFilters(f: Filters): boolean {
  return filtersToParams(f).toString() === '';
}

/* ── Labels (shared by table cells, selects, legend) ─────────────── */

export const NP_LABEL: Record<NowPlaying, string> = {
  api: 'Broadcaster API',
  icy: 'Stream titles',
  silent: 'Titles advertised, none seen',
  hls: 'HLS manifest',
  none: 'None',
  '': 'Not checked',
};

/** Short, plain-language stream detail for the table. Content types read
 *  as the codec family; failures keep the probe's stable vocabulary. */
export function streamDetailLabel(row: HealthRow): string {
  const d = row.streamDetail;
  if (row.stream === 'ok') {
    if (/mpegurl/.test(d)) return 'HLS';
    if (/aac/.test(d)) return 'AAC';
    if (/mpeg|mp3/.test(d)) return 'MP3';
    if (/ogg|opus/.test(d)) return 'Ogg';
    if (/flac/.test(d)) return 'FLAC';
    return d ? d.split(';')[0] : 'Playing';
  }
  if (row.stream === 'warn') return d.replace(/^content-type\s*/i, '').replace(/"/g, '') || 'Unexpected reply';
  if (row.stream === 'bad') return d || 'Failing';
  if (row.stream === 'na') return 'n/a';
  return 'Not checked yet';
}

export function logoDetailLabel(row: HealthRow): string {
  const map: Record<string, string> = {
    curated: 'Curated',
    'good-remote': 'Good',
    remote: 'Remote',
    'poor-quality': 'Low quality',
    weak: 'Weak',
    'third-party': 'Third-party',
    'unknown-quality': 'Unverified',
    'non-free-wiki': 'Non-free',
    missing: 'Missing',
    http: 'HTTP only',
    'probe-error': 'Unreachable',
    generic: 'Generic',
    dead: 'Dead',
    // Phase 3 probe vocabulary (tools/lib/logo-probe.mjs).
    good: 'Good',
    acceptable: 'Good',
    vector: 'Vector',
    poor: 'Too small',
    unknown: 'Unreadable',
    'not-image': 'Not an image',
    'unsupported-scheme': 'Bad URL',
    timeout: 'Timeout',
    dns: 'DNS failure',
    refused: 'Refused',
    reset: 'Connection reset',
    tls: 'TLS error',
    network: 'Network error',
  };
  if (row.logo === '') return 'Not checked';
  return map[row.logoDetail] ?? row.logoDetail ?? row.logo;
}
