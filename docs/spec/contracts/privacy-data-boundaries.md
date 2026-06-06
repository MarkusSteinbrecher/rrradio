# Privacy & Data Boundaries Contract

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

This contract pins the cross-platform privacy invariant: **rrradio is an
accountless, analytics-free radio player.** Library data is private and local by
default. Every byte that leaves the device is enumerated here, with what is sent,
to which endpoint, when, whether the user opted in, and the retention intent.

Who must honor it:

- Every platform (web, iOS, Android) that opens a network connection.
- Anyone adding a new outbound call — it is not shipped until it appears in the
  matrix below or is explicitly justified against the contract rules.
- The App Store / Play Store privacy-label authors: the matrix is the source
  of truth for the declared data flows.

It does **not** restate catalog/curation rules (see
[`../operations.md`](../../operations.md)) or the metadata privacy rules
(see [`../features/metadata-artwork.md`](../features/metadata-artwork.md) §Privacy
Rules and [`../features/preferences-diagnostics.md`](../features/preferences-diagnostics.md)
§Diagnostics). It links to them; it does not duplicate them.

## Definition

The contract is the set of **boundary rules** plus the **outbound matrix**. A
build conforms iff every network call it makes is listed in the matrix and obeys
every rule.

### Boundary rules (invariant, all platforms)

1. **No account.** No login, no user identifier minted by the app, no
   long-lived unique ID attached to any request.
2. **Library data is local-first.** Favorites, station lists, recents, custom
   stations, theme/UI preferences, sleep-timer state, and wake alarm live on
   device. They are never sent to analytics. iOS additionally syncs a subset to
   the user's *own* CloudKit private database (see [`../data-sync.md`](../data-sync.md));
   that is end-to-end the user's iCloud, not a rrradio-operated store.
3. **No track-content telemetry.** Track titles, artist names, user-entered
   stream URLs, user-entered homepage URLs, and search-query text MUST NOT be
   sent to any analytics or telemetry endpoint.
4. **Metadata/content fetches are functional, not analytic.** Contacting a
   broadcaster API, lyrics provider, or music-search API to render the current
   track is allowed — it is what the user asked for. Sending the same data to a
   *counting* endpoint is not.
5. **Diagnostics are local, opt-in, capped, redacted on export.** Off by
   default; never auto-uploaded; see the diagnostics rule block below.
6. **First-party telemetry is anonymous and aggregate-only.** The web app's
   pageview/event analytics (GoatCounter) carries no cookies, no user IDs, no
   query text, no track titles, no full stream URLs (see
   [`../operations.md`](../../operations.md) §Telemetry / GoatCounter). iOS and
   Android ship **no** analytics SDK.
7. **rrradio-operated endpoints live under `rrradio.org`.** User data
   (IP-bearing region/stats/report/proxy calls) routes through the
   first-party domain, never a developer-personal host. See Known deviations
   for the historical `*.workers.dev` exposure that this rule closed.
8. **Fail-open on privacy-sensitive lookups.** Region/GeoIP resolution that
   cannot complete leaves the user unbadged and unblocked rather than retrying
   or fingerprinting.

### Diagnostics rule block

- Default OFF; the user must explicitly enable "Collect Diagnostics".
- Capped: 100 events / 14 days (iOS), then pruned oldest-first.
- Disabling clears the local store immediately.
- Allowed categories only: playback lifecycle, stream-retry category, network
  availability, metadata-fetch category, cloud-sync availability (iOS), local
  persistence. (Full list in
  [`../features/preferences-diagnostics.md`](../features/preferences-diagnostics.md).)
- MUST NOT contain: stack traces, search queries, full stream/homepage URLs,
  custom-station URLs, track titles, artist names, long-lived user IDs.
- Write-time: detail values are host-reduced (`URL → host`) and length-capped.
- Export-time: a sensitive-key allow-list is dropped and any residual URL/host
  is regex-redacted to `[url]` / `[host]`.
- Diagnostics never auto-upload. They leave the device only when the user
  invokes the Share/Copy action, and only the redacted form.

