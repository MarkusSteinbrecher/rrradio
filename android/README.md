# Android app has moved

The native Android app now lives in its own repository, mirroring the
`rrradio-ios` split:

➡️ **https://github.com/MarkusSteinbrecher/rrradio-android**

The full `android/` history was preserved (via `git subtree split`) when it was
migrated out of this monorepo, so per-commit blame and authorship carry over to
the new repo.

## Why a separate repo

- One source of truth for the Android app (no monorepo/standalone drift).
- Self-contained Gradle build + Android CI live next to the code.
- Matches how the native iOS/watchOS app lives in `rrradio-ios`.

## What stays here

The canonical product spec (`docs/spec/`), catalog YAML and build tooling, the
Worker, and the web app remain in this repo. The Android app consumes:

- the published catalog at `https://rrradio.org/stations.json`, and
- a read-only mirror of `docs/spec/` (refreshed in the Android repo via its
  `scripts/sync-spec.sh`).

Edit the spec here; never edit the mirror in the Android repo.
