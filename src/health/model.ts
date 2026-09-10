/**
 * Catalog-health page model: parse the dashboard artifact, filter/sort its
 * rows, and round-trip the filter state through URL search params so a
 * filtered view is a shareable link. Pure — no DOM, fully unit-tested.
 *
 * Artifact contract: tools/lib/health-dashboard.mjs (COLS). Rows are read
 * by column name via the `cols` header, never by position.
 */

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

export interface Dashboard {
  version: number;
  generatedAt: string;
  counts: { published: number; curated: number; longTail: number; countries: number };
  runs: Record<string, string>;
  metrics: DashboardMetrics | null;
  history: HistoryPoint[];
  rows: HealthRow[];
}

interface RawDashboard {
  version?: number;
  generatedAt?: string;
  counts?: Partial<Dashboard['counts']>;
  runs?: Record<string, string>;
  metrics?: DashboardMetrics | null;
  history?: HistoryPoint[];
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
    rows,
  };
}

/* ── Filters ─────────────────────────────────────────────────────── */

export type StreamFilter = 'all' | 'ok' | 'warn' | 'bad' | 'unobserved';
export type NpFilter = 'all' | NowPlaying;
export type FacetFilter = 'all' | 'ok' | 'warn' | 'bad';
export type SortKey = 'name' | 'country' | 'stream' | 'since' | 'checked';

export interface Filters {
  q: string;
  cc: string;
  tier: 'all' | Tier;
  status: string;
  stream: StreamFilter;
  np: NpFilter;
  logo: FacetFilter;
  home: FacetFilter;
  problems: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Readonly<Filters> = Object.freeze({
  q: '',
  cc: 'all',
  tier: 'all',
  status: 'all',
  stream: 'all',
  np: 'all',
  logo: 'all',
  home: 'all',
  problems: false,
  sort: 'name',
});

/** "Problem" = something a listener would notice or a curator would fix:
 *  the stream not answering with audio, a dead homepage, or no usable logo. */
export function hasProblem(row: HealthRow): boolean {
  return row.stream === 'bad' || row.stream === 'warn' || row.logo === 'bad' || row.home === 'bad';
}

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
    if (f.tier !== 'all' && r.tier !== f.tier) return false;
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.stream !== 'all') {
      if (f.stream === 'unobserved' ? r.stream !== '' : r.stream !== f.stream) return false;
    }
    if (f.np !== 'all' && r.np !== f.np) return false;
    if (f.logo !== 'all' && r.logo !== f.logo) return false;
    if (f.home !== 'all' && r.home !== f.home) return false;
    if (f.problems && !hasProblem(r)) return false;
    return matchesQuery(r, q);
  });
}

const STREAM_RANK: Record<Verdict, number> = { bad: 0, warn: 1, '': 2, na: 3, ok: 4 };

// One collator instead of localeCompare per pair: 31k rows sort in tens of
// milliseconds rather than seconds.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function byName(a: HealthRow, b: HealthRow): number {
  return collator.compare(a.name, b.name) || collator.compare(a.id, b.id);
}

export function sortRows(rows: HealthRow[], sort: SortKey): HealthRow[] {
  const out = [...rows];
  switch (sort) {
    case 'country':
      out.sort((a, b) => collator.compare(a.cc, b.cc) || byName(a, b));
      break;
    case 'stream':
      // Worst first: failing streams, longest streak on top, then warn, then ok.
      out.sort(
        (a, b) =>
          STREAM_RANK[a.stream] - STREAM_RANK[b.stream] ||
          b.streakDays - a.streakDays ||
          byName(a, b),
      );
      break;
    case 'since':
      out.sort((a, b) => b.streamSince.localeCompare(a.streamSince) || byName(a, b));
      break;
    case 'checked':
      out.sort((a, b) => b.checked.localeCompare(a.checked) || byName(a, b));
      break;
    default:
      out.sort(byName);
  }
  return out;
}

/* ── Aggregates for the tiles and the result line ────────────────── */

export interface VerdictTally {
  ok: number;
  warn: number;
  bad: number;
  na: number;
  unobserved: number;
}

export function tally(rows: HealthRow[], facet: 'stream' | 'logo' | 'home'): VerdictTally {
  const t: VerdictTally = { ok: 0, warn: 0, bad: 0, na: 0, unobserved: 0 };
  for (const r of rows) {
    const v = r[facet];
    if (v === '') t.unobserved += 1;
    else t[v] += 1;
  }
  return t;
}

export function countBy<K extends string>(rows: HealthRow[], pick: (r: HealthRow) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const r of rows) {
    const k = pick(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/* ── URL state ───────────────────────────────────────────────────── */

const SORT_KEYS: SortKey[] = ['name', 'country', 'stream', 'since', 'checked'];
const STREAM_KEYS: StreamFilter[] = ['all', 'ok', 'warn', 'bad', 'unobserved'];
const NP_KEYS: NpFilter[] = ['all', 'api', 'icy', 'silent', 'hls', 'none'];
const FACET_KEYS: FacetFilter[] = ['all', 'ok', 'warn', 'bad'];

function oneOf<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function filtersFromParams(params: URLSearchParams): Filters {
  const tier = params.get('tier');
  return {
    q: params.get('q') ?? '',
    cc: (params.get('cc') ?? 'all').toUpperCase() === 'ALL' ? 'all' : (params.get('cc') ?? 'all').toUpperCase(),
    tier: tier === 'curated' || tier === 'long-tail' ? tier : 'all',
    status: params.get('status') ?? 'all',
    stream: oneOf(params.get('stream'), STREAM_KEYS, 'all'),
    np: oneOf(params.get('np'), NP_KEYS, 'all'),
    logo: oneOf(params.get('logo'), FACET_KEYS, 'all'),
    home: oneOf(params.get('home'), FACET_KEYS, 'all'),
    problems: params.get('problems') === '1',
    sort: oneOf(params.get('sort'), SORT_KEYS, 'name'),
  };
}

/** Only non-default values are written, so the bare URL stays bare. */
export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.cc !== 'all') p.set('cc', f.cc.toUpperCase());
  if (f.tier !== 'all') p.set('tier', f.tier);
  if (f.status !== 'all') p.set('status', f.status);
  if (f.stream !== 'all') p.set('stream', f.stream);
  if (f.np !== 'all') p.set('np', f.np);
  if (f.logo !== 'all') p.set('logo', f.logo);
  if (f.home !== 'all') p.set('home', f.home);
  if (f.problems) p.set('problems', '1');
  if (f.sort !== 'name') p.set('sort', f.sort);
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

export const STATUS_LABEL: Record<string, string> = {
  working: 'Working',
  'icy-only': 'ICY only',
  'stream-only': 'Stream only',
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
