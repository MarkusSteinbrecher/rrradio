# rrradio — Android

Native Android port of rrradio. This mirrors the SwiftUI iOS client:
the catalog is still published by the web build at
`https://rrradio.org/stations.json`, device-local library state stays on
the phone, and playback is native rather than a WebView wrapper.

## Spec alignment status

The cross-platform contract lives in `docs/spec/`. Android is intentionally
local-only for this first aligned version: there is no CloudKit, no iCloud
compatibility layer, no account requirement, and no shared backend.

| Spec area | Android status | Remaining parity |
|---|---|---|
| `docs/spec/platforms.md` | Partial | Kotlin + Jetpack Compose, Media3/ExoPlayer, MediaSessionService, DataStore, cache-backed catalog loading, native app-shell logo, tab structure, station lists, and Favorites modes are in place. Wear OS remains out of scope for the first Android port. |
| `docs/spec/data-sync.md` | Supported for local library data | Favorites, recents, custom stations, station lists, selected preferences, opt-in history settings, capped diagnostics, and backup schema versioning are device-local DataStore data. Manual backup export/import supports favorites, custom stations, station lists, and preferences. No CloudKit/account sync is implied. |
| `docs/spec/playback.md` | Partial | MP3/AAC/HLS playback uses ExoPlayer, visible-list playback creates an active queue, bounded source rebuild retries exist, and plain `.m3u` / `.pls` playlist URLs resolve before playback. Real background/lock-screen behavior and media-control validation are tracked in #404. |
| `docs/spec/features/browse.md` | Supported except deferred views | Catalog load/cache, normalized search, country/genre filters, name/quality/favorite sorting, long-press station preview, favorite/play from rows, recents, and Browse batch-add into station lists are in place. Map browse and presentation refinements are tracked in #400. |
| `docs/spec/features/favorites.md` | Partial | Add/remove favorites, capped recents, List/Tiles/App display modes with persisted mode preference, local persistence, and basic up/down reorder controls are in place. Native drag/reorder, visible/order settings, and metadata polish are tracked in #398. |
| `docs/spec/features/station-lists.md` | Partial | Lists overview, create/rename/delete, Browse batch-add, station removal, up/down list reorder, up/down station reorder, local persistence, and list-scoped playback queues are in place. Native drag/reorder polish is tracked in #401. |
| `docs/spec/features/custom-stations.md` | Supported | HTTPS-only save, private/local host rejection, duplicate stream checks, stream probe before save, auto-favorite, delete confirmation, local persistence, and backup export/import are in place. |
| `docs/spec/features/now-playing.md` | Partial | The Android destination shows station identity, artwork/logo fallback, basic metadata, favorite toggle, play/pause plus active-queue previous/next, sleep entry, and mini-player handoff. Secondary panels, lyrics, schedules, and music-service links are tracked in #403. |
| `docs/spec/features/metadata-artwork.md` | Partial | Basic ICY `StreamTitle` parsing, Grrif and ORF/FM4 native fetchers, ORF current-program metadata, broadcaster cover URLs, and iTunes cover/track verification fallback are in place. Remaining broadcaster fetchers, full schedule grids, station-logo policy polish, and lyrics are tracked in #407. |
| `docs/spec/features/sleep-timer.md` | Partial | The off / 15 / 30 / 60 / 90 minute cycle pauses playback without clearing station context. Visible remaining time and background firing validation belong with #403 and #404. |
| `docs/spec/features/wake-to-radio.md` | Deferred decision | Exact-alarm permission, foreground service behavior, notification fallback, and battery optimization language need a design decision before implementation in #405. |
| `docs/spec/features/preferences-diagnostics.md` | Partial | Native Preferences sheet, persisted system/light/dark theme, preset accent palette, landing page, sleep default, Favorites display-mode controls, opt-in station history, opt-in capped diagnostics export, manual backup import/export, and broken-station reporting exist. Custom accent entry, language, track-history metadata expansion, and Android Auto scope remain tracked in #399 and #405. |

## Parity Tracking

The Android parity plan is tracked by #397. The current implementation sequence
is:

1. #402 - audit/spec matrix update.
2. #399 - app shell, theme, logo, and preferences.
3. #400 - Browse parity.
4. #398 - Favorites parity.
5. #401 - station lists parity.
6. #403 - Now Playing destination parity.
7. #407 - metadata and artwork parity.
8. #404 - playback, background audio, and media controls validation.
9. #406 - local data, backup export, and diagnostics.
10. #405 - wake-to-radio and Android Auto decisions.

Deferred features should remain documented here until each area is implemented
or explicitly deferred in an issue or ADR. Android Auto, wake-to-radio exact
alarms, and any future cross-platform sync backend are separate product
decisions, not hidden scope in this port.

## Local Data And Backup

Android remains device-local. The backup file is a user-selected JSON document,
not a cloud sync protocol. The current `schemaVersion: 1` backup contains
favorites, custom stations, station lists, and selected preferences. Import
merges library objects by id and applies included preferences.

Backups do not include recents, listening-history records, diagnostic logs,
playback errors, active wake state, or account/cloud identifiers. Listening
history and diagnostics are off by default; when enabled, both stay local, and
diagnostics can be exported separately from Preferences.

## Building

Open the `android/` directory in Android Studio, let it install the
Gradle/Android toolchain, then run the `app` configuration.

Command-line build once Gradle and the Android SDK are installed:

```sh
cd android
gradle testDebugUnitTest assembleDebug
```

If Gradle is installed through Homebrew without a global Java runtime, this
shell can use Homebrew's embedded OpenJDK through the `gradle` launcher. A
valid Android SDK is still required through `ANDROID_HOME` or
`android/local.properties`.
