/**
 * Catalog-health page model: parse the dashboard artifact into typed rows,
 * plus the display labels shared by the table and charts. Pure — no DOM.
 *
 * Grades live in score.ts, filters and sort in filters.ts, chart counts in
 * aggregate.ts.
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
