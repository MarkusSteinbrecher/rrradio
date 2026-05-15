# rrradio — Operations

Curating the station catalog, wiring metadata, telemetry, and the admin dashboard.

## Station catalog — workflow

The curated tier of stations is **data, not code**. Two YAML source files under `data/` are the source of truth; `public/stations.json` is a build artifact regenerated on every `npm run dev` and `npm run build`. The public README for adding stations lives at `docs/adding-stations.md`.

The catalog build also emits the iOS SQLite FTS5 index at `ios/rrradio/Resources/stations.fts5.db` from the generated `public/stations.json`. The app opens this file read-only for non-empty Browse search queries and falls back to the in-memory matcher when the bundled DB does not match the loaded catalog size. The current index is about 2.7 MB for 15,608 stations, so the bundle delta is well below App Store cellular-download thresholds.

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
3. Improve station logos with the remote-logo scraper in `docs/logo-extraction.md`; only bundle curated PNGs in `public/stations/` when image quality matters and source/provenance is clear per `THIRD_PARTY_NOTICES.md`.
4. If broadcaster has a metadata API but no fetcher yet — add one in `src/builtins.ts` AND a discoverer in `tools/wire-metadata.mjs` (so future channels of the same family auto-wire).
5. Bump status from `stream-only` → `icy-only` (ICY-only metadata) or `working` (full per-broadcaster fetcher with logo).

## Adding a station that fits an existing fetcher

Existing fetchers cover Grrif, ORF (any channel via metadataUrl), BR (any channel via metadataUrl), plus generic ICY-over-fetch as fallback.

1. **Probe** the stream + metadata URL: `npm run probe -- '<stream>' '<meta>'`
2. **Add the YAML row** to `data/stations.yaml` referencing the existing broadcaster, with the channel-specific `metadataUrl` and a `status:`.
3. **Logo**: drop a PNG into `public/stations/`, point `favicon:` at it, and record the source URL/retrieval date in the PR body or `THIRD_PARTY_NOTICES.md`.
4. **Done** — `npm run dev` regenerates the catalog automatically.

## Geo-restricted stations

Some broadcasters geo-gate their streams for music-licensing reasons — SUISA/SwissPerform for Switzerland, GEMA for Germany, similar agencies elsewhere. The stream returns an `HTTP 401` (Infomaniak's AIS9 server) or a 403 to non-allowed IPs, with no auth challenge body; it's a server-side IP geo-block dressed up as auth.

Catalog flag: set `availableIn: [<ISO-3166-alpha-2 codes>]` on the station entry in `data/stations.yaml`.

```yaml
- id: builtin-grrif
  ...
  availableIn:
    - CH
```

Effect:
- **Web** dims the row, adds a "Switzerland only" badge in `.row-tags`, and the player error path translates the 401-driven `MediaError` into a friendly geo-restricted message instead of generic "stream failed".
- **iOS** dims the row + adds the same badge, and `AudioPlayer`'s `.failed` path overrides the error message with the curated reason. The visitor's country comes from the rrradio-stats Worker's `/api/public/region` endpoint, which surfaces Cloudflare's `CF-IPCountry` header. Result is cached per session (web `localStorage`, iOS `UserDefaults`) for 24h.
- **Absent or empty** ⇒ no restriction known. Default for the overwhelming majority of stations; the UI and player behave exactly as before.

How to confirm a station is geo-restricted before flagging:

```bash
# From a non-broadcaster country. Look for 401/403 with no WWW-Authenticate
# challenge — that's the geo-gate signature, not real HTTP auth.
curl -sI 'https://example.broadcaster.com/stream'
```

A control test on a sibling station from the same broadcaster's infrastructure (RJB on Infomaniak responded 200 OK from DE while Grrif on the same fleet returned 401) is the cleanest way to distinguish "broadcaster geo-block" from "broadcaster down".

Do not set `availableIn` speculatively — it dims and labels the row for everyone outside the allow-list. Only set it after a confirmed reproduction from at least one out-of-region IP.

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
| `report-broken: <station name>` | user taps "Report broken station"; title carries station id, stream host, platform, app version, and current playback reason when available |
| `favorite: <station name>` | user adds a favorite |
| `unfavorite: <station name>` | user removes a favorite |
| `add-custom-station` | user submits the Add sheet |
| `search` | debounced 300ms; query content is **not** sent |
| `genre/<all\|jazz\|...>` | user picks from the genre dropdown |
| `country/<cc>` | user picks a country filter |
| `mode/<map\|list\|none>` | user changes Browse mode |
| `curated/<on\|off>` | user toggles curated-only filtering |
| `map-view/<on\|off>` | user toggles the station map |
| `theme/<system\|light\|dark>` | user changes theme |
| `wake/arm` / `wake/disarm` / `wake/fire` / `wake/play-failed` | wake-to-radio lifecycle; title carries local fire timing or station name |
| `backup-export` / `backup-import` | user exports/imports local favorites/custom stations; title carries counts only |
| `open-in/show` / `open-spotify` / `open-apple-music` / `open-youtube-music` | user opens a music-service search from Now Playing; no track title is sent |
| `lock-skip-next` / `lock-skip-prev` | user skips via Media Session controls; title carries the target station name |
| `np-details/open` / `np-details/close` | user toggles the details panel on Now Playing |

To add another event, call `track('event-name', 'optional title')` from the right hook point.

Avoid adding events for high-frequency success paths such as every metadata poll, every cover-art lookup, or every playback rate tick. These make production debugging noisier without explaining failures. Prefer coarse lifecycle events and explicit error/report events. Do not send full stream URLs, search queries, stack traces, track titles, artist names, or arbitrary user-entered strings unless the user explicitly invokes an export/share flow.

## Storage and retention

**Web localStorage**

| Key | Data | Retention |
|---|---|---|
| `rrradio.favorites.v2` | favorite station snapshots | until site data is cleared |
| `rrradio.recents.v2` | 12 most recent station snapshots | capped at 12, until site data is cleared |
| `rrradio.custom.v1` | custom station snapshots, including user-entered stream URLs | until deleted or site data is cleared |
| `rrradio.wake.v1` | one armed wake-to-radio station/time snapshot | until fired, disarmed, or site data is cleared |
| `rrradio.wake.lastTime.v1` | last wake time only | until site data is cleared |
| theme / UI preference keys | non-sensitive UI choices | until site data is cleared |

**iOS local storage**

| Store | Data | Retention |
|---|---|---|
| `UserDefaults` library keys | favorites, station lists, recents capped at 12, custom stations | until deleted or app removal |
| Catalog cache | latest `stations.json` payload in Caches | OS-managed cache lifetime |
| Listening history file | station sessions; optional track artist/title only when the user selects track-level history | off by default; 90 days by default when enabled; user can choose 30 days, 1 year, or forever |
| Diagnostics | recent app operational events, when the user enables Collect Diagnostics | off by default; capped at 100 events and 14 days; turning it off clears local diagnostics; copyable by the user from Settings |
| CloudKit private database | favorites, station lists, custom stations, and preferences only | until the user disables/removes iCloud data; recents, listening-history records, diagnostics, and one-shot playback intents are not synced |

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

Endpoints: `/api/totals`, `/api/top-stations`, `/api/errors`, `/api/reports`, `/api/tabs`, `/api/genres`, `/api/favorites`. All accept `?days=N` (1–90, default 7). Responses cached 5 min at the Cloudflare edge.

To re-deploy the Worker after editing `src/index.ts`:

```sh
cd worker
npx wrangler deploy
```

Dashboard pulls fresh data on next refresh.
