# rrradio — Android

Native Android port of rrradio. This mirrors the SwiftUI iOS client:
the catalog is still published by the web build at
`https://rrradio.org/stations.json`, device-local library state stays on
the phone, and playback is native rather than a WebView wrapper.

## Status

Implemented in this scaffold:

- Kotlin + Jetpack Compose app shell.
- Catalog decoding and cache-backed network loading.
- Search parity for station name, tags, country, and whitespace-insensitive
  matches such as `WDR5` -> `WDR 5`.
- Favorites, recents, and custom HTTPS streams via DataStore.
- Media3 `MediaSessionService` + ExoPlayer for MP3/AAC/HLS playback.
- Background/lock-screen playback plumbing through Android media session.
- Sleep timer cycle: off / 15 / 30 / 60 / 90 minutes.
- Basic ICY `StreamTitle` parser and bounded ICY metadata fetcher for
  `status: icy-only` stations.

Not yet ported:

- The full broadcaster metadata registry from iOS
  (`orf`, `azuracast`, `laut-fm`, `streamabc`, `swr`, `ffh`, `mdr`,
  `rbb-radioeins`, `cro`, `srgssr-il`, `swiss-radio`, `srr`, `mr`,
  `br-radioplayer`, `bbc`, `hr`, `antenne`, `rb-bremen`, `sr`).
- Program schedule panes.
- Lyrics lookup.
- Map view.
- Wake-to-radio.
- Backup/restore.
- Android Auto-specific browse tree.

## Building

Open the `android/` directory in Android Studio, let it install the
Gradle/Android toolchain, then run the `app` configuration.

Command-line build once Gradle and the Android SDK are installed:

```sh
cd android
gradle testDebugUnitTest assembleDebug
```

This workspace currently has Java but not Gradle or the Android SDK, so
the Android build cannot be verified locally from this shell yet.
