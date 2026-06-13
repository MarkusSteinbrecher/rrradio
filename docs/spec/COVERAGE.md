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
| catalog-schema | draft | 9336321 | `Shared/Station.swift`, `Models/Catalog.swift`, `Models/StreamQuality.swift` |
| playback-state-machine | draft | 9336321 | `Player/AudioPlayer.swift`, `Shared/StationPlaybackQueue.swift` |
| metadata-fetchers | draft | 9336321 | `Player/Metadata/*` |
| search | draft | 9336321 | `Search/*`, `Models/RadioBrowserClient.swift`, `Resources/stations.fts5.db` |
| sync-merge | draft | 9336321 | `CloudSync/*` |
| privacy-data-boundaries | draft | 9336321 | `RegionResolver.swift`, `DashboardView.swift`, `AddStationView.swift`, `Diagnostics.swift` |
| broken-reports | draft | — | server-side first (`worker/src/reports.ts`); iOS report sheet pending (companion issue to #507) |
| watch-protocol | draft | 800bb74 | `Shared/WatchRemoteProtocol.swift`, `WatchRemote/*`, `rrradioWatch/*` |
| localization | draft | 9336321 | `Views/LocaleController.swift`, `Resources/Localizable.xcstrings` |

## Features (`features/*`) — observable behavior

| Doc | Status | Reconciled @ | iOS source of truth |
|---|---|---|---|
| browse | draft | 9336321 | `Views/FeedPages/BrowsePage.swift`, `BrowseFiltersSheet`, `BrowseSortRow`, `StationMapView.swift` |
| search | draft | 9336321 | `Search/*`, `Views/FeedPages/BrowsePage.swift` |
| favorites | draft | 9336321 | `Views/FeedPages/FavoritesPage.swift`, `Views/StationKit.swift`, `Library/Library.swift` |
| station-lists | draft | 9336321 | `Library/Library.swift`, `Views/FeedPages/*`, `BrowseSelectionDock` |
| custom-stations | draft | 9336321 | `Views/AddStationView.swift`, `Library/StreamProbe.swift`, `Library/CustomStationBuilder.swift` |
| now-playing | draft | 9336321 | `Views/NowPlayingView.swift`, `MiniPlayerView`, `Player/Metadata/MusicServiceLinks.swift` |
| metadata-artwork | draft | 9336321 | `Player/Metadata/*` |
| sleep-timer | draft | 9336321 | `Player/SleepTimer.swift` |
| wake-to-radio | draft | 9336321 | `Player/WakeAlarm.swift` |
| listening-history | draft | 9336321 | `Library/ListeningHistory.swift`, `Views/DashboardView.swift`, `Views/ListeningRaceChart.swift` |
| watch-remote | draft | 800bb74 | `rrradioWatch/*`, `WatchRemote/PhoneRemoteControlController.swift` |
| siri-shortcuts | draft | 9336321 | `Shortcuts/*` |
| first-run-offline | draft | 9336321 | `App.swift`, `Models/Catalog.swift`, `Views/CatalogLoadingSplash.swift` |
| preferences-diagnostics | draft | 9336321 | `Views/SettingsView.swift`, `ThemeController.swift`, `Player/CarModeController.swift`, `Diagnostics.swift` |

## Cross-cutting (`*.md`)

| Doc | Status | Reconciled @ | Notes |
|---|---|---|---|
| platforms | draft | 9336321 | links all 8 contracts; adaptive-layout/landscape note still light (now-playing.md owns the split) |
| playback | draft | 9336321 | links `contracts/playback-state-machine.md` |
| data-sync | draft | 9336321 | links `contracts/sync-merge.md` + `contracts/privacy-data-boundaries.md` |

## Meta

| Doc | Status | Notes |
|---|---|---|
| README | updated | spec map split (features + contracts tiers), parity rows for the 5 new features, maintenance ritual; parity matrix should be re-verified true-as-of a named commit in Phase 3 |
| STYLE | approved | authoring standard |
| COVERAGE | living | this file |
