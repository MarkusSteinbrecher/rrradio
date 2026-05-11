import type { Station } from './types';

export const STATION_CHECKS = [
  'stream',
  'https',
  'icy',
  'metadataApi',
  'fetcher',
  'program',
  'logo',
] as const;

export type StationCheckKey = (typeof STATION_CHECKS)[number];
export type StationCheckState = 'ok' | 'warn' | 'bad' | 'na';
export type StationHealthFilter = 'all' | 'attention' | 'working';

export interface StationStatusCheck {
  state: StationCheckState;
  detail?: string;
}

export type StationChecks = Record<StationCheckKey, StationStatusCheck>;

export interface StationStatusItem {
  id: string;
  name: string;
  broadcaster?: string;
  status?: string;
  streamUrl?: string;
  metadataUrl?: string | null;
  favicon?: string | null;
  metadataKey?: string | null;
  checks?: Partial<Record<StationCheckKey, Partial<StationStatusCheck>>>;
}

export interface StationStatusReport {
  generatedAt?: string;
  stations?: StationStatusItem[];
}

export interface StationDashboardRow {
  id: string;
  name: string;
  broadcaster?: string;
  country?: string;
  status: string;
  streamUrl: string;
  codec?: string;
  bitrate?: number;
  metadataKey?: string;
  metadataUrl?: string;
  checks: StationChecks;
  warningCount: number;
  badCount: number;
}

export interface StationDashboardKpis {
  total: number;
  working: number;
  richMetadata: number;
  countries: number;
  attention: number;
}

export interface StationDashboardFilters {
  query: string;
  country: string;
  status: string;
  health: StationHealthFilter;
}

const EMPTY_CHECK: StationStatusCheck = { state: 'na' };

function normalizeState(state: string | undefined): StationCheckState {
  return state === 'ok' || state === 'warn' || state === 'bad' || state === 'na'
    ? state
    : 'na';
}

function normalizeChecks(item: StationStatusItem | undefined): StationChecks {
  const checks = {} as StationChecks;
  for (const key of STATION_CHECKS) {
    const source = item?.checks?.[key];
    checks[key] = source
      ? { state: normalizeState(source.state), detail: source.detail }
      : EMPTY_CHECK;
  }
  return checks;
}

export function buildStationDashboardRows(
  catalog: Station[],
  report: StationStatusReport | null,
): StationDashboardRow[] {
  const statusById = new Map<string, StationStatusItem>();
  for (const item of report?.stations ?? []) {
    if (item?.id) statusById.set(item.id, item);
  }

  return catalog.map((station) => {
    const status = statusById.get(station.id);
    const checks = normalizeChecks(status);
    const values = Object.values(checks);
    const warningCount = values.filter((check) => check.state === 'warn').length;
    const badCount = values.filter((check) => check.state === 'bad').length;
    return {
      id: station.id,
      name: station.name,
      broadcaster: status?.broadcaster,
      country: station.country?.toUpperCase(),
      status: status?.status ?? station.status ?? 'unknown',
      streamUrl: station.streamUrl,
      codec: station.codec,
      bitrate: station.bitrate,
      metadataKey: status?.metadataKey ?? station.metadata,
      metadataUrl: station.metadataUrl,
      checks,
      warningCount,
      badCount,
    };
  });
}

export function stationDashboardKpis(rows: StationDashboardRow[]): StationDashboardKpis {
  const countries = new Set(rows.map((row) => row.country).filter((c): c is string => !!c));
  return {
    total: rows.length,
    working: rows.filter((row) => row.status === 'working').length,
    richMetadata: rows.filter((row) => row.checks.fetcher.state === 'ok').length,
    countries: countries.size,
    attention: rows.filter((row) => row.badCount > 0 || row.warningCount > 0).length,
  };
}

export function stationDashboardCountries(rows: StationDashboardRow[]): string[] {
  const codes = new Set(rows.map((row) => row.country).filter((c): c is string => !!c));
  return [...codes].sort();
}

export function stationDashboardStatuses(rows: StationDashboardRow[]): string[] {
  const statuses = new Set(rows.map((row) => row.status).filter(Boolean));
  return [...statuses].sort();
}

export function filterStationDashboardRows(
  rows: StationDashboardRow[],
  filters: StationDashboardFilters,
): StationDashboardRow[] {
  const query = filters.query.trim().toLowerCase();
  const country = filters.country.toUpperCase();
  return rows.filter((row) => {
    if (country !== 'ALL' && row.country !== country) return false;
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (filters.health === 'attention' && row.badCount === 0 && row.warningCount === 0) {
      return false;
    }
    if (filters.health === 'working' && row.status !== 'working') return false;
    if (!query) return true;
    const haystack = [
      row.name,
      row.id,
      row.broadcaster,
      row.country,
      row.status,
      row.metadataKey,
      row.codec,
    ]
      .filter((part): part is string => !!part)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}
