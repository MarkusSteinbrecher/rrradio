# rrradio — Operations

Curating the station catalog, wiring metadata, telemetry, and the admin dashboard.

## Station catalog — workflow

The curated tier of stations is **data, not code**. Two YAML source files under `data/` are the source of truth; `public/stations.json` is a build artifact regenerated on every `npm run dev` and `npm run build`. The public README for adding stations lives at `docs/adding-stations.md`.

The native iOS app lives in <https://github.com/MarkusSteinbrecher/rrradio-ios>. This repo still owns the published catalog JSON. If an iOS release needs a refreshed bundled SQLite FTS5 index, run the catalog build with `RRRADIO_IOS_FTS_DB=/path/to/rrradio-ios/rrradio/Resources/stations.fts5.db`; otherwise the web catalog build skips the iOS DB so it does not recreate a local `ios/` tree.

See `docs/architecture.md` for the full file map of `data/`, `tools/`, and the rest.

## Native metadata capabilities

`npm run catalog` also writes `public/station-capabilities.json`, a network-free companion to `public/stations.json`. Native clients use it to decide whether a station is worth background metadata work before opening a stream:

| Field | Meaning |
|---|---|
| `metadataStrategy` | `api` for known fetchers, `icy` for useful ICY fallback, `hls` for useful HLS fallback, `none` for stations that should not be background-probed. |
| `backgroundPollPriority` | `normal` for structured APIs, `low` for ICY/HLS fallback, `never` for stream-only stations. |
| `hasProgram` | The fetcher can expose current show/program information. |
| `hasSchedule` | The fetcher has a schedule companion endpoint. |
| `hasProviderCover` | The provider metadata can supply artwork beyond the station favicon. |

The rules are intentionally conservative: `stream-only` becomes `metadataStrategy: none` and `backgroundPollPriority: never`; `icy-only` becomes `icy` or `hls`; stations with a known `metadata` key become `api`. This lets iOS/Android avoid bulk stream probing in Favorites and other station-heavy views while still using curated broadcaster APIs.

For local iOS scale testing, `npm run catalog:ios-local` writes the matching local-only pair:

```bash
public/stations-ios-local.json
public/station-capabilities-ios-local.json
```

Those local files may include HTTP streams and are not the website publish contract.

## Featured highlights (`highlights.json`)

The "Featured by rrradio" rail on the Browse discovery surface (web + iOS + Android) is driven by an **editorial feed**, separate from the catalog. Like the catalog it's **data, not code**:

- **Source of truth:** `data/highlights.yaml` — a short, ordered list of curated entries.
- **Build artifact:** `public/highlights.json`, written by `tools/build-highlights.mjs` and served at `https://rrradio.org/highlights.json`.

Each entry **references a published catalog station by id** (the `id:` from `data/stations.yaml`). The station's name, logo, genre, and flag are resolved from the catalog at render time, so only the curated fields live in the feed:

| Field | Required | Meaning |
|---|---|---|
| `station` | yes | catalog station id (alias: `stationId`). Must be a *published* station (`working` / `stream-only` / `icy-only`) or the build fails. |
| `badge.label` | yes | short editorial tag, e.g. `Station of the week` (the UI uppercases it). |
| `badge.accent` | no | `#rrggbb` card accent. Omit to use the app accent token (green in light, yellow in dark). |
| `blurb` | no | one-line editorial note (clamped to ~3 lines on a card). |
| `startsOn` / `endsOn` | no | `YYYY-MM-DD` scheduling window — the entry is hidden outside `startsOn … endsOn` (either bound is open if absent). |

```bash
npm run highlights         # regenerate public/highlights.json from the YAML
npm run check-highlights   # CI gate: JSON ↔ YAML in sync + every id published
```

`npm run highlights` also runs as part of `npm run catalog` and `npm run dev`. The committed `public/highlights.json` is what deploys (CI serves the artifact, not a fresh build), so **edit the YAML, run `npm run highlights`, and commit both**. `check-highlights` (wired into the CI `catalog` job) fails the build if you forget. The `version` field is a deterministic content hash — a cache-busting signal, not a timestamp — so the artifact is reproducible.

