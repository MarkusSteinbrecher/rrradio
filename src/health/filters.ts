/**
 * Dashboard filters: one state object drives every tile, chart and the
 * table. Each chart counts the rows that pass every filter *except its
 * own* (crossfilter), so picking a country still shows the other
 * countries — the pick is highlighted, not the only bar left.
 *
 * State round-trips through URL search params, so any view is a link.
 * Pure — no DOM.
 */

import type { HealthRow, NowPlaying, Tier } from './model';
import { grade, type Dimension, type Grade } from './score';

export type GradePick = Exclude<Grade, 'skip'> | 'all';

/** Why a stream doesn't play, folded from the probe's detail string. */
export type Reason = 'not-found' | 'blocked' | 'server' | 'timeout' | 'network' | 'tls' | 'odd' | 'other';
export const REASONS: readonly Reason[] = ['network', 'timeout', 'not-found', 'blocked', 'server', 'tls', 'odd', 'other'];
export const REASON_LABEL: Record<Reason, string> = {
  network: 'Network error',
  timeout: 'Timeout',
  'not-found': 'Not found (404)',
  blocked: 'Blocked (401/403)',
  server: 'Server error (5xx)',
  tls: 'TLS error',
  odd: 'Not audio',
  other: 'Other',
};

/** Why a logo isn't good, folded from the logo probe's detail. */
export type LogoIssue = 'missing' | 'small' | 'dead' | 'third-party' | 'not-image' | 'generic' | 'non-free' | 'other';
export const LOGO_ISSUES: readonly LogoIssue[] = ['missing', 'small', 'dead', 'third-party', 'not-image', 'generic', 'non-free', 'other'];
export const LOGO_ISSUE_LABEL: Record<LogoIssue, string> = {
  missing: 'Missing',
  small: 'Too small',
  dead: 'Dead link',
  'third-party': 'Third-party',
  'not-image': 'Not an image',
  generic: 'Generic icon',
  'non-free': 'Non-free',
  other: 'Other',
};

export const NP_KINDS: readonly Exclude<NowPlaying, ''>[] = ['api', 'icy', 'silent', 'hls', 'none'];

export type SortKey = 'default' | 'name' | 'country' | 'stream' | 'streak';
export type SortDir = 'asc' | 'desc';

export interface Filters {
  q: string;
  cc: string;
  tier: Tier | 'all';
  stream: GradePick;
  why: Reason | 'all';
  np: NowPlaying | 'all';
  logo: GradePick;
  logoWhy: LogoIssue | 'all';
  home: GradePick;
  sort: SortKey;
  dir: SortDir;
}

/** The filters a chart or tile can own (everything but search and sort). */
export type FilterKey = 'cc' | 'tier' | 'stream' | 'why' | 'np' | 'logo' | 'logoWhy' | 'home';
export const FILTER_KEYS: readonly FilterKey[] = ['cc', 'tier', 'stream', 'why', 'np', 'logo', 'logoWhy', 'home'];

export const DEFAULT_FILTERS: Readonly<Filters> = Object.freeze({
  q: '',
  cc: 'all',
  tier: 'all',
  stream: 'all',
  why: 'all',
  np: 'all',
  logo: 'all',
  logoWhy: 'all',
  home: 'all',
  sort: 'default',
  dir: 'asc',
});

export function failReason(row: HealthRow): Reason | '' {
  if (row.stream === 'warn') return 'odd';
  if (row.stream !== 'bad') return '';
  const d = row.streamDetail.toLowerCase();
  const http = /http (\d{3})/.exec(d);
  if (http) {
    const code = Number(http[1]);
    if (code === 404 || code === 410) return 'not-found';
    if (code === 401 || code === 403 || code === 451) return 'blocked';
    if (code >= 500) return 'server';
    return 'other';
  }
  if (d.includes('timeout')) return 'timeout';
  if (d.includes('tls')) return 'tls';
  if (/network|refused|reset|dns/.test(d)) return 'network';
  return 'other';
}

export function logoIssue(row: HealthRow): LogoIssue | '' {
  if (row.logo !== 'warn' && row.logo !== 'bad') return '';
  const d = row.logoDetail;
  if (d === 'missing') return 'missing';
  if (d === 'poor' || d === 'poor-quality' || d === 'weak') return 'small';
  if (d === 'third-party') return 'third-party';
  if (d === 'not-image') return 'not-image';
  if (d === 'generic') return 'generic';
  if (d === 'non-free-wiki') return 'non-free';
  if (/^HTTP \d|timeout|network|tls|dns|refused|reset|dead|probe-error/.test(d)) return 'dead';
  return 'other';
}

function pickGrade(row: HealthRow, dim: Dimension, pick: GradePick): boolean {
  return pick === 'all' || grade(row, dim) === pick;
}

/** Whitespace-insensitive contains ("WDR5" finds "WDR 5"), like the app. */
function matchesQuery(row: HealthRow, q: string): boolean {
  if (!q) return true;
  if (row.haystack.includes(q)) return true;
  const squashed = q.replace(/\s+/g, '');
  return squashed.length > 0 && row.haystack.replace(/\s+/g, '').includes(squashed);
}