### Outbound data matrix (reconciled-against `9336321`)

| # | Endpoint | What is sent | When | Opt-in? | rrradio-operated? | Retention intent |
|---|---|---|---|---|---|---|
| 1 | `https://rrradio.org/stations.json` | nothing but the GET (+ IP via TCP) | on launch / catalog refresh | No (core function) | Yes | none app-side; OS cache |
| 2 | `https://stats.rrradio.org/api/public/region` | nothing in body; IP read at the edge for `CF-IPCountry` | first launch + every cold launch past the 24h region cache | No (silent) | Yes (subdomain — see Open Qs) | aggregate/none intended; edge logs at CF |
| 3 | `https://stats.rrradio.org/api/public/top-stations`, `/totals`, `/locations` | nothing in body (+ IP via TCP); `?days=7`, `?limit=…` | every time the Stats sheet opens | No (silent on open) | Yes (subdomain) | public aggregate; edge logs |
| 4 | `https://stats.rrradio.org/api/public/report-broken` | `stationId`, `stationName`, `streamHost`, `platform=ios`, `appVersion`, `reason` (≤160 chars of player state), `source=manual` (+ IP) | user taps "Report broken station" | **Yes** (explicit tap) | Yes (subdomain) | broken-station triage |
| 5 | `https://stats.rrradio.org/api/public/proxy?url=<stream/metadata URL>` | the station's stream/metadata URL as a query param (+ IP) | metadata poll for stations routed through the CORS/ICY proxy | No (core function) | Yes (subdomain) | none intended; edge logs |
| 6 | `https://stats.rrradio.org/api/public/bbc/play/<service>` | BBC service id (+ IP) | metadata poll for BBC stations | No (core function) | Yes (subdomain) | none intended |
| 7 | Broadcaster metadata APIs (e.g. `audioapi.orf.at`, `api.laut.fm`, `www.ffh.de`, `www.radioeins.de`, `www.grrif.ch`) | nothing identifying; the station's own now-playing endpoint (+ IP) | metadata poll while that station plays | No (core function) | No (third party) | none app-side |
| 8 | `https://itunes.apple.com/search` | **current track artist + title** as `term`; `entity=song`, `limit=5` (request shape owned by [`metadata-fetchers.md`](metadata-fetchers.md)) | on each new resolved track, to find cover art + music-service buttons | No (core function) | No (Apple) | in-memory LRU cache (64), not persisted |
| 9 | `https://lrclib.net/api/get`, `https://api.lyrics.ovh/v1/<artist>/<track>` | **current track artist + title** (request shape owned by [`metadata-fetchers.md`](metadata-fetchers.md) §Lyrics lookup) | when the Lyrics pane is shown for a resolved track | No (core function) | No (third party) | none app-side |
| 10 | `https://{de1,at1,nl1}.api.radio-browser.info/json/stations/search` | **the user's typed search query**, plus tag/country filters; `User-Agent` carries app name+version (request shape owned by [`search.md`](search.md) §Radio Browser API) | live station search beyond the bundled catalog | No (core function) | No (Radio Browser) | none app-side |
| 11 | Station favicon / cover-art image hosts (broadcaster + RB-hosted URLs) | nothing identifying; the image URL (+ IP) | rendering station/track art | No (core function) | No (third party) | byte-budgeted `URLCache` |
| 12 | Music-service deep links: `music.apple.com/search`, `open.spotify.com/search`, `music.youtube.com/search`, `music.apple.com/.../album/...` | search term or Apple-track URL **opened in the external app/browser** — not a background request | user taps a music-service button on Now Playing | **Yes** (explicit tap) | No (third party) | n/a (handoff) |
| 13 | `mailto:feedback@rrradio.org` (Add Station catalog submission; broken-station email fallback) | station name + stream URL + the user's own email return address — composed in the OS Mail app, **sent only if the user taps Send** | user submits a catalog request, or emails a broken-station report after the HTTP path fails | **Yes** (explicit send) | Yes (first-party inbox) | maintainer inbox |
| 14 | iCloud / CloudKit (iOS only) | favorites, station lists, custom stations, preferences — in the **user's own** private database | when iCloud sync is enabled | per-user iCloud (system) | n/a (Apple, user-owned) | until user disables/removes; recents, history, diagnostics, one-shot intents NOT synced |

