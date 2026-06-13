# Metadata Fetchers Contract

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

- Pins the cross-platform contract for turning a live stream into now-playing
  text, program info, cover art, and lyrics.
- Defines the **fetcher registry** (which source a station routes to), the
  **per-source request/parse contract** (URL pattern, response format, field
  mapping, null-vs-error), the **cover-art fallback chain**, the **lyrics
  lookup**, and the **program-schedule fetch**.
- Every platform must select the same fetcher for the same station, hit the same
  endpoints, map the same fields, and apply the same null-vs-error rule, so a
  track shows identically on web, iOS, and Android.
- Consumes the catalog metadata fields and capability hints defined in
  [`../features/metadata-artwork.md`](../features/metadata-artwork.md); this
  contract does not re-state catalog/privacy/curation rules
  (see [`../operations.md`](../../operations.md)).

## Definition

A station carries three catalog fields that drive routing (defined in
[catalog-schema](catalog-schema.md)):

- `metadata` — fetcher **key** (string) into the registry below.
- `metadataUrl` — broadcaster endpoint or fetcher-specific argument (string).
- `status` — when `"icy-only"`, forces the generic ICY path.

### Routing (registry resolution order)

Resolution is **ordered**; the first match wins. The key (`station.metadata`)
selects the broadcaster fetcher; `metadataUrl` and `status` participate in the
ORF and ICY special cases.

1. **ORF** — `metadata == "orf"` **OR** `metadataUrl` contains
   `audioapi.orf.at`.
2. **FM4 stream rewrite** — `streamUrl` matches
   `orf-live\.ors-shoutcast\.at/fm4-`; the fetcher rewrites the station to
   `metadata = "orf"`, `metadataUrl = https://audioapi.orf.at/fm4/api/json/4.0/live`
   and runs ORF.
3. **Keyed broadcaster fetchers** — exact `metadata` string match against the
   key table in *Detail*.
4. **ICY fallback** — `status == "icy-only"` → generic ICY `StreamTitle` scrape.
5. No match → no fetcher (`nil`); now-playing stays blank for that station.

### Full now-playing resolution (combined pipeline)

Routing above produces the *primary* fetcher. The full per-station resolution
that callers run layers two transport fallbacks and a cover-art enrichment step:

1. Resolved fetcher = primary registry fetcher **unless** `status == "icy-only"`
   (in which case the registry is skipped here and ICY runs as the explicit
   step 2). If the resolved fetcher returns non-nil → use it.
2. Else if `status == "icy-only"` → run generic ICY scrape.
3. Else if `streamUrl` path extension is `m3u8` → run HLS timed-metadata
   (ID3) scrape.
4. Else → no metadata (`nil`).
5. **Cover enrichment**: if a `title` exists and the fetcher result has no
   `coverUrl` (or a low-resolution one), run the cover-art lookup chain and
   attach the result.

### Output shape — `NowPlayingMetadata`

The struct this contract produces is consumed by the now-playing-info table in
[playback-state-machine](playback-state-machine.md), which maps these fields
onto the system media surface (lock screen / Control Center).

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `artist` | string | yes | Track artist; nil for talk/program-only sources. | — |
| `title` | string | yes | Track title; nil for program-only sources. | — |
| `raw` | string | no (may be `""`) | Lock-screen / fallback label (`"Artist - Title"` or a program headline). | `""` |
| `programName` | string | yes | Current show/broadcast name. | nil |
| `programSubtitle` | string | yes | Show subtitle / host / addon. | nil |
| `coverUrl` | URL | yes | Provider-supplied cover; later upgraded via the cover chain. | nil |

### Null vs error (uniform across all fetchers)

- **`nil` (no metadata)** — transport succeeded but there is nothing to show:
  station offline flag set, no current track/program, empty title, status field
  not "playing"/"now", non-music class. Pollers treat this as "clear / keep
  prior" without logging an error.
