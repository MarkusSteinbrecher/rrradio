# rrradio — Operations

Curating the station catalog, wiring metadata, telemetry, and the admin dashboard.

## Station catalog — workflow

The curated tier of stations is **data, not code**. Two YAML source files under `data/` are the source of truth; `public/stations.json` is a build artifact regenerated on every `npm run dev` and `npm run build`. The public README for adding stations lives at `docs/adding-stations.md`.

See `docs/architecture.md` for the full file map of `data/`, `tools/`, and the rest.

## Linking a station to its Radio Browser record

Every YAML entry can optionally carry three fields that bind it to a Radio Browser record so the build re-uses upstream data instead of duplicating it:

```yaml
- id: builtin-fm4
  stationuuid: 1e13ed4e-daa9-4728-8550-e08d89c1c8e7   # RB primary key
  changeuuid: ae34eaf7-5e77-4144-9eb9-c27a9f33ada2    # last-reviewed RB version
  reviewedAt: 2026-04-28
  broadcaster: orf
  name: FM4                                            # local override
  favicon: stations/fm4.png                            # local override
  metadataUrl: https://audioapi.orf.at/fm4/api/json/4.0/live
  status: working
```

When `stationuuid` is set, `build-catalog` fetches the record via `tools/rb-client.mjs` and uses it as the baseline. Per field, **local YAML wins → broadcaster fallback → RB baseline**. So the YAML stays small (curator-intent only) and `streamUrl`, `bitrate`, `codec`, `tags`, `geo` etc. come from upstream unless we explicitly override.

`changeuuid` is the drift signal. RB bumps it whenever any field on the record is edited. `npm run check-drift` compares the stored value against live RB and writes `public/station-drift.json`; the catalog-watch workflow opens a PR when drift is found, the curator reviews the diff, updates the YAML (and bumps `changeuuid` + `reviewedAt`), merges.

`reviewedAt` is freeform documentation — the date the curator last verified this station's data. Updated only when human-confirmed.

Stations *without* a `stationuuid` (e.g. Grrif, anything RB doesn't index) keep behaving exactly as before: the YAML is the only source.

`auto-curate.mjs` is the natural place to populate these fields when importing a new station from RB; existing curated entries can be migrated one-by-one as drift PRs cycle through.

## Per-station curation process

See `docs/curation-checklist.md` for the full per-activity playbook. The standard sequence for promoting a `stream-only` station toward `working`:

1. `npm run wire-metadata` — auto-derives metadataUrl for known broadcasters (br, orf, bbc, hr). Run first, before manual research.
2. `npm run analyze` — confirms stream / icy / meta API / fetcher coverage and flags wireable-but-not-wired stations.
3. Replace RB-imported favicon with curated PNG in `public/stations/` when image quality matters (small or off-brand defaults).
4. If broadcaster has a metadata API but no fetcher yet — add one in `src/builtins.ts` AND a discoverer in `tools/wire-metadata.mjs` (so future channels of the same family auto-wire).
5. Bump status from `stream-only` → `icy-only` (ICY-only metadata) or `working` (full per-broadcaster fetcher with logo).

## Adding a station that fits an existing fetcher

Existing fetchers cover Grrif, ORF (any channel via metadataUrl), BR (any channel via metadataUrl), plus generic ICY-over-fetch as fallback.

1. **Probe** the stream + metadata URL: `npm run probe -- '<stream>' '<meta>'`
2. **Add the YAML row** to `data/stations.yaml` referencing the existing broadcaster, with the channel-specific `metadataUrl` and a `status:`.
3. **Logo**: drop a PNG into `public/stations/`, point `favicon:` at it.
4. **Done** — `npm run dev` regenerates the catalog automatically.

## Adding a NEW broadcaster (different metadata API shape)

1. **Research** the broadcaster's now-playing endpoint (DevTools network tab on their player page). Verify CORS allow-origin.
2. **Document** the broadcaster in `data/broadcasters.yaml` with its fetcher key.
3. **Implement** the fetcher in `src/builtins.ts`:
   - Add an `async function fetch<Name>Metadata(station, signal)` returning `ParsedTitle | null` (null = source ok but no current track; throw = source broken, poller stops).
   - Wrap in try/catch and return null on transient errors so polling continues across hiccups.
   - Register in `FETCHERS_BY_KEY` under the broadcaster's key.
4. **Add stations** of that broadcaster in `data/stations.yaml`.
5. **Test** with `npm run dev` then play one of the new stations.

## Telemetry / GoatCounter

Privacy-friendly pageview + event analytics. No cookies, no consent banner, no user IDs. The provider runs at goatcounter.com.

**One-time setup (sponsor task):**
1. Sign up at <https://www.goatcounter.com/> and pick a subdomain.
2. In `index.html`, replace `YOUR-CODE` in the inline analytics script with the subdomain.
3. Push. Stats appear at `https://<your-subdomain>.goatcounter.com/`.

**How it works in code:**
- `index.html` injects the GoatCounter script tag dynamically, but only when the host is **not** `localhost` / `127.0.0.1`. So dev reloads don't pollute stats.
- `src/telemetry.ts` exposes a single `track(path, title?)` helper. Calls become a no-op when `window.goatcounter` is undefined (i.e. in dev or before the script loads).
- All calls pass `event: true` so they appear under "Events" in the GoatCounter dashboard, not as pageviews. The auto pageview-on-load is the only "navigation" entry.

**Events currently tracked** (in `src/main.ts`):

| Path | When |
|---|---|
| `tab/<browse\|fav\|recent\|playing>` | user switches tabs |
| `play: <station name>` | new station started from a row / featured tile |
| `pause: <station name>` | state goes playing → paused (same station) |
| `resume: <station name>` | state goes paused → loading (same station) |
| `error: <station name>` | state enters error; title field carries the error message; deduped while error persists |
| `favorite: <station name>` | user adds a favorite |
| `unfavorite: <station name>` | user removes a favorite |
| `add-custom-station` | user submits the Add sheet |
| `search` | debounced 300ms; query content is **not** sent |
| `genre/<all\|jazz\|...>` | user picks from the genre dropdown |
| `np-details/open` / `np-details/close` | user toggles the details panel on Now Playing |

To add another event, call `track('event-name', 'optional title')` from the right hook point.

## Admin dashboard

Private page that surfaces GoatCounter stats in our visual style. Lives at `https://<host>/rrradio/dashboard.html`. Source files:

```
public/dashboard.html     — self-contained: HTML + inline CSS + inline JS
worker/                   — Cloudflare Worker that proxies the GC API
  src/index.ts            — endpoints + CORS + auth
  wrangler.toml           — non-secret config (GC site host, allowed origin)
  README.md               — setup steps (one-time)
```

The browser never sees the GoatCounter API token. The Worker holds it as a Cloudflare secret along with `ADMIN_TOKEN`, the bearer that the dashboard sends. Dashboard prompts for the admin token on first load and stores it in localStorage; the page is open to anyone but reveals nothing without the token.

Endpoints: `/api/totals`, `/api/top-stations`, `/api/errors`, `/api/tabs`, `/api/genres`, `/api/favorites`. All accept `?days=N` (1–90, default 7). Responses cached 5 min at the Cloudflare edge.

To re-deploy the Worker after editing `src/index.ts`:

```sh
cd worker
npx wrangler deploy
```

Dashboard pulls fresh data on next refresh.
