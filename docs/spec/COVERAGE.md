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
| sync-merge | review | d241aa9 | `CloudSync/*` |
| privacy-data-boundaries | review | d241aa9 | `Models/RegionResolver.swift`, `Views/DashboardView.swift`, `Views/AddStationView.swift`, `Diagnostics.swift` |
| broken-reports | review | d241aa9 | server `worker/src/reports.ts`; iOS `Models/BrokenStationReports.swift`, `Views/BrokenReportResolvedToast.swift`, `Views/NowPlayingView.swift` (report sheet) |
| watch-protocol | approved | d241aa9 | `Shared/WatchRemoteProtocol.swift`, `WatchRemote/*`, `rrradioWatch/*` |
| localization | review | d241aa9 | `Views/LocaleController.swift`, `Resources/Localizable.xcstrings` |

## Features (`features/*`) — observable behavior

| Doc | Status | Reconciled @ | iOS source of truth |
|---|---|---|---|
| browse | review | d241aa9 | `Views/FeedPages/BrowsePage.swift`, `Views/FeedPages/BrowseFiltersSheet.swift`, `BrowseSortRow`, `Views/StationMapView.swift` |
| search | review | d241aa9 | `Search/*`, `Views/FeedPages/BrowsePage.swift` |
| favorites | review | d241aa9 | `Views/FeedPages/FavoritesPage.swift`, `Views/StationKit.swift`, `Library/Library.swift` |
| station-lists | review | d241aa9 | `Library/Library.swift`, `Views/FeedPages/*`, `BrowseSelectionDock` |
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
| platforms | review | d241aa9 | links all 9 contracts; adaptive-layout/landscape note still light (now-playing.md owns the split) |
| playback | review | d241aa9 | links `contracts/playback-state-machine.md` |
| data-sync | review | d241aa9 | links `contracts/sync-merge.md` + `contracts/privacy-data-boundaries.md` |

## Meta

| Doc | Status | Notes |
|---|---|---|
| README | updated | spec map split (features + contracts tiers), maintenance ritual; parity matrix re-verified true-as-of iOS `d241aa9` (2026-06-12) + broken-reports row added |
| STYLE | approved | authoring standard |
| COVERAGE | living | this file |
