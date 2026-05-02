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
- Plays any station via `AVPlayer` — MP3, AAC, HLS all handled.
- Lock-screen now-playing card via `MPNowPlayingInfoCenter` +
  `MPRemoteCommandCenter` (play / pause / AirPods controls).
- Background audio (`UIBackgroundModes: [audio]` in Info.plist).
- HLS-stream ICY metadata via `AVPlayerItem.timedMetadata` — surfaces
  artist/title automatically when the broadcaster wraps it that way.

What's not here yet (iterative — see `bd ready`):

- Per-broadcaster JSON metadata fetchers (BR / HR / Antenne / SRG SSR /
  MDR / SR / SWR / FFH / Klassik / laut.fm / RBB Radio Eins). Each one
  in `src/builtins.ts` becomes a small Swift file under
  `rrradio/Player/Fetchers/`.
- Raw-Icecast ICY-over-fetch (the `icyFetcher` path from
  `src/metadata.ts`) — needs a hand-rolled bytes reader since AVPlayer
  doesn't expose Icecast metadata directly.
- Favorites + recents (UserDefaults / SwiftData).
- Sleep timer + wake-to-radio (BackgroundTasks + UNUserNotificationCenter).
- Genre + country filters.
- Map view (MapKit).
- Add custom station sheet.

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
    Catalog.swift            — fetch + cache stations.json
  Player/
    AudioPlayer.swift        — AVPlayer wrapper, lock-screen, ICY hooks
  Views/
    ContentView.swift        — root NavigationStack + mini-player inset
    StationListView.swift    — searchable list of stations
    MiniPlayerView.swift     — bottom bar over every screen
    NowPlayingView.swift     — full-screen sheet with controls
  Resources/
    Assets.xcassets/         — AppIcon + AccentColor placeholders
project.yml                  — xcodegen project definition
.gitignore                   — Xcode build / DerivedData / xcuserdata
```

Source files use `@Observable` (Swift 5.9+ macro) — the modern SwiftUI
state pattern, no Combine boilerplate.

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
