# iOS UAT scripts — rrradio

> Manual user-acceptance tests for the rrradio iOS native app (SwiftUI + AVFoundation). One script per critical user flow. See [`../README.md`](../README.md) for cycle workflow.

## Test environments

Each flow declares its required environment in **Preconditions**. The major axis:

- **Simulator** — fine for layout, navigation, search, library persistence (within a session). **Not adequate for:** lock-screen controls, AirPods, real audio interruptions, real network drops, iCloud sync between devices.
- **Real device** — required for everything in the "Not adequate for" list above. iPhone running iOS 17+.
- **TestFlight** — same as real device but the build is signed for distribution (catches App Store sandboxing differences).

When in doubt, prefer real-device. Lock-screen audio is the most common spot for divergence between simulator and shipping behaviour.

## Setup expectations

- Xcode 15.4+ (iOS 17 SDK).
- TestFlight build installed, **or** local build via `xcodegen && xcodebuild` (see [`../../../ios/README.md`](../../../ios/README.md) §Building).
- Wi-Fi available; cellular if testing network-recovery flows.
- For iCloud sync: two iOS devices signed into the **same Apple ID**, both with iCloud Drive on, both running the same build of rrradio.

## Flow index

Sorted roughly by how essential to a release ("happy path → edge case"):

1. [`first-run.md`](first-run.md) — fresh install, catalog fetch, empty library.
2. [`browse-and-play.md`](browse-and-play.md) — find a station, start playback, mini-player + now-playing.
3. [`search-and-filter.md`](search-and-filter.md) — search ("WDR5" → "WDR 5" normalization), country, tag.
4. [`favorites-and-recents.md`](favorites-and-recents.md) — favorite, reorder, recents dedupe.
5. [`custom-station.md`](custom-station.md) — add HTTPS stream, validation errors, persistence.
6. [`background-and-lock-screen.md`](background-and-lock-screen.md) — lock screen card, AirPods controls, Control Center.
7. [`audio-interruption.md`](audio-interruption.md) — phone call, alarm, other-app audio, recovery.
8. [`network-recovery.md`](network-recovery.md) — Wi-Fi drop, airplane mode, return.
9. [`sleep-timer.md`](sleep-timer.md) — set / fire / cancel across all durations.
10. [`icloud-sync.md`](icloud-sync.md) — two-device sync of favorites + custom stations.

## Notes for the tester

- **Audio in the simulator** routes through your Mac's audio output; ICY metadata still works, but the Bluetooth / AirPlay paths do not. Real device for those.
- **Lock-screen card** doesn't appear on the simulator's "fake lock". Use a real device.
- **iCloud sync** can take 30–120 seconds in either direction. If a change doesn't appear, wait a minute before declaring failure.
- **Per-broadcaster metadata fetchers** (ORF, BBC, AzuraCast, Laut.FM, etc.) are tested implicitly via [`browse-and-play.md`](browse-and-play.md) by selecting a station that uses each. The script lists representative stations — pick one of each broadcaster family in a thorough cycle.
