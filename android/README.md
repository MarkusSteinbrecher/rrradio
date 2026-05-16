# rrradio — Android

Native Android port of rrradio. This mirrors the SwiftUI iOS client:
the catalog is still published by the web build at
`https://rrradio.org/stations.json`, device-local library state stays on
the phone, and playback is native rather than a WebView wrapper.

## Spec alignment status

The cross-platform contract lives in `docs/spec/`. Android is intentionally
local-only for this first aligned version: there is no CloudKit, no iCloud
compatibility layer, no account requirement, and no shared backend.

| Spec area | Android status | Notes |
|---|---|---|
| `docs/spec/platforms.md` | Partial | Kotlin + Jetpack Compose, Media3/ExoPlayer, MediaSessionService, DataStore, and cache-backed catalog loading are in place. Wear OS is out of scope for the first Android port. |
| `docs/spec/data-sync.md` | Supported for local data | Favorites, recents, custom stations, and station lists are device-local DataStore data. Manual backup export/import is explicitly deferred; it should mirror the web favorites/custom-stations file flow when added. |
| `docs/spec/playback.md` | Partial | MP3/AAC/HLS playback uses ExoPlayer. Starting playback passes the current visible list as the active queue, so Browse, Favorites, Recents, and station-list detail media next/previous controls stay scoped. Media3 errors trigger bounded source rebuild retries before surfacing a generic error. Real background/lock-screen behavior still needs device validation. |
| `docs/spec/features/browse.md` | Supported except deferred views | Android loads `https://rrradio.org/stations.json`, falls back to the cache, searches station names/tags/countries with whitespace-insensitive and diacritic-tolerant matching, exposes country/genre filters, and supports Browse batch-add into station lists. Map browse and advanced sort controls are deferred. |
| `docs/spec/features/favorites.md` | Partial | Add/remove favorites and capped recents are supported. Favorites now follow the iOS display-mode model with List, Tiles, and App-style views, and list mode has basic up/down reorder controls. Drag reorder is deferred. |
| `docs/spec/features/station-lists.md` | Partial | Android now uses the iOS tab structure with a Lists surface, list-summary rows for Favorites/Recents/Custom Stations, named user-created lists, Browse batch-add, list delete, and station removal from a list. Rename, drag reorder, and fuller list-as-queue management still need the iOS behavior ported. |
| `docs/spec/features/custom-stations.md` | Partial | Custom stations require HTTPS, reject local/private stream hosts, reject duplicate stream URLs against catalog/custom stations, probe the stream before save, auto-favorite on save, confirm before delete, and persist locally. Backup/export remains deferred. |
| `docs/spec/features/now-playing.md` | Partial | The current sheet shows station identity, artwork/logo fallback, metadata, favorite toggle, playback control, and sleep entry. A fuller destination view, previous/next buttons, secondary panels, lyrics, schedules, and music-service links are deferred. |
| `docs/spec/features/metadata-artwork.md` | Partial | Basic ICY `StreamTitle` parsing and bounded ICY metadata fetch are present for `status: icy-only` stations. The broadcaster metadata registry from web/iOS, schedule panes, lyrics, station-logo policy, and track cover-art lookup are deferred. |
| `docs/spec/features/sleep-timer.md` | Partial | The off / 15 / 30 / 60 / 90 minute cycle pauses playback without clearing station context. Background firing still needs real-device validation with the media notification active. |
| `docs/spec/features/wake-to-radio.md` | Deferred decision | Android wake-to-radio needs a separate decision covering exact alarm permission, foreground service behavior, notification fallback, and battery optimization language. |
| `docs/spec/features/preferences-diagnostics.md` | Partial | Theme toggle exists. System/light/dark preference, accent color, language, landing page, listening history, local diagnostics, broken-station reporting, and Android Auto-specific behavior are deferred. |

Deferred features should remain documented here until each area gets its own
issue or ADR. Android Auto, wake-to-radio exact alarms, and any future
cross-platform sync backend are separate product decisions, not hidden scope in
this port.

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
