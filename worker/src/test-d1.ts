/**
 * Minimal in-memory D1 stand-in for the worker tests. Dispatches on
 * statement identity — the SQL constants exported from reports.ts —
 * so an edited statement fails loudly here instead of silently
 * matching a stale string pattern. Test-only; never imported from the
 * deployed entry point.
 */
import { SQL } from './reports';

export interface FakeReportRow {
  id: string;
  station_id: string;
  station_name: string;
  stream_host: string;
  category: string;
  comment: string;
  platform: string;
  app_version: string;
  reason: string;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  github_issue: number | null;
}

interface FakeResult {
  results: unknown[];
  success: true;
  meta: { changes: number };
}

export class FakeD1 {
  reports = new Map<string, FakeReportRow>();
  /** `${ip_hash}|${day}` → count */
  rate = new Map<string, number>();
  /** Simulates a D1 outage on the report INSERT path. */
  failInserts = false;

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(stmts: FakeStatement[]): Promise<FakeResult[]> {
    const out: FakeResult[] = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

export class FakeStatement {
  private binds: unknown[] = [];

  constructor(
    private readonly db: FakeD1,
    private readonly sql: string,
  ) {}

  bind(...args: unknown[]): this {
    this.binds = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const { results } = await this.run();
    return (results[0] as T) ?? null;
  }

  async all(): Promise<FakeResult> {
    return this.run();
  }

  async run(): Promise<FakeResult> {
    const db = this.db;
    const b = this.binds;
    const result = (results: unknown[] = [], changes = 0): FakeResult => ({
      results,
      success: true,
      meta: { changes },
    });

    switch (this.sql) {
      case SQL.insertReport: {
        if (db.failInserts) throw new Error('D1 unavailable');
        const [id, stationId, stationName, streamHost, category, comment, platform, appVersion, reason, createdAt] =
          b as string[];
        db.reports.set(id, {
          id,
          station_id: stationId,
          station_name: stationName,
          stream_host: streamHost,
          category,
          comment,
          platform,
          app_version: appVersion,
          reason,
          status: 'received',
          resolution: null,
          created_at: createdAt,
          resolved_at: null,
          github_issue: null,
        });
        return result([], 1);
      }

      case SQL.upsertRate: {
        const [hash, day] = b as string[];
        const key = `${hash}|${day}`;
        const count = (db.rate.get(key) ?? 0) + 1;
        db.rate.set(key, count);
        return result([{ count }], 1);
      }

      case SQL.purgeRate: {
        const [day] = b as string[];
        let changes = 0;
        for (const key of [...db.rate.keys()]) {
          if (key.split('|')[1] < day) {
            db.rate.delete(key);
            changes++;
          }
        }
        return result([], changes);
      }

      case SQL.selectStatus: {
        const [id] = b as string[];
        const row = db.reports.get(id);
        return result(
          row
            ? [{ id: row.id, status: row.status, resolution: row.resolution, resolved_at: row.resolved_at }]
            : [],
        );
      }

      case SQL.resolveById:
      case SQL.resolveByStation:
      case SQL.resolveByStationCategory:
      case SQL.resolveByIssue: {
        const [resolution, resolvedAt, ghIssue, ...rest] = b as [string, string, number | null, ...unknown[]];
        const matches = (row: FakeReportRow): boolean => {
          if (row.status === 'resolved') return false;
          if (this.sql === SQL.resolveById) return row.id === rest[0];
          if (this.sql === SQL.resolveByStation) return row.station_id === rest[0];
          if (this.sql === SQL.resolveByStationCategory) {
            return row.station_id === rest[0] && row.category === rest[1];
          }
          return row.github_issue === rest[0];
        };
        let changes = 0;
        for (const row of db.reports.values()) {
          if (!matches(row)) continue;
          row.status = 'resolved';
          row.resolution = resolution;
          row.resolved_at = resolvedAt;
          row.github_issue = ghIssue ?? row.github_issue;
          changes++;
        }
        return result([], changes);
      }

      case SQL.selectRecent:
      case SQL.selectRecentByStatus: {
        const byStatus = this.sql === SQL.selectRecentByStatus;
        const status = byStatus ? (b[0] as string) : null;
        const limit = (byStatus ? b[1] : b[0]) as number;
        const rows = [...db.reports.values()]
          .filter((r) => !status || r.status === status)
          .sort((a, z) => z.created_at.localeCompare(a.created_at))
          .slice(0, limit);
        return result(rows.map((r) => ({ ...r })));
      }

      default:
        throw new Error(`FakeD1: unrecognized statement: ${this.sql}`);
    }
  }
}