- **`throw` (error)** — transport failure: non-2xx HTTP, undecodable body,
  unparseable response. Pollers log a **coarse** diagnostic only (station name +
  `URLError` code), never the URL, title, or artist.

## Detail

### Fetcher registry

`req` = request shape; `fmt` = response format. URLs come from `metadataUrl`
unless a fixed endpoint is noted. "Title-cased" = each word's first letter
upper-cased (see *Known deviations* M6).

| Key (`metadata`) | Source | Endpoint / `metadataUrl` use | fmt | Maps → | Null when |
|---|---|---|---|---|---|
| `orf` | ORF audioapi (+ FM4) | `metadataUrl` = live JSON; follows `href` to a detail JSON | JSON ×2 | item `type=="M"` → artist=`interpreter`, title=`title`, cover=largest `images[].versions[].path`; else program=`title`/`subtitle` | no current broadcast window, and no program title |
| `azuracast` | AzuraCast `nowplaying` | `metadataUrl` direct | JSON | artist=`now_playing.song.artist`, title=`.title` | `is_online==false`, empty title, or title matches `^station offline$` |
| `laut-fm` | laut.fm | `https://api.laut.fm/station/{slug}/current_song` (`metadataUrl`=slug) | JSON | title=`title`, artist=`artist.name` (title-cased) | `type` set and `!= "song"`, or empty title |
| `streamabc` | StreamABC | `metadataUrl` direct | JSON | title=`song`, artist=`artist` (title-cased) | empty `song` |
| `swr` | SWR | `metadataUrl` direct | JSON | first `playlist.data[]`: title=`title`, artist=`artist` (title-cased) | no playlist item / empty title |
| `ffh` | FFH | fixed `update-onair-info` endpoint; `metadataUrl`=mount (default `ffh`) | JSON (array of maps) | matched mount: title=`title`, artist=`artist` (title-cased) | mount `claim==true`, empty title |
| `mdr` | MDR | `metadataUrl` direct; injects `startdate`=Europe/Berlin `yyyyMMdd` when URL contains `xmlresp-index.do` | JSON | song with `status=="now"` (else first): title=`title`, artist=`interpret` (title-cased) | no song / empty title |
| `rbb-radioeins` | rbb radioeins | fixed `now_on_air.html` + cache-bust `_` | HTML | regex `<p class="artist">…</p><p class="songtitle">…</p>` → artist, title | no regex match / empty title |
| `cro` | Český rozhlas | `metadataUrl` direct | JSON | title=`data.track`, artist=`data.interpret` (title-cased) | `data.status != "playing"`, empty track |
| `srgssr-il` | SRG SSR Integration Layer | `metadataUrl` + `from`/`to` (now −3h/+1h) + `pageSize=3` | JSON | song `isPlayingNow==true` (else first): title=`title`, artist=`artist.name` with trailing `(XX)` stripped (title-cased) | no song / empty title |
| `swiss-radio` | Radio Swiss (Classic/Jazz/Pop) | `metadataUrl` direct | JSON | title=`channel.playingnow.current.metadata.title`, artist=`.artist` (**no** title-case) | empty title |
| `srr` | SRR live (program) | `metadataUrl` = `"{url}#{stationKey}"` | JSON | program-only: `raw`/`programName`=station `title`, `programSubtitle`=`schedule` | bad split / empty title |
| `mr` | MR (XML name) | `metadataUrl` direct | XML | `<Name>` → split on ` - ` into artist/title (title-cased); single-part → title only | empty `<Name>` |
| `br-radioplayer` | BR Radioplayer | `metadataUrl` via Worker proxy | JSON (lenient) | current track (time-windowed; else first): title=`title`, artist=`interpret`; when the track has no artist, also surfaces the current broadcast `headline` as `programName` and `broadcastSeriesName` (when ≠ headline) as `programSubtitle`; with no track, falls back to broadcast `headline`/`broadcastSeriesName` as program-only | no track and no broadcast headline |
| `bbc` | BBC | `{worker}/api/public/bbc/play/{service}` (`service`=last path of `metadataUrl`) | JSON | program-only: module `id=="live_play_area"` first item → `programName`=`titles.primary`, `programSubtitle`=`titles.secondary` | empty primary title |
| `hr` | HR (program + ICY) | `metadataUrl` via Worker proxy (program); ICY in parallel | JSON + ICY | **ICY wins if present**; else current broadcast (`currentBroadcast==true`, else time-windowed): `programName`=`title`, `programSubtitle`=`mit {hosts.name}` | no ICY and no current title |
| `antenne` | ANTENNE | `metadataUrl` = `"{apiUrl}#{mountpoint}"`; apiUrl via Worker proxy | JSON | matched mount, `class=="Music"`: title=`title`, artist=`artist` (title-cased) | non-Music class, empty title |
| `grrif` | GRRIF | fixed `https://www.grrif.ch/live/covers.json` + cache-bust `_` (no `metadataUrl`) | JSON (array) | **last** entry: title=`Title`, artist=`Artist` (title-cased), cover=`URLCover` (skips `…/default.jpg`) | empty title |
| `rb-bremen` | Radio Bremen | `metadataUrl` via Worker proxy | JSON | program-only: `programName`=`currentBroadcast.title`, `programSubtitle`=`.titleAddon` | empty title |
| `sr` | SR (Saarländischer Rundfunk) | `metadataUrl` via Worker proxy | JSON | program-only: first `"now playing"` value → `programName`=`titel`, `programSubtitle`=`moderator` | empty titel |
| *(none)* + `status=="icy-only"` | Generic ICY | `streamUrl` with `Icy-MetaData: 1` | binary | `StreamTitle='…'` → split on ` - ` → artist/title | no `StreamTitle` found within scan budget |

