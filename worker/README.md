# rrradio-stats Worker

Cloudflare Worker that solves three problems for the rrradio app:

1. **GoatCounter token shielding** — the admin dashboard at
   `https://<host>/rrradio/dashboard.html` reads aggregated stats
   without ever seeing the GC API token. The token stays as a
   Cloudflare secret on the Worker side; the dashboard authenticates
   with a separate `ADMIN_TOKEN`.
2. **Broadcaster CORS workaround** — many now-playing JSON APIs are
   useful but don't ship `Access-Control-Allow-Origin`. A generic
   `/api/public/proxy?url=…` route with a regex allowlist gives the
   browser a safe read path without becoming an open proxy.
3. **BBC origin gating** — `rms.api.bbc.co.uk` returns 403 for any
   `Origin` header that isn't a `bbc.co.uk` subdomain. The
   `/api/public/bbc/...` routes spoof the right `Origin` server-side
   so the browser can consume the data.

The Worker is single-file (`src/index.ts`, ~460 lines). All responses
are JSON. All endpoints accept GET. All errors have shape
`{ error: string, message?: string, status?: number }`.

---

## Endpoints

### Public (no auth, CORS `*`)

| Path | Query | Returns | Cache |
| --- | --- | --- | --- |
| `/api/public/top-stations` | `days` (1–90, default 7), `limit` (1–50, default 5) | `{ items: [{ name, count }], range_days }` — top stations from `play: <name>` events | 1 h |
| `/api/public/totals` | `days` | `{ total, total_events, range_days }` — site-wide pageview + event counts | 1 h |
| `/api/public/locations` | `days`, `limit` | `{ items: [{ code, name, count }], total, range_days }` — visitor country breakdown | 1 h |
| `/api/public/proxy` | `url=<encoded>` | Forwarded JSON body of the upstream URL, **only** if the URL matches the allowlist (else 403) | 1 m |
| `/api/public/bbc/schedule/<service>` | `service` is the BBC station slug (e.g. `bbc_world_service`) | Forwarded `rms.api.bbc.co.uk` schedule JSON | 10 m |
| `/api/public/bbc/play/<service>` | same | Forwarded `rms.api.bbc.co.uk` now-playing JSON | 1 m |

`days` is clamped to `[1, 90]`. The public top-stations endpoint backs
both `tools/candidates.mjs` (curation surfacing) and the in-app stats
sheet, so its 1-hour cache is intentional — at most one upstream GC
call per hour regardless of traffic.

### Admin (`Authorization: Bearer ${ADMIN_TOKEN}`, CORS limited to `ALLOWED_ORIGIN`)

| Path | Returns |
| --- | --- |
| `/api/totals` | `{ total, total_events, range_days }` |
| `/api/top-stations` | top 20 from `play: <name>` events |
| `/api/errors` | top 20 from `error: <name>` events; `title` carries the error message |
| `/api/tabs` | counts for `tab/<browse\|fav\|recent\|playing>` |
| `/api/genres` | counts for `genre/<all\|jazz\|...>` |
| `/api/favorites` | top 20 from `favorite: <name>` events |
| `/api/locations` | top 20 visitor countries (GC `/stats/locations`) |
| `/api/browsers` | top 10 browser shares (GC `/stats/browsers`) |
| `/api/systems` | top 10 OS shares (GC `/stats/systems`) |
| `/api/debug` | raw upstream `/stats/total` body — surfaces which fields this GC account/version actually exposes |
| `/api/everything` | one call returns totals + stations + favorites + errors + tabs + genres + locations + browsers + systems. Sequential internally with 300 ms sleeps to stay under GC's 4 req/s limit. |

All admin endpoints accept `?days=N` (1–90, default 7). All responses
cache 5 min at the Cloudflare edge.

---

## The proxy allowlist

`/api/public/proxy` accepts arbitrary `url=<encoded>` values, but only
forwards URLs matching one of an in-source regex allowlist (see
`src/index.ts` around line 291). This stops the route from being a
generic open proxy.

Current allowlist (after the Phase 1 Germany work, 2026-05-02):

| Pattern | Used by |
| --- | --- |
| `^https://www\.hr[1-4]\.de/` | Hessischer Rundfunk (hr1 / hr2 / hr3 / hr4) — `fetchHrMetadata` |
| `^https://www\.br\.de/` | Bayerischer Rundfunk — `fetchBrMetadata` |
| `^https://api\.radioswiss(?:pop\|jazz\|classic)\.ch/api/v1/.../playlist_(?:small\|large)$` | Radio Swiss Pop / Jazz / Classic — `fetchRadioSwissMetadata` |
| `^https://www\.antenne\.de/api/metadata/now$` | Antenne Bayern + Oldie Antenne — `fetchAntenneMetadata` |
| `^https://www\.rockantenne\.de/api/metadata/now$` | Rock Antenne — `fetchAntenneMetadata` |
| `^https://www\.bremen(?:eins\|zwei\|vier\|next)\.de/.+~ajax_ajaxType-epg\.json$` | Radio Bremen — `fetchRadioBremenMetadata` |
| `^https://www\.sr\.de/sr/epg/nowPlaying\.jsp\?welle=[a-z0-9]+$` | Saarländischer Rundfunk — `fetchSrMetadata` |

