# Spec Coverage Matrix

```yaml
id: rrradio-spec-coverage
status: living
created: 2026-05-31
```

The single source of truth for *what is specified and how current it is*. Every
spec file appears here once. Update the row when you create, deepen, or reconcile
a doc. See `STYLE.md` for templates and the reconciliation ritual.

**Status:** `TODO` (not started) · `draft` (written, unreviewed) · `review` ·
`approved` · `deepen` (exists at product level, needs exhaustive pass).

**Reconciled @:** the iOS commit the doc was last verified against
(`—` = never).

## Contracts (`contracts/*`) — cross-platform invariants

| Doc | Status | Reconciled @ | iOS source of truth |
|---|---|---|---|
| catalog-schema | review | d241aa9 | `Shared/Station.swift`, `Models/Catalog.swift`, `Models/StreamQuality.swift` (`StreamQualityBucket`) |
| playback-state-machine | review | d241aa9 | `Player/AudioPlayer.swift`, `Shared/StationPlaybackQueue.swift` |
| metadata-fetchers | review | d241aa9 | `Player/Metadata/*` |
| search | review | d241aa9 | `Search/*`, `Models/RadioBrowserClient.swift`, `Resources/stations.fts5.db` |
| sync-merge | review | 8fc085b | `CloudSync/*` |
| privacy-data-boundaries | review | d241aa9 | `Models/RegionResolver.swift`, `Views/DashboardView.swift`, `Views/AddStationView.swift`, `Diagnostics.swift` |
| broken-reports | review | d241aa9 | server `worker/src/reports.ts`; iOS `Models/BrokenStationReports.swift`, `Views/BrokenReportResolvedToast.swift`, `Views/NowPlayingView.swift` (report sheet) |
| watch-protocol | approved | d241aa9 | `Shared/WatchRemoteProtocol.swift`, `WatchRemote/*`, `rrradioWatch/*` |
| localization | review | d241aa9 | `Views/LocaleController.swift`, `Resources/Localizable.xcstrings` |

## Features (`features/*`) — observable behavior

| Doc | Status | Reconciled @ | iOS source of truth |
|---|---|---|---|
| navigation | review | 8fc085b | `Views/ContentView.swift` (`BottomTabBar`, `AppTab`), `Views/FeedPages/LibraryHomePage.swift`, `Views/LibraryListSelection.swift`, `Views/FeedPages/FavoritesPage.swift` |
| browse | review | d241aa9 | `Views/FeedPages/BrowsePage.swift`, `Views/FeedPages/BrowseFiltersSheet.swift`, `BrowseSortRow`, `Views/StationMapView.swift` |
| search | review | d241aa9 | `Search/*`, `Views/FeedPages/BrowsePage.swift` |
| favorites | review | d241aa9 | `Views/FeedPages/FavoritesPage.swift`, `Views/StationKit.swift`, `Library/Library.swift` |
| station-lists | review | 8fc085b | `Library/Library.swift`, `Views/FeedPages/*`, `BrowseSelectionDock` |
| custom-stations | review | d241aa9 | `Views/AddStationView.swift`, `Library/StreamProbe.swift`, `Library/CustomStationBuilder.swift` |
| now-playing | review | d241aa9 | `Views/NowPlayingView.swift`, `MiniPlayerView`, `Player/Metadata/MusicServiceLinks.swift` |
| metadata-artwork | review | d241aa9 | `Player/Metadata/*` |
| sleep-timer | review | d241aa9 | `Player/SleepTimer.swift` |
| wake-to-radio | review | d241aa9 | `Player/WakeAlarm.swift` |
| listening-history | review | d241aa9 | `Library/ListeningHistory.swift`, `Views/DashboardView.swift`, `Views/ListeningRaceChart.swift` |
| watch-remote | approved | d241aa9 | `rrradioWatch/*`, `WatchRemote/PhoneRemoteControlController.swift` |
| siri-shortcuts | review | d241aa9 | `Shortcuts/*` |
| first-run-offline | review | d241aa9 | `App.swift`, `Models/Catalog.swift`, `Views/CatalogLoadingSplash.swift` |
| preferences-diagnostics | review | d241aa9 | `Views/SettingsView.swift`, `Views/ThemeController.swift`, `Player/CarModeController.swift`, `Diagnostics.swift` |

## Cross-cutting (`*.md`)