### Generic ICY (`StreamTitle`) parse

- Request the **stream** with header `Icy-MetaData: 1`.
- If the response carries an `icy-metaint` header (case-insensitive): read
  exactly `metaint` audio bytes, then 1 length byte (`× 16` = block size), then
  the metadata block; extract `StreamTitle='…'` from it.
  - Accepted `metaint`: `> 0` and `<= 98304` (96 KiB).
  - Max metadata block: `255 × 16 = 4080` bytes; a zero-length block → `""`.
- If no `metaint`: scan the byte stream for the literal `StreamTitle='`, capture
  up to the closing `'`, capping the scan at **98304 bytes (96 KiB)**.
- Decode bytes as UTF-8; if it contains U+FFFD, fall back to ISO-8859-1.
- `StreamTitle` parse: split on the first ` - ` with non-empty sides →
  `artist`/`title`; otherwise the whole string is `title`. `raw` = trimmed
  original.

### HLS timed metadata (ID3)

- Applies only when `streamUrl` path extension is `m3u8`.
- Fetch the playlist, take the **last** non-comment line as the media segment
  URL, request its first **98304 bytes (96 KiB)** via `Range: bytes=0-98303`.
- Parse ID3 text frames: `TIT2` → title, `TPE1` → artist; with title only,
  re-run the `StreamTitle` split heuristic.

### Cover-art fallback chain

Cover resolution is **ordered**; the first non-nil wins:

1. **Provider cover** — `coverUrl` returned by the fetcher (ORF images, GRRIF
   `URLCover`). Skipped/replaced if the URL is *low-resolution* (`/medias/covers/m/`,
   `/50x50/`, or the SRG `cdne-satr-prd-rsp-covers` `50/` path).
2. **Station favicon** — the catalog `favicon` is the station-art source
   (per [`../features/metadata-artwork.md`](../features/metadata-artwork.md)).
   *Platform note:* on iOS this favicon fallback feeds the **system media
   surface** (lock screen / Control Center artwork = provider cover ?? favicon);
   the in-app now-playing artwork instead falls back to the animated rrradio
   dot-matrix logo when no provider/iTunes cover resolves.