**Delivery model:** clients fetch the file over HTTPS, cache the last good copy, and re-fetch on a throttle. An unknown `station` id is silently dropped client-side, and an empty feed hides the rail entirely — so the featured set changes with a web deploy, **no native release needed**. When the file is absent the rail simply stays hidden (the genre/country chips still render).

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
2. `npm run health -- --only <id>` — confirms stream / icy / meta API / fetcher coverage and flags wireable-but-not-wired stations (writes the verdicts into `public/station-health.json`, see `docs/station-health.md`).
3. Improve station logos with the remote-logo scraper in `docs/logo-extraction.md`; only bundle curated PNGs in `public/stations/` when image quality matters and source/provenance is clear per `THIRD_PARTY_NOTICES.md`.
4. If broadcaster has a metadata API but no fetcher yet — add one in `src/builtins.ts` AND a discoverer in `tools/wire-metadata.mjs` (so future channels of the same family auto-wire).
5. Bump status from `stream-only` → `icy-only` (ICY-only metadata) or `working` (full per-broadcaster fetcher with logo).

## Homepage liveness (`check-homepages`)

A dead `homepage:` breaks twice: the link is broken for users, and it silently
disables `scrape-logos`, which derives a broadcaster logo *from* the homepage.
`check-catalog` only validates URL *syntax*, so dead homepages sail through (the
SRF family had all six `/audio/<slug>` homepages 404-ing — #469/#470).

`npm run check-homepages` fetches each publishable station's homepage (deduped
by URL, ~18.5k unique), follows redirects with a real browser User-Agent, and
classifies the result: `ok` · `dead` (4xx — actionable, breaks scraping) ·
`blocked` (401/403/429 — auth/geo/rate, page may be fine) · `server-error` (5xx)
· `error` (DNS/TLS/timeout). It is a **periodic/curation gate, not a per-build
CI check** — a full run is a real network job. Non-blocking by default;
`--strict` exits non-zero when any homepage is `dead`.

```bash
npm run check-homepages -- --cc CH            # one country (171 stations)
npm run check-homepages -- --cc DE --strict   # gate a country in CI/curation
npm run check-homepages -- --only id1,id2     # specific stations
npm run check-homepages -- --limit 500        # quick sample
npm run check-homepages -- --force            # ignore cache, recheck all
```