/** Rows passing every filter; `except` leaves one filter out (crossfilter). */
export function filterRows(rows: readonly HealthRow[], f: Filters, except?: FilterKey): HealthRow[] {
  const q = f.q.trim().toLowerCase();
  const on = (k: FilterKey): boolean => k !== except;
  return rows.filter(
    (r) =>
      (!on('cc') || f.cc === 'all' || r.cc === f.cc) &&
      (!on('tier') || f.tier === 'all' || r.tier === f.tier) &&
      (!on('stream') || pickGrade(r, 'stream', f.stream)) &&
      (!on('why') || f.why === 'all' || failReason(r) === f.why) &&
      (!on('np') || f.np === 'all' || r.np === f.np) &&
      (!on('logo') || pickGrade(r, 'logo', f.logo)) &&
      (!on('logoWhy') || f.logoWhy === 'all' || logoIssue(r) === f.logoWhy) &&
      (!on('home') || pickGrade(r, 'home', f.home)) &&
      matchesQuery(r, q),
  );
}

/** Clicking the active pick again clears it. */
export function toggle<K extends FilterKey>(f: Filters, key: K, value: Filters[K]): Filters {
  return { ...f, [key]: f[key] === value ? DEFAULT_FILTERS[key] : value };
}

export function activeFilters(f: Filters): FilterKey[] {
  return FILTER_KEYS.filter((k) => f[k] !== DEFAULT_FILTERS[k]);
}

/* ── Sort ────────────────────────────────────────────────────────── */

// One collator instead of localeCompare per pair: 29k rows sort in tens of
// milliseconds rather than seconds.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Radio Browser names like "__1oldies" sort after real names. */
function sortName(name: string): string {
  return /^[\p{L}\p{N}]/u.test(name) ? name : `\u{10FFFF}${name}`;
}
function byName(a: HealthRow, b: HealthRow): number {
  return collator.compare(sortName(a.name), sortName(b.name)) || collator.compare(a.id, b.id);
}
const STREAM_RANK: Record<string, number> = { bad: 0, warn: 1, '': 2, na: 2, ok: 3 };

export function sortRows(rows: readonly HealthRow[], key: SortKey, dir: SortDir): HealthRow[] {
  const out = [...rows];
  const sign = dir === 'desc' ? -1 : 1;
  const tier = (r: HealthRow): number => (r.tier === 'curated' ? 0 : 1);
  const cmp: Record<SortKey, (a: HealthRow, b: HealthRow) => number> = {
    // Curated first, then failing longest, then by name.
    default: (a, b) => tier(a) - tier(b) || STREAM_RANK[a.stream] - STREAM_RANK[b.stream] || b.streakDays - a.streakDays || byName(a, b),
    name: (a, b) => sign * byName(a, b),
    country: (a, b) => sign * collator.compare(a.cc || '\u{10FFFF}', b.cc || '\u{10FFFF}') || byName(a, b),
    stream: (a, b) => sign * (STREAM_RANK[a.stream] - STREAM_RANK[b.stream]) || b.streakDays - a.streakDays || byName(a, b),
    streak: (a, b) => sign * (b.streakDays - a.streakDays) || byName(a, b),
  };
  return out.sort(cmp[key]);
}

/* ── URL state ───────────────────────────────────────────────────── */

const GRADES: readonly GradePick[] = ['all', 'good', 'weak', 'bad'];
const SORTS: readonly SortKey[] = ['default', 'name', 'country', 'stream', 'streak'];

function oneOf<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function filtersFromParams(p: URLSearchParams): Filters {
  const cc = (p.get('cc') ?? '').toUpperCase();
  return {
    q: p.get('q') ?? '',
    cc: /^[A-Z]{2}$/.test(cc) ? cc : 'all',
    tier: oneOf(p.get('tier'), ['all', 'curated', 'long-tail'] as const, 'all'),
    stream: oneOf(p.get('stream'), GRADES, 'all'),
    why: oneOf(p.get('why'), ['all', ...REASONS] as const, 'all'),
    np: oneOf(p.get('np'), ['all', ...NP_KINDS] as const, 'all'),
    logo: oneOf(p.get('logo'), GRADES, 'all'),
    logoWhy: oneOf(p.get('logoWhy'), ['all', ...LOGO_ISSUES] as const, 'all'),
    home: oneOf(p.get('home'), GRADES, 'all'),
    sort: oneOf(p.get('sort'), SORTS, 'default'),
    dir: oneOf(p.get('dir'), ['asc', 'desc'] as const, 'asc'),
  };
}

/** Only non-default values are written, so the bare URL stays bare. */
export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  for (const k of FILTER_KEYS) if (f[k] !== DEFAULT_FILTERS[k]) p.set(k, String(f[k]));
  if (f.sort !== 'default') {
    p.set('sort', f.sort);
    if (f.dir !== 'asc') p.set('dir', f.dir);
  }
  return p;
}