3. **iTunes Search** — `https://itunes.apple.com/search?term={artist title}&entity=song&limit=5&media=music`
   (`term` = `artist` + space + `title`, truncated to 100 chars);
   best match's `artworkUrl100` upgraded to `600x600bb`. Requires title ≥ 3
   chars and not `-`/`—`. Result cached (64-entry LRU).
4. **MusicBrainz / Cover Art Archive** — *not implemented on iOS, and not
   implemented on web either* (a forward-looking enrichment step in the shared
   chain that no shipped platform currently runs; see *Platform obligations* and
   *Open questions*).
5. **Spotify** — *not implemented as a cover source on any platform*; both web
   and iOS only link out to Spotify search (see music-service links below).

### iTunes Search dual role

The same iTunes call returns `{hit, cover, appleMusicUrl}`:

- `hit` is a **genuine artist/title match**, not raw `resultCount`: a hit
  requires the best result's title (and, when metadata carries one, its artist)
  to corroborate the query — with no artist, the iTunes track title must
  *contain* the full query title. There is deliberately **no** "take the top
  result" fallback. `hit` gates the **music-service buttons** — Apple Music /
  Spotify / YouTube Music links surface only when iTunes confirms the title is a
  real searchable track (suppresses station IDs / news headlines that iTunes
  fuzzy-matches to unrelated songs).
- `appleMusicUrl` (`trackViewUrl`) deep-links the Apple Music button to the
  exact song; Spotify/YouTube Music stay on search URLs.
- Transport errors return `.miss` **without caching** (lets the next poll
  retry); non-2xx is cached as `.miss` for the cache lifetime.

### Music-service links

| id | Label | Search URL |
|---|---|---|
| `apple-music` | Apple Music | `https://music.apple.com/search?term={q}` (overridden by `appleMusicUrl` when present) |
| `spotify` | Spotify | `https://open.spotify.com/search/{q}` |
| `youtube-music` | YouTube Music | `https://music.youtube.com/search?q={q}` |

Query `q` = `"{artist} - {title}"` (or title alone). Each service has a per-app
enable toggle, default ON.

### Lyrics lookup

Ordered; first hit wins:

1. **LRCLIB** — `https://lrclib.net/api/get?artist_name={artist}&track_name={track}`;
   `plainLyrics` and/or `syncedLyrics` (LRC). `instrumental==true` → caches a
   definitive "no lyrics" (nil) and stops.
2. **Lyrics.ovh** — `https://api.lyrics.ovh/v1/{artist}/{track}`; `lyrics` →
   plain text only.

Results (including nil "not found") are cached in a 256-entry FIFO cache keyed
by lowercased `artist::track`.

### Program-schedule fetch

- A separate fetcher from now-playing; **ORF-only** (plus FM4 via the same
  stream rewrite as routing step 2).
- Routes when `metadata == "orf"` or `metadataUrl` contains `audioapi.orf.at`.
- Endpoint: the `audioapi.orf.at/{channel}/api/json/4.0` base (regex-extracted
  from `metadataUrl`) + `/broadcasts`.
- Returns `[ProgramScheduleDay]` (each: `date`, `[broadcast]` with
  `start`/`end` epoch-ms → `Date`, `title` (default `"Untitled"` when blank),
  HTML-stripped `subtitle`); empty days dropped; all-empty → nil.

## Examples

ICY `StreamTitle` split:

```
StreamTitle='Daft Punk - Get Lucky';   →   artist="Daft Punk", title="Get Lucky", raw="Daft Punk - Get Lucky"
StreamTitle='Nachrichten 12:00 Uhr';   →   artist=nil, title="Nachrichten 12:00 Uhr", raw=same
```

AzuraCast response → output:

```json
{ "now_playing": { "song": { "artist": "Boards of Canada", "title": "Roygbiv" } }, "is_online": true }
```
→ `artist="Boards of Canada", title="Roygbiv", raw="Boards of Canada - Roygbiv"`

`is_online:false` OR `title:"Station offline"` → `nil`.

SRR program-only (`metadataUrl = "https://…/live.json#radio1"`):

```json
{ "stations": { "radio1": { "title": "Morning Show", "schedule": "06:00–09:00" } } }
```
→ `programName="Morning Show", programSubtitle="06:00–09:00", raw="Morning Show"`, artist/title nil.

ORF FM4 stream rewrite: a station whose `streamUrl` matches
`orf-live.ors-shoutcast.at/fm4-…` is rewritten to
`metadataUrl=https://audioapi.orf.at/fm4/api/json/4.0/live`, `metadata="orf"`
before both now-playing and schedule fetches run.

iTunes high-res upgrade:
`…/100x100bb.jpg` → `…/600x600bb.jpg` (regex `/\d+x\d+bb\.(jpg|jpeg|png)/`).

## Versioning & evolution

- The registry **keys** (`metadata` values) are the stable contract; they are
  published by the catalog and must not be renamed without a coordinated catalog
  + all-platforms change.
- Adding a broadcaster = new key + matching fetcher on each platform. Per the
  porting rule in [`../features/metadata-artwork.md`](../features/metadata-artwork.md),
  add/update the native fetcher before marking a station fully parity-supported.
- An unknown `metadata` key is **not** an error: it falls through routing to the
  ICY/HLS fallbacks or to no-metadata. Platforms may add keys independently
  without breaking older clients (forward-compatible).
- `hasScheduleData` (catalog field) is the forward path for declaring schedule
  capability instead of the hardcoded ORF check; see *Open questions*.
- Endpoint shapes (third-party broadcaster JSON/HTML) are **not** versioned by
  rrradio; a broadcaster changing its API breaks that one fetcher → `nil`/error,
  never a crash.

## Failure & fallback

- **Malformed body / undecodable JSON / non-2xx** → fetcher throws; poller logs
  a coarse diagnostic and keeps the prior now-playing value.
- **Missing `metadataUrl`** where required → fetcher returns `nil` (no fetch).
- **No current track/program / offline flag / empty title** → `nil` (clear, not
  error).
- **No registry match** → ICY (if `icy-only`) → HLS (if `.m3u8`) → `nil`.
- **ICY oversized metadata** (block > 4080 bytes, or `metaint` out of range, or
  no `StreamTitle` within 96 KiB) → treated as no metadata.
- **Cover/lyrics provider failure** → that step is skipped; the chain continues
  or yields no art / no lyrics. Transport errors are not cached (retry next
  poll); definitive misses are cached.
- **Decode encoding ambiguity** → UTF-8 first, ISO-8859-1 fallback on U+FFFD.

## Platform obligations

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Same routing order (ORF → FM4 rewrite → keyed → ICY) | MUST | MUST | MUST |
| Same per-source field mapping & null-vs-error | MUST | MUST | Partial (Grrif + ORF/FM4 native; rest planned) |
| Generic ICY `StreamTitle` via `icy-metaint` | MUST (where CORS/proxy allows) | MUST | Partial (basic parser exists) |
| HLS ID3 timed-metadata scrape | Planned (not implemented) | MUST | Planned |
| Cover chain: provider → favicon → iTunes (+ MusicBrainz/Spotify) | Partial (provider/iTunes → favicon; no MusicBrainz, no Spotify cover) | provider → favicon → iTunes only | Partial (provider + iTunes) |
| Program schedule (ORF/FM4) | MUST | MUST | Partial (ORF current-program; full grids planned) |
| Lyrics: LRCLIB → Lyrics.ovh | MUST | MUST | Planned |
| Coarse-only failure diagnostics (no title/artist/URL) | MUST | MUST | MUST |
| Honor `metadataStrategy: none` / `backgroundPollPriority: never` (no stream open) | Planned (fields not yet in catalog/web) | Planned (fields not yet in catalog/iOS) | MUST |

