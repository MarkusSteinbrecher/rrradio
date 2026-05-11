import { describe, expect, it } from 'vitest';
import {
  buildStationDashboardRows,
  filterStationDashboardRows,
  stationDashboardKpis,
  type StationStatusReport,
} from './station-dashboard';
import type { Station } from './types';

const catalog: Station[] = [
  {
    id: 'fm4',
    name: 'FM4',
    streamUrl: 'https://x/fm4',
    country: 'AT',
    status: 'working',
    metadata: 'orf',
  },
  {
    id: 'grrif',
    name: 'Grrif',
    streamUrl: 'https://x/grrif',
    country: 'CH',
    status: 'icy-only',
  },
];

const report: StationStatusReport = {
  stations: [
    {
      id: 'fm4',
      name: 'FM4',
      broadcaster: 'orf',
      status: 'working',
      metadataKey: 'orf',
      checks: {
        stream: { state: 'ok' },
        https: { state: 'ok' },
        icy: { state: 'ok' },
        metadataApi: { state: 'ok' },
        fetcher: { state: 'ok' },
        program: { state: 'ok' },
        logo: { state: 'warn', detail: 'imported' },
      },
    },
    {
      id: 'grrif',
      name: 'Grrif',
      status: 'icy-only',
      checks: {
        stream: { state: 'ok' },
        https: { state: 'ok' },
        icy: { state: 'bad', detail: 'no ICY metadata' },
      },
    },
  ],
};

const curation = {
  stations: [
    {
      id: 'fm4',
      stationuuid: 'rb-fm4',
      changeuuid: 'change-fm4',
      reviewedAt: '2026-04-28',
    },
  ],
};

describe('buildStationDashboardRows', () => {
  it('joins catalog fields with status checks', () => {
    const rows = buildStationDashboardRows(catalog, report, curation);
    expect(rows[0]).toMatchObject({
      id: 'fm4',
      country: 'AT',
      broadcaster: 'orf',
      status: 'working',
      metadataKey: 'orf',
      stationuuid: 'rb-fm4',
      reviewedAt: '2026-04-28',
      warningCount: 1,
      badCount: 0,
    });
    expect(rows[1].checks.icy.detail).toBe('no ICY metadata');
    expect(rows[1].badCount).toBe(1);
  });

  it('falls back to catalog status when status report is missing', () => {
    const rows = buildStationDashboardRows(catalog, null);
    expect(rows[0].status).toBe('working');
    expect(rows[0].checks.stream.state).toBe('na');
  });
});

describe('stationDashboardKpis', () => {
  it('counts catalog health headline numbers', () => {
    const kpis = stationDashboardKpis(buildStationDashboardRows(catalog, report));
    expect(kpis).toEqual({
      total: 2,
      working: 1,
      richMetadata: 1,
      countries: 2,
      attention: 2,
    });
  });
});

describe('filterStationDashboardRows', () => {
  const rows = buildStationDashboardRows(catalog, report);

  it('filters by country and status', () => {
    expect(
      filterStationDashboardRows(rows, {
        query: '',
        country: 'AT',
        status: 'working',
        health: 'all',
      }).map((row) => row.id),
    ).toEqual(['fm4']);
  });

  it('filters by attention state and search text', () => {
    expect(
      filterStationDashboardRows(rows, {
        query: 'grr',
        country: 'all',
        status: 'all',
        health: 'attention',
      }).map((row) => row.id),
    ).toEqual(['grrif']);
  });

  it('filters by exact check state when provided', () => {
    expect(
      filterStationDashboardRows(rows, {
        query: '',
        country: 'all',
        status: 'all',
        health: 'all',
        check: 'logo',
        checkState: 'warn',
      }).map((row) => row.id),
    ).toEqual(['fm4']);
  });

  it('filters by review state', () => {
    const reviewedRows = buildStationDashboardRows(catalog, report, curation);
    expect(
      filterStationDashboardRows(reviewedRows, {
        query: '',
        country: 'all',
        status: 'all',
        health: 'all',
        review: 'reviewed',
      }).map((row) => row.id),
    ).toEqual(['fm4']);
    expect(
      filterStationDashboardRows(reviewedRows, {
        query: '',
        country: 'all',
        status: 'all',
        health: 'all',
        review: 'unreviewed',
      }).map((row) => row.id),
    ).toEqual(['grrif']);
  });
});
