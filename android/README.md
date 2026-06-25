# rrradio — Android (moved)

The native Android app now lives in its own repository:

**https://github.com/MarkusSteinbrecher/rrradio-android**

It was split out of this monorepo (history preserved via `git subtree`) to
mirror the iOS app's standalone repo (`rrradio-ios`) and give the Android port
its own build, CI, issues, and release pipeline.

## Why this directory is now just a pointer

This `android/` tree used to hold a full, buildable copy of the app. Keeping it
here created a second source of truth for the same `applicationId`
(`org.rrradio.android`): an IDE opened on this folder would build the stale
monorepo copy and install it over the real one, silently reverting the app on a
connected device. The source and its CI workflow were removed; only this pointer
remains so old links and bookmarks still land somewhere useful.

## Where things live now

- **Android app code, build, CI, issues, releases:**
  https://github.com/MarkusSteinbrecher/rrradio-android
- **iOS app:** https://github.com/MarkusSteinbrecher/rrradio-ios
- **Cross-platform behavior spec (the shared contract):** [`docs/spec/`](../docs/spec/)
  in this repo. It is mirrored read-only into the Android repo at `docs/spec/`.
- **Android ↔ spec parity status:** tracked in the Android repo's `README.md`
  and in `rrradio` issue #397.

Catalog delivery is unchanged: both native apps fetch
`https://rrradio.org/stations.json`, published by this repo's web build.