The capability hint layer (`metadataStrategy`, `backgroundPollPriority`,
`hasProgram`/`hasSchedule`/`hasProviderCover`) defined in
[`../features/metadata-artwork.md`](../features/metadata-artwork.md) is the
**forward-looking shared design**: once the catalog publishes those fields, all
platforms MUST honor them. As of the reconciled commit none of these fields
exist on the iOS `Station` model — only `hasScheduleData` is present, and even
it is not yet consulted (routing still hardcodes the ORF/FM4 host check; see
*Open questions*). iOS therefore polls every published station on its standard
cadence regardless of strategy/priority hints.

## Open questions

- **MusicBrainz / Cover Art Archive step**: the shared cover chain names it, but
  no shipped platform implements it — not iOS and not web (web's cover chain is
  provider/iTunes cover → station favicon, with no MusicBrainz lookup). Is it a
  required platform obligation or a future enhancement? (Marked as implemented
  nowhere above, pending decision.)
- **Schedule capability source of truth**: routing still hardcodes ORF/FM4. The
  catalog `hasScheduleData` field exists (iOS prep landed) but the catalog has
  not yet populated it; once published, routing should consult it instead of the
  hardcoded host check. (Tracked: audit slice 12 K6.)
- **Title-casing policy**: most fetchers force title-case, which is lossy for
  acronyms/stylized names. Should normalization move to the catalog/source so
  all platforms agree on casing? (See *Known deviations* M6.)
- **Per-fetcher request timeouts**: no shared contract for max latency; ORF makes
  two sequential un-timed requests. Should the contract pin a max poll budget?
  (See *Known deviations* M4.)

## Reference

- **Related contracts:** [catalog-schema](catalog-schema.md) (defines the
  `metadata`/`metadataUrl`/`status`/`broadcaster`/`favicon`/`hasScheduleData`
  fields this router keys off), [playback-state-machine](playback-state-machine.md)
  (consumes the `NowPlayingMetadata` struct for the system media surface),
  [privacy-data-boundaries](privacy-data-boundaries.md) (owns the privacy matrix
  rows for the iTunes and lyrics request shapes this contract issues).

iOS source (the only place iOS mechanics are named):

- `rrradio/Player/Metadata/NowPlayingMetadata.swift` — output struct + `metadataFetcher(for:)` registry router.
- `rrradio/Player/Metadata/DirectMetadataFetchers.swift` — the keyed broadcaster fetchers (Azuracast, laut.fm, StreamABC, SWR, FFH, MDR, radioeins, CRo, SRG IL, Radio Swiss, SRR, MR, BR, BBC, HR, ANTENNE, GRRIF, Radio Bremen, SR) + Worker-proxy helper.
- `rrradio/Player/Metadata/OrfMetadataFetcher.swift` — ORF audioapi now-playing.
- `rrradio/Player/Metadata/ScheduleFetcher.swift` — ORF/FM4 program-schedule fetch + `scheduleFetcher(for:)`.
- `rrradio/Player/Metadata/IcyMetadataFetcher.swift` — generic ICY `StreamTitle` + HLS ID3 timed-metadata parse.
- `rrradio/Player/Metadata/CoverArtFetcher.swift` — iTunes Search (`searchITunes`/`lookupCoverArt`/`verifyTrack`), low-res detection, 64-entry LRU.
- `rrradio/Player/Metadata/LyricsFetcher.swift` — LRCLIB → Lyrics.ovh, LRC parse, 256-entry FIFO cache.
- `rrradio/Player/Metadata/MusicServiceLinks.swift` — `MusicServiceRegistry` (Apple Music / Spotify / YouTube Music) search/deep-link URLs.
- `rrradio/Player/Metadata/MetadataHelpers.swift` — title-case, raw-label, HTML-strip, loose-JSON, date helpers.
- `rrradio/Player/Metadata/MetadataPoller.swift` — 30 s poll loop; coarse failure diagnostics.
- `rrradio/Player/Metadata/FavoriteNowPlayingStore.swift` — bulk enrichment, concurrency cap (6), and the combined `metadata(for:)` / `fetchMetadata(for:)` resolution pipeline.
- `Shared/Station.swift` — `metadata`, `metadataUrl`, `status`, `favicon`, `hasScheduleData` fields.
- `rrradio/Player/AudioPlayer.swift` — *iOS-only*: in-band `AVMetadataItem` timed-metadata path (foreground) layered alongside the poller; not part of the cross-platform fetcher contract.