Rows 2–6 are the **IP-bearing, rrradio-operated** flows that drive the
App Store privacy-label question (see Open questions).

## Detail

| Field / Boundary | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| Region cache (`rrradio.region.v1`) | UserDefaults string + date | yes | Cached `CF-IPCountry` result | unset → unknown |
| Region cache TTL | duration | no | How long a region is reused | 24h |
| Region resolution outcome | `unfetched` / `unknown` / `known(CC)` | no | Drives geo-badge UX | `unfetched` |
| `isAvailable` semantics | fail-open | no | Unknown region ⇒ treat station as available | fail-open |
| Diagnostics enabled (`rrradio.diagnostics.enabled.v1`) | bool | no | Master opt-in switch | `false` |
| Diagnostics event cap | int | no | Ring-buffer size | 100 |
| Diagnostics max age | duration | no | Time-based prune | 14 days |
| Diagnostics detail value cap | int | no | Per-value truncation | 120 chars |
| Diagnostics export redaction | sensitive-key drop + URL/host regex | no | Strips host/url/station keys + inline URLs on export | always-on at export |
| Broken-report `reason` cap | int | no | Player-state error prefix length | 160 chars |
| Catalog cache | Caches file | yes | Last `stations.json` payload | OS-managed lifetime |
| Listening history | local file, opt-in | yes | Station (and optional track) sessions | OFF; 90d when on; never synced |
| Analytics SDK (iOS/Android) | none | n/a | No telemetry library is linked | absent |

Sensitive diagnostic export keys that are always dropped: `coverhost`, `host`,
`hostname`, `homepage`, `metadataurl`, `station`, `stationid`, `stationname`,
`stream`, `streamhost`, `streamurl`, `url`.

## Examples

Region resolution response body (row 2):

```json
{ "country": "DE" }
```

`null` country ⇒ state becomes `unknown`, user treated as fail-open available.

Broken-station report body (row 4), exactly as built:

```json
{
  "stationId": "builtin-fm4",
  "stationName": "FM4",
  "streamHost": "orffm4shoutcast.sf.apa.at",
  "platform": "ios",
  "appVersion": "1.0 (42)",
  "reason": "stream failed: HTTP 403",
  "source": "manual"
}
```

iTunes cover-art / verify request (row 8) — note artist+title leave the device,
which is allowed (functional, not analytic):

```
https://itunes.apple.com/search?term=Radiohead%20Reckoner&entity=song&limit=5&media=music
```

Catalog-submission mailto (row 13), reconciled destination:

```
mailto:feedback@rrradio.org?subject=rrradio%20catalog%20station%20request
&body=Please%20consider%20adding%20this%20station...%0AName:%20...%0AStream%20URL:%20https://...
```

Diagnostics export line (always redacted form):

```
- 2026-05-31T10:22:01.500Z [playback] stream failed code=403
```

## Versioning & evolution

- **Adding an outbound call** requires adding a matrix row in this contract in
  the same change. A call that is not in the matrix is a contract violation,
  not a feature.