### Adding a new CORS-blocked broadcaster

1. Probe the API: `curl -sI -H 'Origin: https://rrradio.org' '<api-url>'`. If you see no `Access-Control-Allow-Origin` header, you need the proxy.
2. Add a regex to the `ALLOW` array in `src/index.ts` (be specific —
   anchor the host, anchor the path; the goal is to grant the minimum
   surface that satisfies the fetcher).
3. Write or extend the matching fetcher in `../src/builtins.ts` (it
   should call `fetch(\`${PROXY}?url=${encodeURIComponent(targetUrl)}\`, …)`).
4. Wire YAML for the affected stations (`metadata: <key>` on the
   broadcaster, per-station `metadataUrl`).
5. **Redeploy the Worker** (see "When to redeploy" below).
6. Verify: `curl '<worker>/api/public/proxy?url=…'` should return the
   upstream JSON; a 403 means the regex didn't match.

---

## When to redeploy

`wrangler deploy` is needed any time `src/index.ts` (or `wrangler.toml`)
changes. The browser-side TypeScript builds and ships to GitHub Pages
on every push to `main`, but the Worker is its own deploy target — code
changes don't reach `rrradio-stats.<subdomain>.workers.dev` until you
run `wrangler deploy` explicitly.

The most common change is "added an entry to the proxy allowlist" —
when you do that, the in-app fetcher for the new broadcaster will
silently 403 against the old worker version until you deploy. Beads
auto-creates a P1 issue (`Deploy rrradio-stats Worker (...)`) when
worker diffs land on `main` without a follow-up deploy.

```sh
cd worker
npx wrangler deploy
```

Confirm:

```sh
# pick any allowlisted URL and check the proxy returns the upstream JSON
curl -s 'https://rrradio-stats.markussteinbrecher.workers.dev/api/public/proxy?url=https%3A%2F%2Fwww.antenne.de%2Fapi%2Fmetadata%2Fnow' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["data"]), "mountpoints")'
```

---

## One-time setup

1. **Create a GoatCounter API token**
   - GC dashboard → Settings → API → New token
   - Permissions: tick "Read statistics" only
   - Copy the token (shown only once)

2. **Generate an admin token** for the dashboard
   ```sh
   openssl rand -hex 24
   ```
   Save it somewhere — you'll paste it once into the dashboard.

3. **Install Wrangler + log in**
   ```sh
   cd worker
   npm install
   npx wrangler login
   ```

4. **Set Worker secrets**
   ```sh
   npx wrangler secret put GOATCOUNTER_TOKEN   # paste the GC token
   npx wrangler secret put ADMIN_TOKEN         # paste the admin token from step 2
   ```

5. **Deploy**
   ```sh
   npx wrangler deploy
   ```
   Wrangler prints the deployed URL — something like
   `https://rrradio-stats.<your-subdomain>.workers.dev`.

6. **Wire the dashboard**
   - Open `../public/dashboard.html`
   - Replace the `WORKER_URL` constant with the URL from step 5
   - Commit and push (GH Pages redeploys automatically)

7. **Open the dashboard**
   - Visit `https://<your-host>/rrradio/dashboard.html`
   - Paste the admin token from step 2 → unlock
   - Token persists in localStorage

---

## Local development

```sh
cd worker
npm install
echo 'GOATCOUNTER_TOKEN = "..."' > .dev.vars
echo 'ADMIN_TOKEN = "dev-token"' >> .dev.vars
npx wrangler dev
```

`.dev.vars` is gitignored. The Worker runs at `http://localhost:8787`.

## Rotating the admin token

```sh
npx wrangler secret put ADMIN_TOKEN
```

Pick a new token, paste it; the dashboard's localStorage entry will
fail authorization, the gate re-prompts, paste the new token.

## Tail live logs

```sh
npx wrangler tail
```

Useful when the dashboard returns "fetch failed" or when
`/api/public/proxy` returns 502 — the upstream response (GoatCounter
or broadcaster API) is logged here. Allowlist-403s and upstream-502s
are different code paths so the logs disambiguate them.

---

## File map

```
worker/
  src/index.ts          — single-file Worker. ~460 lines.
                          Public routes: /api/public/...
                          Admin routes: /api/...
                          Allowlist: const ALLOW = [...]
  wrangler.toml         — non-secret config (GC site, allowed origin)
  .dev.vars             — local-dev secrets (gitignored)
  README.md             — this file
```

## Configuration

`wrangler.toml` exposes two non-secret vars:

- `GOATCOUNTER_SITE` — `<subdomain>.goatcounter.com`, the GC instance
  the worker reads from.
- `ALLOWED_ORIGIN` — the origin that admin endpoints accept (the
  dashboard's host, e.g. `https://rrradio.org`). Public endpoints
  echo `*` and don't read this.

Two secrets, set via `wrangler secret put`:

- `GOATCOUNTER_TOKEN` — read-only GC API token.
- `ADMIN_TOKEN` — bearer for the admin endpoints.
