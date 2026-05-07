# rrradio — iOS

SwiftUI + AVFoundation native client. Phase 2 of the rrradio plan
(Phase 1 is the web app at the repo root).

The iOS app reuses the same backend infrastructure as the web client:

- **Catalog** comes from `https://rrradio.org/stations.json` at launch
  (the same `public/stations.json` published by `tools/build-catalog.mjs`
  on every web deploy). Catalog updates land without an App Store
  release.
- **Cloudflare Worker proxy** at `rrradio-stats.markussteinbrecher.workers.dev`
  handles broadcaster APIs that lack CORS — same allowlist as the web.
  iOS doesn't strictly need the proxy (no CORS in native), but routing
  through it keeps the auth + rate-limiting story consistent.

## Status (v0.1)

What works in this scaffold:

- Loads the catalog (with disk cache for offline boot).
- Search across name + tags + country, whitespace-insensitive
  (matches the web's "WDR5 → WDR 5" behaviour).
- Filter browsing by country and tag.
- Plays any station via `AVPlayer` — MP3, AAC, HLS all handled.
- Favorites + recents persisted locally in `UserDefaults`.
- Add custom HTTPS streams, saved locally and playable immediately.
- Sleep timer cycles through off / 15 / 30 / 60 / 90 minutes and
  pauses playback when it fires.
- Lock-screen now-playing card via `MPNowPlayingInfoCenter` +
  `MPRemoteCommandCenter` (play / pause / AirPods controls).
- Background audio (`UIBackgroundModes: [audio]` in Info.plist).
- HLS-stream ICY metadata via `AVPlayerItem.timedMetadata` — surfaces
  artist/title automatically when the broadcaster wraps it that way.
- ORF/FMx, AzuraCast, Laut.FM, Streamabc, SWR, MDR, FFH, RBB Radio Eins,
  ČRo, SRG SSR IL, Radio Swiss, SRR, MR, BR, BBC, HR, Antenne,
  Radio Bremen, and SR metadata polling via the shared `metadataUrl`
  catalog field.
- Raw-Icecast/Shoutcast ICY-over-fetch for catalog entries marked
  `status: icy-only`, using a bounded `URLSession.bytes(for:)` reader.

What's not here yet:

- Wake-to-radio (BackgroundTasks + UNUserNotificationCenter).
- Map view (MapKit).

## Building

You need Xcode 15.4+ (iOS 17 SDK).

### Recommended: xcodegen

```sh
brew install xcodegen
cd ios
xcodegen
open rrradio.xcodeproj
```

`xcodegen` materializes `rrradio.xcodeproj` from `project.yml`. The
`.xcodeproj` is gitignored — `project.yml` is the source of truth, so
re-run `xcodegen` after pulling changes that touch sources or settings.

### Alternative: manual Xcode

If you'd rather not use xcodegen:

1. Open Xcode → **File → New → Project → iOS → App**.
2. Product Name `rrradio`, Interface **SwiftUI**, Language **Swift**,
   minimum deployment **iOS 17.0**.
3. Save the new `.xcodeproj` directly into `ios/`.
4. Drag the existing `rrradio/` source folder into the Project navigator
   (choose "Create groups", do **not** copy items).
5. Delete the auto-generated `ContentView.swift` and `rrradioApp.swift`
   — the ones in `rrradio/Views/` and `rrradio/App.swift` replace them.
6. In the target's **Signing & Capabilities**, add **Background Modes →
   Audio, AirPlay, and Picture in Picture** (or paste the
   `UIBackgroundModes: [audio]` key into Info.plist).

## Running

- iPhone simulator: select any iPhone → ⌘R.
- Real device: plug in, select it, ⌘R. First run prompts to trust the
  developer certificate.
- Audio in the simulator routes through your Mac's audio output. Lock-
  screen testing requires a real device.

## Code map

```
rrradio/
  App.swift                  — @main, wires Catalog + AudioPlayer envs
  Models/
    Station.swift            — JSON shape mirroring src/types.ts
    Catalog.swift            — fetch + cache stations.json (@MainActor)
  Player/
    AudioPlayer.swift        — AVPlayer wrapper, lock-screen, ICY hooks
                               (@MainActor — KVO + Combine hop to main)
    SleepTimer.swift         — off / 15 / 30 / 60 / 90 minute timer
    Metadata/
      NowPlayingMetadata.swift — metadata model + fetcher registry
      MetadataPoller.swift     — station-scoped polling lifecycle
      OrfMetadataFetcher.swift — ORF audioapi parser/fetcher
      DirectMetadataFetchers.swift — direct broadcaster JSON/HTML parsers
      IcyMetadataFetcher.swift — raw Icecast/Shoutcast StreamTitle reader
  Library/
    Library.swift            — UserDefaults-backed favorites + recents
    CustomStationBuilder.swift — HTTPS-only custom station validation
  Search/
    Search.swift             — normalizeForSearch + stationMatches
    StationFilters.swift     — country/tag option extraction + matching
  Views/
    ContentView.swift        — root NavigationStack + mini-player inset
    StationListView.swift    — searchable list of stations
    StationFilterView.swift  — country/tag filter picker
    AddStationView.swift     — custom station form + local list
    MiniPlayerView.swift     — bottom bar over every screen
    NowPlayingView.swift     — full-screen sheet with controls
  Resources/
    Assets.xcassets/         — AppIcon + AccentColor placeholders
rrradioTests/                — XCTest target (audit #72)
  CatalogDecodingTests.swift
  CatalogCacheTests.swift
  SearchTests.swift
  AudioPlayerStateTests.swift
project.yml                  — xcodegen project definition
.gitignore                   — Xcode build / DerivedData / xcuserdata
```

Source files use `@Observable` (Swift 5.9+ macro) — the modern SwiftUI
state pattern, no Combine boilerplate. The two `@Observable` classes
(`AudioPlayer`, `Catalog`) are also `@MainActor` so SwiftUI's tracking
never sees an off-main mutation. AVPlayer KVO and Combine sinks hop to
main via `Task { @MainActor in … }` and `.receive(on: DispatchQueue.main)`.

## Tests

```sh
cd ios
xcodegen
xcodebuild test \
  -project rrradio.xcodeproj \
  -scheme rrradio \
  -destination 'platform=iOS Simulator,name=iPhone Air'
```

Test targets:
- **CatalogDecodingTests** — JSON shape matches the published
  `stations.json`; unknown keys are tolerated.
- **CatalogCacheTests** — initial state contract + canonical URL.
  Full URL-session fallback path needs a DI refactor; tracked as a
  follow-up.
- **LibraryTests** — favorites persistence, reordering, recent dedupe
  and limit, custom station persistence.
- **CustomStationBuilderTests** — custom stream validation, HTTPS-only
  rule, tag/country normalization.
- **SearchTests** — `normalizeForSearch` + `stationMatches` parity
  with the web's `format.test.ts` (incl. "WDR5" → "WDR 5").
- **StationFiltersTests** — country/tag option extraction and combined
  filter matching.
- **AudioPlayerStateTests** — `play` / `pause` / `resume` / `stop` /
  `toggle` contract from the `idle` state. Real AVPlayer playback is
  not exercised — that needs a device or a UI test, out of scope for
  the CI baseline.
- **SleepTimerTests** — web-compatible duration cycle, cancel, and fire
  state transitions.
- **OrfMetadataFetcherTests** — ORF live/detail JSON parsing and
  fetcher registry resolution.
- **DirectMetadataFetcherTests** — direct broadcaster JSON/HTML/XML parsing
  plus fetcher registry resolution.
- **IcyMetadataFetcherTests** — ICY `StreamTitle` parsing, precise
  `icy-metaint` extraction, brute-force scan fallback, Latin-1 fallback,
  and `icy-only` registry resolution.

CI runs the same flow on `macos-15` via
`.github/workflows/ios.yml` (triggers only on `ios/**` changes to
keep macOS minutes contained).

## Conventions shared with the web app

These mirror the Phase-1 decisions in the root `CLAUDE.md`:

- Catalog format: YAML source → JSON build artifact. Read-only on iOS.
- Fetcher families align: when the web wires a new broadcaster
  fetcher in `src/builtins.ts`, port it to Swift here. The fetcher key
  in YAML (e.g. `metadata: srgssr-il`) is the contract.
- Per-broadcaster `metadataUrl` shapes are stable. Match the web's
  parsing 1:1 — same Worker proxy URLs, same JSON paths.
- Status taxonomy (`working` / `icy-only` / `stream-only`) is the same
  here. Only the publishable three appear in `stations.json`.

## Worker proxy details

The Worker URLs and proxy contract are documented at
`../worker/README.md`. iOS calls the same `/api/public/proxy?url=…`
endpoint when it needs to talk to a CORS-locked broadcaster API.
Native iOS doesn't have CORS, so we *could* call those APIs directly,
but using the Worker keeps the rate-limit / cache story consistent and
means the broadcaster only sees one User-Agent across both platforms.

## Releasing to the App Store

When v1.0 is feature-complete enough to ship, see **[RELEASING.md](./RELEASING.md)**
for the step-by-step path from a working local build to a published
App Store listing — Apple Developer Program enrollment, bundle ID
+ capabilities setup, App Store Connect record, required assets,
TestFlight, submission, common rejection reasons.

## License / public-repo note

This repo (and so this iOS source) is public on GitHub. If we ever
ship paid features or want to keep iOS-specific logic private, split
`ios/` into its own private repo and import the catalog as a
separate artifact.
