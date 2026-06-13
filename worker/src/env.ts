/**
 * Worker bindings. Vars come from wrangler.toml [vars]; secrets
 * (GOATCOUNTER_TOKEN, ADMIN_TOKEN) via `wrangler secret put`; DB is
 * the D1 database declared in [[d1_databases]].
 */
export interface Env {
  GOATCOUNTER_SITE: string;
  GOATCOUNTER_TOKEN: string;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGIN: string;
  DB: D1Database;
}