Results cache to `.cache/homepage-status.json` (gitignored); rows younger than
`--stale-days` (default 7) are reused, so country batches are resumable. A `dead`
homepage is a curation lead: find the live URL (often the broadcaster's own
programme page — for SRG the integration layer's `timeTableUrl`) and update the
YAML, then regenerate the catalog.

## Broadcaster-API logos (`harvest-logos`)

Some broadcasters expose an authoritative, broadcaster-hosted, licence-clean
per-channel logo through the **same metadata API we already call for now-playing
data** — no scraping, no fragile Wikimedia dependence. `npm run harvest-logos`
(`tools/harvest-broadcaster-logos.mjs`) codifies that join (#471): for each
station matching an adapter it fetches the broadcaster's channel list, joins
station → channel by the id already in `metadataUrl`, and emits an `apply-logos`
patch (`faviconSource: broadcaster-api`, `faviconLicense: broadcaster`).

First adapter: the **SRG SSR integration layer** (SRF / RTS / RSI / RTR), all
sharing `il.srf.ch/integrationlayer/2.0/<net>/channelList/radio.json` and keying
art by the same channel id as our `.../songList/radio/byChannel/<id>.json`. The
pure join + policy classifier live in `tools/lib/broadcaster-logos.mjs`
(unit-tested); the CLI only fetches and applies policy.

The tool **never mutates `stations.yaml`** — it writes a patch you review, then
apply. Write policy chooses which stations enter the patch:

```bash
npm run harvest-logos                          # default: stations with NO favicon (safe to insert)
npm run harvest-logos -- --upgrade-generic     # + weak / site-default icons (the generic-shared-icon win)
npm run harvest-logos -- --include-existing     # every matched station (forced idempotent re-harvest)
npm run harvest-logos -- --adapter srg --cc CH  # scope to one adapter / country
npm run harvest-logos -- --only id1,id2         # specific stations
# review internal/logos/broadcaster-api.json (gitignored), then:
npm run apply-logos -- --in internal/logos/broadcaster-api.json            # insert (fill missing)
npm run apply-logos -- --in internal/logos/broadcaster-api.json --replace  # also overwrite existing
```

It is **idempotent**: `--include-existing` re-derives URLs identical to what's
already in the catalog for stations already on broadcaster-API art (RTS/RSI),
and flags them `patch(idempotent)`. Note the SRG `imageUrl` is a 16:9 branded
card — great for the now-playing destination but busier than a wordmark for the
list icon, which is why SRF deliberately keeps its clean Commons wordmarks
(default policy leaves any existing good logo alone). To add a broadcaster, add
an adapter to `tools/lib/broadcaster-logos.mjs` (`match` / `sources` / `index` /
`resolve`); the SRG adapter is the template.

## Non-free wiki-logo migration (`migrate-nonfree-logos`)

Favicons on `upload.wikimedia.org/wikipedia/en/` are non-free (fair-use):
deletion-prone, not redistributable, and mislabeled `faviconSource: wiki` (which
implies a free Commons licence). `logo-quality` flags them as the
`non-free-wiki` tier; `npm run migrate-nonfree-logos` resolves a free **Commons**
replacement for each (#472). The English article's infobox image *is* the
non-free upload, but the station's **native-language** Wikipedia article usually
points at the same artwork on Commons (DR → da, RFM → pt, …), so the tool tries
native-lang first, hard-rejects any candidate still on `/wikipedia/en/`, fetches
the Commons licence, and writes an `apply-logos` patch. It is network-only and
**never** mutates `stations.yaml`.

```bash
npm run migrate-nonfree-logos -- --cc DK          # one country (DR family)
npm run migrate-nonfree-logos -- --only id1,id2    # specific stations
npm run migrate-nonfree-logos                      # all 220, patch → internal/logos/nonfree-migration.json
```

Each patch entry carries review metadata (`apply-logos` ignores it): `_via:
article` (native-lang infobox — high confidence) vs `_via: file` (Commons File:
search — can match a same-named *sibling* station, e.g. Spanish "Kiss FM" →
*Kiss FM Kobe*; **always spot-check `_via:file` by hand**). Then apply the vetted
subset: `npm run apply-logos -- --in <patch> --replace` → `npm run catalog`. Only
a minority resolve via Commons — the long tail of obscure local stations have no
free equivalent (that's *why* the en upload is non-free) and need `scrape-logos`
against the broadcaster site instead. Pure matching/scoring logic lives in
`tools/lib/nonfree-migration.mjs` (unit-tested).

**Family propagation (`--propagate`, #478).** Stations sharing one non-free en
file share the same artwork, so when a sibling resolves a Commons logo the tool
can reuse it for the rest (entries tagged `_via: family` + `_seed`/`_tier`):

```bash
npm run migrate-nonfree-logos -- --propagate                  # same-country only (safe)
npm run migrate-nonfree-logos -- --propagate --cross-country  # + cross-country (review-first)
```

Two guards: a shared brand token (`sharesBrandToken`) and the country `_tier`.
`same-country` (within-country sub-channels/regionals) is the safe default;
`cross-country` is **flagged for mandatory review** because a generic name
("Kiss", "Gold", "Magic") is shared by *unrelated* stations across countries —
only a true network (NRJ) is legitimately cross-country, and even then a wrong
seed propagates to every sibling (the NRJ seed has mis-resolved to a neighbour
brand before). In practice the yield is small: the genuinely-safe same-country
sub-channel groups (KCRW, Mirchi, KSFR…) have **no** free Commons logo to seed
from — those belong to the `scrape-logos` track. The companion `scoreFileHit`
fix (prefer an exact brand token over a sub-brand) is the broadly useful part:
it stops the File: search from picking e.g. *NRJ Junior* for *NRJ*.

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

## Pre-sized favicon variants

The iOS app's list cells display station favicons at 38pt, 64pt, or 76pt. The bundled originals are often 256–1024 px PNGs (broadcaster-hosted), and shipping them at full size costs bandwidth, CPU (on-device downsampling on every cell layout), and first-paint latency. `tools/build-favicon-variants.mjs` pre-sizes each catalog favicon at build time into three WebP variants sized for iOS @2x display (76 / 128 / 152 px), writes them under `public/favicons/<id>-<size>-<hash>.webp`, and adds a `favicons: { 76, 128, 152 }` object to each station in `public/stations.json`. The original `favicon` field is preserved as a fallback (web app, custom user-added stations, future Android wiring).

`npm run catalog` chains `build-catalog.mjs` + `build-favicon-variants.mjs` automatically. The variant builder is incremental:

- A manifest at `public/favicons/manifest.json` records the source URL, content hash, ETag, and last-modified per station.
- On rerun, if the source URL is unchanged and all variant files exist on disk, the station is skipped without touching the network.
- If a manifest entry has validators (ETag / Last-Modified), we issue a conditional GET; a `304` response keeps the existing variants.
- If bytes are re-fetched but their SHA-256 matches the prior hash, we reuse the on-disk variants and only update the manifest.
- Variant filenames embed the source content hash so CDN / device caches stay warm forever once a logo settles.

Flags:

```bash
npm run favicon-variants                          # default — process everything in stations.json
npm run favicon-variants -- --local-only          # only stations with `favicon: stations/...` (no network)
npm run favicon-variants -- --only id1,id2,id3    # restrict to specific stations
npm run favicon-variants -- --limit 500           # cap total candidate count
npm run favicon-variants -- --concurrency 32      # increase parallel HTTP lanes (default 8, max 64)
npm run favicon-variants -- --timeout 8           # per-fetch timeout in seconds (default 15) — bounds dead-host tail on bulk runs
npm run favicon-variants -- --force               # ignore cache, refetch + regenerate every variant
npm run favicon-variants -- --offline             # never reach the network; rely on cached bytes only
npm run favicon-variants -- --dry-run --verbose   # see what would change
```

ICO favicons (broadcasters still serving `/favicon.ico`) are decoded by `tools/lib/ico-decode.mjs` — sharp/libvips can't read ICO. It picks the best frame (largest area, then colour depth) and hands sharp either the embedded PNG (modern 256px icons) or decoded RGBA (32/24/8/4/1-bpp BI_RGB DIBs with the 1-bit AND mask). Exotic frames (BITFIELDS/RLE/JPEG-in-ICO) still fall through to "no variant → client fallback". Transient fetch failures (timeout, network error, 5xx, 429) are retried with exponential back-off; permanent failures (4xx) fail fast so a dead URL doesn't burn three attempts across the long tail.

The full long-tail has been generated: **~17,000 of the ~19,800 stations with a favicon now carry variants** (~195 MB / ~51k WebP files committed under `public/favicons/`). The remaining ~2,800 are dead/unreachable favicon URLs that fall back gracefully. Refreshes are still a curator-paced operation — re-running `npm run favicon-variants` is incremental (manifest + conditional GETs), so only changed sources re-fetch. `check-catalog` enforces that every `favicons.{76,128,152}` path in `stations.json` references an on-disk file under `public/favicons/`.

Stations whose source can't be fetched (404, timeout, unsupported ICO format) ship without a `favicons` field — clients fall back to the original `favicon` URL and on-device downsampling.

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

## Sources inventory

Stations enter the catalog from a small number of upstream sources. The registry at `data/sources.yaml` lists them; new sources get added there and slotted into the collector switch in `tools/build-sources.mjs`.

Today there are three registered sources, with two more kinds reserved:

| Source id | Kind | Notes |
|---|---|---|
| `radio-browser` | `radio-browser` | Our primary upstream (~55k candidates). Entries with `stationuuid` are bound to an RB record and inherit fields from it. |
| `manual` | `manual` | Hand-added stations that don't come from any upstream catalog (M94.5, Grrif, Frisky channels, etc.). Distinguished by the absence of any RB signal. |
| `user-suggestions` | `user-suggestion` | Listener suggestions (GitHub issues via `docs/adding-stations.md`), triaged into `data/sources/user-suggestions/suggestions.yaml` (`triage: new | accepted | rejected`). |
| — | `webpage` | Reserved for scraped station lists from specific sites. Each site becomes its own source entry with a committed list at `rawStations:`; the generic list collector in `build-sources.mjs` picks it up with no extra code. |
| — | `broadcaster-api` | Reserved, no collector yet. |

Catalog rows can carry an explicit `source: <id>` field. When that's absent, `tools/build-sources.mjs` classifies the row using the `matchHints` on each source (uuid present, id prefix, faviconSource value), falling back to `manual`. **Every new entry must set `source:` explicitly** — an import from any non-manual source that forgets the field is silently miscounted as manual. `check-catalog` fails the build when a `source:` value doesn't exist in `data/sources.yaml`.

Per-station provenance is published as `public/sources/catalog-source-map.json` (`defaultSource` = the dominant source, `overrides` = everything else, a few rows instead of 24k). The tracker reads it to power the Overview provenance cards, the `source` filter on the Stations table (`#/stations?source=manual`), and the `src:` badge on station detail.

### Raw source DB (`data/sources/`)

Every source has a **committed snapshot of its upstream data** under `data/sources/<source-id>/`. Git is the audit trail — `git log -p data/sources/radio-browser/by-country/DE.json` shows every change RB has made to the German catalog since we started tracking.

```
data/sources/
├── radio-browser/
│   ├── index.json                 # per-country fetch metadata
│   └── by-country/
│       ├── AD.json                # raw RB station list for Andorra
│       ├── AE.json                # raw RB station list for UAE
│       └── …                      # one file per ISO 3166-1 alpha-2 code
├── manual/
│   ├── index.json                 # metadata + sourceOfTruth pointer
│   └── stations.yaml              # extract of manual catalog entries
└── user-suggestions/
    └── suggestions.yaml           # hand-maintained intake list
```

| File | Authoritative? | Refreshed by |
|---|---|---|
| `data/sources/radio-browser/by-country/<CC>.json` | **Yes** — raw RB snapshot, one per country | `npm run fetch-rb-raw` |
| `data/sources/radio-browser/index.json` | Yes — per-country fetch metadata (timestamp, server, count) | `npm run fetch-rb-raw` |
| `data/sources/manual/stations.yaml` | No — generated from `data/stations.yaml` | `npm run extract-manual-source` |
| `data/sources/manual/index.json` | No — metadata | `npm run extract-manual-source` |
| `data/sources/user-suggestions/suggestions.yaml` | **Yes** — triaged suggestion intake | hand-edited at triage time |

The RB snapshots are pretty-printed with stable key ordering (stations sorted by `stationuuid`, fields projected through a fixed list) so git diffs stay tight even when RB silently reorders its responses. Total raw RB DB is ~40 MB committed for 237 countries / ~55k stations.

### First checks on raw stations

After the raw snapshot is in place, the pipeline runs cheap deterministic checks **before** the slower playability probe (`analyze-rb`):

1. **Cross-country dedupe** — `npm run dedupe-raw` walks every per-country file and links stations that share signals across countries. Two signals today:
   - `stream-url` — normalized streamUrl collision (high confidence — same physical stream)
   - `name+homepage` — same country + name signature + homepage host (medium confidence — same brand on same broadcaster home)

   Union-find merges chains across signals. The canonical for each group is the row with the most votes (then clickcount, then earliest changeuuid). Output goes to `data/sources/radio-browser/dedupe.json` with a `byStationUuid` lookup table consumed by `build-sources`.

2. **Curator overrides** at `data/sources/radio-browser/overrides.yaml` take precedence over the automatic signals:
   ```yaml
   not-duplicate:
     - uuids: [<uuid-a>, <uuid-b>]
       reason: "Different programs on a shared CDN URL"
       decidedAt: 2026-05-19

   force-merge:
     - canonical: <uuid-x>
       duplicates: [<uuid-y>, <uuid-z>]
       reason: "Same broadcaster, multi-submitter RB entries"
       decidedAt: 2026-05-19
   ```
   `not-duplicate` splits otherwise-linked UUIDs into singletons. `force-merge` links UUIDs even when no automatic signal fired; the resulting group is flagged `lockedBy: override`.

3. **Playability probe** — the slow step. Owned by `tools/analyze-rb.mjs` (per country) and `tools/analyze-rb-all.mjs` (sweep). Reads stations from the raw snapshot (no network fetch for inventory), probes each stream URL with `tools/playable-check.mjs`, writes verdicts to `public/rb-analysis-<CC>.json`. Verdicts get layered on top of the dedupe DB by `build-sources` — duplicate decisions stay in `dedupe.json`, playability in `rb-analysis-*.json`.

   ```bash
   # one country
   npm run analyze-rb -- DE
   npm run analyze-rb -- DE --concurrency 8 --resume

   # sweep across every country in the raw snapshot
   npm run analyze-rb-all                       # skips reports newer than 14 days
   npm run analyze-rb-all -- --only-missing     # only probe countries with no report
   npm run analyze-rb-all -- --max-age 30d
   npm run analyze-rb-all -- --countries CH,AT  # subset
   ```

   The default concurrency (5 streams in flight per country) is conservative — many broadcasters host dozens of channels behind one origin and rate-limit aggressively. A full sweep of ~55k stations takes 1-2 hours.

   Fetch-based verdicts are not the final word when a station appears broken but opens fine in a browser. For suspect rows, run the browser-backed probe:

   ```bash
   npm run probe:bytes -- '<stream-url>'          # fast: checks returned bytes / playlists
   npm run probe:bytes -- --from-candidates public/sources/radio-browser-candidates.json --only-unplayable --resume --concurrency 12 --timeout 8 --output public/sources/radio-browser-byte-probes.json
   npm run probe:browser -- '<stream-url>'
   npm run probe:browser -- --json '<stream-url>'
   ```

   `probe:bytes` uses Python's standard library and checks the response prefix for MP3/AAC/Ogg/FLAC/WAV/MP4/FLV signatures or HLS/plain playlist bodies. In batch mode it writes `public/sources/radio-browser-byte-probes.json`, which the station tracker reads as the Sources table's `Bytes` column. `probe:browser` uses Playwright Chromium, an actual `HTMLAudioElement`, and the same `hls.js` path as the web player. A browser `OK` result should be treated as stronger evidence than a Node `fetch` failure. `probe-inconclusive` and `probe-skipped` mean the tooling did not prove the station is broken.

A group exceeding 50 members is flagged `oversized: true` — almost always a CDN endpoint sweeping in unrelated stations. Investigate manually.

### Refresh workflow

```bash
# Pull every RB country (skipped if fetched within 7 days)
npm run fetch-rb-raw

# Force re-fetch (ignore freshness)
npm run fetch-rb-raw -- --all --force

# One country
npm run fetch-rb-raw -- DE

# Custom freshness window
npm run fetch-rb-raw -- --max-age 30d
```

The polite default is 250 ms between requests, single-country at a time, 4× exponential back-off on 5xx. A full refresh of all ~237 countries takes ~2 minutes.

After fetching:

```bash
# (also re-run when data/stations.yaml has manual changes)
npm run extract-manual-source

# Refresh the dedupe DB
npm run dedupe-raw

# Rebuild the dashboard artifacts
npm run build-sources

# Commit the snapshot diff + regenerated artifacts
git add data/sources/ public/sources.json public/sources/
git commit -m "Refresh RB raw snapshots + dedupe"
```

`npm run dev` already chains `extract-manual-source`, `dedupe-raw`, and `build-sources` so local work always sees fresh artifacts. `fetch-rb-raw` is manual on purpose — refreshing every country is a network operation we don't want firing on every `dev` command.

### Build artifacts (`public/sources/`)

`npm run build-sources` reads the raw DB + the per-country `public/rb-analysis-<CC>.json` verdict files and writes:

```
public/sources.json                          — summary (eagerly loaded by tracker)
public/sources/<source-id>.json              — per-source detail (per-country roll-up)
public/sources/<source-id>-candidates.json   — full per-station list with disposition
public/sources/catalog-source-map.json       — per-station provenance (default + overrides)
```

Candidate rows carry a stamped `disposition` (imported / available / duplicate / broken / unprobed — dedupe-group aware, so any group with an imported member marks its other members duplicate) and, when the playability probe ended somewhere other than the record URL, a `playableUrl` (e.g. the verified https upgrade of an http record — `playable-check` tries https first and only reports `ok` when it works; genuinely http-only streams get `broken-mixed`). `tools/import-playable-candidates.mjs` imports http records via that verified https entry point.

CI doesn't regenerate these — the committed artifact is what GitHub Pages serves, mirroring `public/stations.json`.

The **Sources tab** on `station-tracker.html` (sibling to the Matrix tab) reads these files directly (same-origin, no auth) and surfaces:

- per-source candidate / imported / not-imported counts
- per-country drilldown for Radio Browser, linking out to the existing `rb-analysis-<CC>.json` reports
- the top unimported RB stations by upstream vote count — fuel for the curation backlog
- cross-source duplicates: a single stream URL imported under more than one source label

The tab is sticky via `#sources` in the URL hash so reloads and shared links land on the same view.

When a new source comes online, add an entry to `data/sources.yaml`. For list-backed sources (kind `webpage` or `user-suggestion`) that's all — point `rawStations:` at a committed YAML list and the generic collector handles it. Only genuinely new kinds (e.g. a broadcaster API import) need a matching `collect<Kind>` function in `tools/build-sources.mjs`. The tracker tile + drilldown appear automatically once the artifact is rebuilt.

#### User-suggestion flow

1. Listener opens an issue (or mails a station) → append a row to `data/sources/user-suggestions/suggestions.yaml` with `triage: new` and `suggestedVia:` pointing at the issue.
2. Triage: probe the stream, set `triage: accepted` or `rejected` (+ `triageNote`).
3. Accepted → import into `data/stations.yaml` with an explicit `source: user-suggestions`; `build-sources` matches the intake row by stream URL and reports it as imported.
4. The suggestion row stays in the intake list — git history is the audit trail of every suggestion and its outcome.

## Design tokens

The local style-token editor lives at `/style/` in dev and builds to `dist/style/index.html`.

Source files:

```
style/index.html       — standalone Vite HTML entry
src/style-page.ts      — DOM wiring, local persistence, previews, copy buttons
src/style-page.css     — editor and preview styling
src/style-tokens.ts    — OKLCH defaults, contrast checks, CSS / JSON / Swift exports
```

Tokens are semantic rather than platform-specific: `surface`, `surfaceRaised`, `surfaceMuted`, `textPrimary`, `textSecondary`, `textTertiary`, `separator`, `controlFill`, `controlFillSelected`, `accent`, `accentOnFill`, `warning`, and `destructive`. Authoring values are OKLCH strings. The page converts them locally for contrast checks and emits:

- CSS custom properties for the web app surface.
- A JSON payload that can become a checked-in token source once the palette settles.
- SwiftUI `Color` and UIKit `UIColor` snippets with sRGB channel values for native migration work.

Edits are stored only in browser `localStorage` under `rrradio.style-tokens.v1`. They do not alter `src/style.css`, the bundled catalog, or any native app repository. Use **Reset defaults** to clear local edits.

## iOS app landing page

The iOS app webpage is a standalone static Vite entry at `/rrradio-ios/`, with `/ios` as a local-dev alias. It is built from the design handoff in `internal/rrradio-ios app webpage design/design_handoff_landing_page/`, but the production-facing files live outside `internal/` so Vite can build them:

```
rrradio-ios/index.html       — route HTML and page copy
rrradio-ios/landing.css      — extracted handoff styling
rrradio-ios/landing.js       — vintage tuner scroll/navigation wiring
rrradio-ios/*.svg            — local logo assets
```

The page is route-isolated from the web player and catalog. It does not import `src/main.ts`, `src/style.css`, station data, or any native app repository. The phone mockups currently use static placeholders; replace those with real app screenshots once the App Store page assets are ready.

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

The operational cards on the dashboard (Station catalog, Station backlog) render from static same-origin JSON and don't depend on the Worker. When GoatCounter is unreachable or the admin token is invalid, those cards still render — only the telemetry tiles show a fallback message. The per-source inventory lives on `station-tracker.html` (Sources tab), not here.

To re-deploy the Worker after editing `src/index.ts`:

```sh
cd worker
npx wrangler deploy
```

Dashboard pulls fresh data on next refresh.