- **Cache/store keys are versioned** (`…v1`, `…v2`). Bumping the suffix orphans
  the old data (acceptable for caches and opt-in diagnostics; never for the
  user's library — see [`../data-sync.md`](../data-sync.md) for migration).
- **Endpoint host changes** (e.g. moving a route under `rrradio.org`) are
  backward-incompatible for already-installed builds: old builds keep calling
  the old host until updated, so the old host must stay alive through the
  deprecation window or the feature fails open/silent.
- **New telemetry events** (web) follow the GoatCounter rule in
  [`../operations.md`](../../operations.md): coarse lifecycle/error events only,
  never per-poll, never query/track content.
- **Privacy-label drift**: any change to rows 2–6 (the IP-bearing first-party
  flows) requires re-checking the store privacy disclosures before release.

## Failure & fallback

| Input / condition | Behavior |
|---|---|
| Region endpoint unreachable / non-200 / `null` | Region stays previous value; cache NOT updated; next launch retries; user treated as available (fail-open). |
| Region payload malformed (bad CC) | Normalizes to `unknown`; fail-open. |
| Stats endpoints unreachable | Each fetch returns empty; Stats sheet renders "no data" (indistinguishable from a genuinely empty week — see Known deviations DH4). |
| Broken-report non-2xx | Surfaces as a single failure; iOS offers the `mailto:feedback@rrradio.org` fallback (row 13). No idempotency key sent (see deviation D2). |
| Metadata/proxy/broadcaster API fails | Track metadata silently absent; playback continues; only a coarse diagnostic category is recorded. |
| iTunes/lyrics fails | Cover-art falls back to station favicon; lyrics pane stays hidden; transient errors are not cached. |
| Search endpoint fails | Falls back across RB mirrors; on total failure, search shows bundled-catalog results only. |
| Diagnostics disabled | `record(...)` is a no-op; store removed; export reports "collection off". |
| CloudKit unavailable | Library stays fully functional locally; sync is best-effort (see [`../data-sync.md`](../data-sync.md)). |

## Platform obligations

**Web**

- Analytics is GoatCounter only: anonymous, no cookies/IDs, `event:true`, no
  query/track/URL content. No-op on `localhost`.
- Region/stats/report flows hit the same first-party `rrradio.org` boundary
  (Worker), cached in `localStorage` for 24h for region.
- Library/custom/wake state stays in `localStorage`; no library data sent to
  analytics.

**iOS** (reference)

- Ships **no** analytics SDK; rows 2–6 are the only rrradio-operated calls and
  MUST point at the first-party domain (no `*.workers.dev`).
- Diagnostics off by default, capped (100/14d), redacted on export, cleared on
  disable; never auto-uploaded.
- mailto destinations MUST be a first-party inbox (`feedback@rrradio.org`),
  never a developer-personal address.
- Region resolution fails open; never blocks playback on an unknown IP.
- CloudKit uses the user's private database only; recents, listening history,
  diagnostics, and one-shot playback intents are never synced.
- Track titles/artists/URLs/queries never enter diagnostics or any counting
  endpoint (functional fetches to iTunes/lyrics/RB are exempt by rule 4).

**Android**

- Start with **no** analytics SDK for the first port; if telemetry is added,
  match the web GoatCounter rules exactly.
- Diagnostics: opt-in, capped, exportable, redacted — same rules as iOS.
- Broken-station report uses the shared anonymous endpoint under `rrradio.org`.
- Region/stats flows, if implemented, use the first-party boundary and fail
  open.
- Library data stays local; no track/query content to analytics.

## Open questions

1. **Productionize vs. disclose `stats.rrradio.org` (RELEASE BLOCKER for the
   store privacy label).** Rows 2–6 are IP-bearing, fire silently (2, 3, 5, 6)
   or on explicit tap (4), and qualify as "data linked to the user" under store
   privacy definitions. Decide and execute one of: (a) keep `stats.rrradio.org`
   and fully declare the IP/region/stats/report flows in the App Store and Play
   Store privacy labels; (b) gate the silent calls behind first-use consent;
   (c) remove the silent stats/region calls. The historical developer-personal
   host was already migrated off (see Known deviations), but the *disclosure*
   decision is still open. A TestFlight/Play build MUST NOT ship until the
   privacy label reflects rows 2–6.
2. **Region call frequency.** Row 2 fires on every cold launch past the 24h
   cache. Confirm this cadence is acceptable for the privacy label and consider
   widening the TTL or removing the auto-refresh on launch.
3. **Stats-sheet consent.** Row 3 sends three GETs on every Stats-sheet open
   with no consent; the parallel Listening-History screen claims "nothing is
   sent." Reconcile the two privacy claims (deviation DH5) — either disclose the
   Stats fetch in-screen or make it explicit.
4. **Proxy URL exposure (row 5).** The metadata proxy forwards the station's
   stream/metadata URL as a query param to the first-party Worker. Confirm the
   Worker does not log these URLs against the requesting IP, or document the
   retention.
5. **Versioning / privacy-manifest field.** There is no shipped contract-version
   or privacy-manifest version field tying a build to the matrix above; decide
   whether to add one so store reviews can pin the declared flows to a build.

## Reference

- **Related contracts:** [metadata-fetchers](metadata-fetchers.md) owns the
  request shapes for the iTunes (row 8) and lyrics (row 9) outbound flows;
  [search](search.md) owns the Radio Browser query request shape (row 10).

iOS source the contract was reconciled against:

- `rrradio/Models/RegionResolver.swift` — region/GeoIP resolution, `WorkerAPI.base = "https://stats.rrradio.org"`, 24h cache, fail-open.
- `rrradio/Views/DashboardView.swift` — Stats sheet GETs to `/api/public/{top-stations,totals,locations}`.
- `rrradio/Diagnostics.swift` — local opt-in ring buffer, redacted export, sensitive-key allow-list, and `BrokenStationReporter` POST to `/api/public/report-broken`.
- `rrradio/Views/AddStationView.swift` — `catalogSubmissionMailURL` → `mailto:feedback@rrradio.org`.
- `rrradio/Views/NowPlayingView.swift` — broken-station `mailto:feedback@rrradio.org` fallback; music-service deep links.
- `rrradio/Player/Metadata/DirectMetadataFetchers.swift` — `/api/public/proxy`, `/api/public/bbc`, broadcaster APIs (laut.fm, ffh, radioeins, grrif).
- `rrradio/Player/Metadata/CoverArtFetcher.swift` — `itunes.apple.com/search` (artist+title).
- `rrradio/Player/Metadata/LyricsFetcher.swift` — LRCLIB + Lyrics.ovh (artist+title).
- `rrradio/Player/Metadata/MusicServiceLinks.swift` — Apple/Spotify/YT Music search links.
- `rrradio/Models/RadioBrowserClient.swift` — search query to radio-browser.info mirrors.
- `rrradio/Models/Catalog.swift` — `rrradio.org/stations.json` fetch.
- `rrradio/Images/RemoteImageCache.swift` — byte-budgeted favicon/cover fetch + cache.
- `rrradio/Views/AboutView.swift` — in-app privacy disclosure copy and links.
- `rrradio/CloudSync/CloudSyncStore.swift` — `iCloud.ios.rrradio.org` container (user's private DB).

## Known deviations

- **Developer-personal infrastructure exposure — RESOLVED at `9336321`.** Five
  production paths previously routed user data (IP, station IDs, stream hosts,
  user email return address) to a developer-personal Cloudflare Workers
  subdomain (`stats.rrradio.org`) and personal Gmail
  (`redsukramst@gmail.com`). Migrated to `stats.rrradio.org` and
  `feedback@rrradio.org` by commit `2cd5cff` ("PR2: privacy boundary"). The
  contract above states the corrected intent; the original findings:
  - `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice11.md` (M3/M4 — RegionResolver region endpoint, IP exposure).
  - `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice20.md` (D1 — BrokenStationReporter endpoint; D3 — `recentSummary` text-selection bypassing redaction; D2 — no idempotency on report).
  - `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice22.md` (AS2 — AddStation mailto → personal Gmail).
  - `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice23.md` (DH1 — DashboardView stats GETs; DH5 — privacy-posture inconsistency "nothing is sent" vs. silent stats fetch).
  - `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice24.md` (N2 — NowPlayingView mailto fallback → personal Gmail).
  - Roll-up + remediation plan: `rrradio-ios/internal/audit/2026-05-25-fixes-prioritized.md` (PR 2).
- **Stats-sheet silent fetch with no failure distinction (DH4)** —
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice23.md`. A failed
  stats fetch is rendered identically to a genuinely empty week.
- **Diagnostics on-screen text-selection bypasses export redaction (D3)** —
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice20.md`. The
  contract intent is that anything copyable matches the redacted export.