| Doc | Status | Reconciled @ | Notes |
|---|---|---|---|
| platforms | review | 8fc085b | links all 9 contracts; adaptive-layout/landscape note still light (now-playing.md owns the split) |
| playback | review | d241aa9 | links `contracts/playback-state-machine.md` |
| data-sync | review | 8fc085b | links `contracts/sync-merge.md` + `contracts/privacy-data-boundaries.md` |

## Web reconciliation

The **Web** column of every doc's Platform Matrix was verified against web `main`
(`dfc848467`, 2026-06-13) — one agent per doc reading the actual `src/`
implementation. 113 Web matrix cells were corrected; the web app is a focused
subset of the finalized product intent. Web source of truth per area: catalog
`src/builtins.ts` `src/stations.ts`; playback `src/player.ts`; metadata
`src/fetchers.ts` `src/metadata.ts` `src/coverArt.ts` `src/lyrics.ts`; search
`src/radioBrowser.ts` `src/main.ts`; storage/backup `src/storage.ts`
`src/backup.ts`; privacy/telemetry `src/telemetry.ts` `src/errors.ts`
`src/region.ts`; reports `src/reportBroken.ts`; render `src/render-*.ts`
`src/np-*.ts`.

Surfaces the web app does **not** implement (all now honest in the matrices):
FTS search index (substring only), cross-platform playback queue (favorites-only
skip), automatic retry budget/backoff, i18n (English-only, no key registry),
personal listening history, named station lists, a Settings sheet, custom-station
probe/dup-check/edit, offline/PWA support, and the broken-report receipt
lifecycle (fire-and-forget POST only). The reconciliation did **not** edit the
product-intent body, iOS/Android cells, or stamps — only Web cells + web notes.

**Update (2026-06-14):** since that snapshot the web app shipped a three-tab
**Browse / Favorites / Library** shell + Library home ([navigation](features/navigation.md)),
named **station lists** (in-app inline create / rename / delete + per-row
add-to-list sheet), a **Settings sheet**, the user poll's removal, and a **v3
backup** (favorites + custom + lists + recents + settings). The matching Web cells
in README, navigation, station-lists, data-sync, sync-merge, platforms, and
now-playing were corrected and those docs re-stamped @ `8fc085b`. The other items
in the "not implemented" list above (FTS search, a real playback queue, retry
budget, i18n, listening-history feature, custom-station probe, offline/PWA, report
receipts) still stand.

## Android reconciliation

The **Android** column of every doc's Platform Matrix was verified against the
`android/` Kotlin (Jetpack Compose + media3) app at repo `main` (`a1e51421a`,
2026-06-13) — one agent per doc. 154 Android cells were corrected. Per the
sponsor's **aspirational iOS-parity** directive, unbuilt-but-intended features
read `Planned` (not "Not planned"), with native-mechanic notes (Android Auto ↔
CarPlay, foreground `MediaSessionService` ↔ background audio, AlarmManager
exact-alarm ↔ wake alarm, App Actions/Assistant ↔ Siri, SAF ↔ file backup).
Android source of truth per area: catalog/library `data/*.kt`; playback
`playback/*.kt` (real queue + retry + `RadioPlaybackService`); metadata
`metadata/*.kt`; UI `ui/RrradioApp.kt` `ui/RrradioViewModel.kt`.

Android is a fuller port than web in places — it ships a steppable de-duped
**queue**, **retry**, named **station lists** (rename / create-from-select /
play-as-queue), opt-in **listening history**, a **sleep timer** with a persisted
default, **local diagnostics** (opt-in, capped, redacted, SAF export), and a SAF
**backup** covering favorites + custom + lists + preferences. It does **not** yet
implement: wake-to-radio, i18n (English-only), the Radio Browser community search
tier, a music-service rail, Android Auto, GeoIP/region resolution, or the
broken-report receipt lifecycle (fire-and-forget POST only) — all now `Planned`
in the matrices. The reconciliation edited only Android cells + Android notes.

## Meta

| Doc | Status | Notes |
|---|---|---|
| README | updated | spec map split (features + contracts tiers), maintenance ritual; parity matrix verified iOS @ `d241aa9`, **Web + Android @ repo `a1e51421a`**; broken-reports & localization rows added |
| STYLE | approved | authoring standard |
| COVERAGE | living | this file |