## Known deviations

Shipped iOS code that diverges from this intent — the spec states intent, the
audit owns the bug. All under `rrradio-ios/internal/audit/`:

- **M4** — ORF fetcher issues two sequential HTTP requests with no
  `timeoutInterval`; up to ~120 s combined hang on a flaky network blocks the
  30 s poll. (`2026-05-25-ios-code-review-slice6.md`)
- **M6** — `metadataTitleCase` over-normalizes: destroys acronyms (`BBC`→`Bbc`),
  camelCase (`McDonald`→`Mcdonald`), stylized casing (`k.d. lang`→`K.d. Lang`).
  Applied by Azuracast, laut.fm, StreamABC, SWR, FFH, MDR, CRo, SRG IL, MR,
  ANTENNE, GRRIF. (`2026-05-25-ios-code-review-slice6.md`)
- **M7** — `metadataStripHTML` strips tags but does not decode HTML entities
  (`&amp;`, `&quot;`, `&#39;` leak to the lock screen). (`2026-05-25-ios-code-review-slice6.md`)
- **M8** — `bestOrfImage` picks the **largest** available image version, which
  can download multi-MB assets against a 512×512 lock-screen cap. (`2026-05-25-ios-code-review-slice6.md`)
- **M9** — `tryLyricsOvh` allowed-charset omits `+`; artists containing `+`
  encode wrong and mis-query Lyrics.ovh. (`2026-05-25-ios-code-review-slice6.md`)
- **M10** — `pickBestCoverArtMatch` uses substring `contains` on artist names,
  so `John Doe` matches `John Doe Band` and occasionally surfaces wrong artwork.
  (`2026-05-25-ios-code-review-slice6.md`)
- **M11** — `fetchIcyMetadata` (the production streaming path) is not injectable
  through `MetadataDataFetcher`; only the parallel `fetchIcyMetadataFromDataResponse`
  is test-covered. (`2026-05-25-ios-code-review-slice6.md`)
- **M12** — `cleanScheduleTitle` returns the English literal `"Untitled"`
  (not localized). (`2026-05-25-ios-code-review-slice6.md`)

Resolved (recorded for traceability, not current deviations):

- **M1** — the ICY `StreamTitle` byte scan was O(N²) (full re-scan on every
  `0x27`); **fixed** in PR3 (commit `0dcb233`) as a streaming state machine.
- **M2** — MDR `startdate` used GMT instead of the broadcaster's Berlin day;
  **fixed** — the fetcher now injects `Europe/Berlin` `yyyyMMdd`.
- **M3** — the lyrics cache was unbounded (grew for the app's lifetime);
  **fixed** in PR5 — it is now a 256-entry FIFO cache (matches the lyrics-lookup
  description above). *(The slice-6 audit table still lists M3 as Open; the fix
  shipped under the execution-plan label "slice 6 M9", a numbering skew vs the
  audit table where M9 is the Lyrics.ovh `+`-charset bug, which remains open.)*
- **2026-05-18 #2.J** — `FavoriteNowPlayingStore.stop()` not cancelling in-flight
  fetches; **fixed**.
