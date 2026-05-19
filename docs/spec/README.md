# rrradio Product Specification

This directory is the product-level specification for rrradio across web,
iOS, and Android. It captures the behavior the product should
have, then points to platform docs for implementation details.

The iOS app currently has the richest native feature set. Treat iOS as the
reference for native interaction patterns, but do not copy iOS-only platform
mechanics into web or Android without an explicit platform note.

## Spec Map

- [Platforms](platforms.md) - shared contracts and platform differences.
- [Data and sync](data-sync.md) - local storage, iCloud/CloudKit, and future
  cross-platform sync decisions.
- [Playback](playback.md) - streaming, recovery, background audio, and media
  controls.
- [Browse](features/browse.md) - catalog browsing, search, filters, and maps.
- [Favorites](features/favorites.md) - favorite stations, display modes, and
  recents.
- [Station lists](features/station-lists.md) - named station collections.
- [Custom stations](features/custom-stations.md) - user-entered streams.
- [Now Playing](features/now-playing.md) - destination view, metadata, lyrics,
  schedules, and artwork.
- [Metadata and artwork](features/metadata-artwork.md) - fetcher contracts and
  fallback order.
- [Sleep timer](features/sleep-timer.md) - timed stop behavior.
- [Wake to radio](features/wake-to-radio.md) - alarm-style playback and OS
  limitations.
- [Preferences and diagnostics](features/preferences-diagnostics.md) - theme,
  language, landing page, history, diagnostics, and car mode.

Canonical implementation references remain in:

- [Architecture](../architecture.md)
- [Operations](../operations.md)
- [Testing](../testing.md)
- [iOS README](https://github.com/MarkusSteinbrecher/rrradio-ios/blob/main/README.md)
- [Decision log](../../design/decisions/decisions-log.md)

## Status Legend

| Status | Meaning |
|---|---|
| Reference | Current richest implementation for this behavior. |
| Supported | Implemented and intended to remain part of the product. |
| Partial | Implemented, but with known platform limits or missing parity. |
| Planned | Intended for a future platform, not implemented yet. |
| Platform-specific | Applies only where the OS or surface exists. |
| Not planned | Explicitly out of scope for that platform. |

## Product Principles

- rrradio is a minimal, ad-free internet radio app.
- The station catalog is shared across platforms and generated from the YAML
  data pipeline documented in [Operations](../operations.md).
- Playback reliability is more important than visual novelty.
- Now Playing is a destination view, not a throwaway modal.
- User library data is private by default and stays local unless a platform
  explicitly offers cloud sync or user-initiated file transfer.
- Platform ports should match product behavior first, then adapt to native OS
  conventions.
- Platform-specific features must degrade cleanly when the OS, account, or
  permission is unavailable.

## Platform Parity Matrix

| Area | Web | iOS | Android | Spec |
|---|---|---|---|---|
| Shared catalog | Supported | Supported | Supported | [Platforms](platforms.md), [Browse](features/browse.md) |
| Stream playback | Supported | Reference | Supported | [Playback](playback.md) |
| Background audio | Partial | Reference | Partial | [Playback](playback.md) |
| Lock-screen/media controls | Supported where browser allows | Reference | Partial | [Playback](playback.md) |
| Browse/search/filter | Supported | Reference | Supported | [Browse](features/browse.md) |
| Map browse | Supported | Supported | Planned | [Browse](features/browse.md) |
| Favorites | Supported | Reference | Supported | [Favorites](features/favorites.md) |
| Favorites display modes | Partial | Reference | Partial | [Favorites](features/favorites.md) |
| Recents | Supported | Supported | Supported | [Favorites](features/favorites.md) |
| Station lists | Not planned for current web | Reference | Partial | [Station lists](features/station-lists.md) |
| Custom stations | Supported | Reference | Supported | [Custom stations](features/custom-stations.md) |
| Metadata and cover art | Supported | Reference | Partial | [Metadata and artwork](features/metadata-artwork.md) |
| Program schedules | Supported for wired broadcasters | Supported for wired broadcasters | Planned | [Now Playing](features/now-playing.md) |
| Lyrics | Supported on web | Planned/partial on native | Planned | [Now Playing](features/now-playing.md) |
| Sleep timer | Supported | Reference | Partial | [Sleep timer](features/sleep-timer.md) |
| Wake to radio | Partial, browser-limited | Reference, iOS-limited | Planned, Android-limited | [Wake to radio](features/wake-to-radio.md) |
| iCloud/CloudKit sync | Not planned | Supported | Not applicable | [Data and sync](data-sync.md) |
| Manual file export/import | Supported for favorites and custom stations | Planned/optional | Supported for Android library backup | [Data and sync](data-sync.md) |
| Cross-platform account sync | Not planned | Not planned | Not planned for first Android port | [Data and sync](data-sync.md) |
| Diagnostics | Privacy-preserving telemetry | Local opt-in diagnostics | Local opt-in diagnostics | [Preferences and diagnostics](features/preferences-diagnostics.md) |
| Watch companion | Not applicable | Supported as iPhone remote | Not applicable | [Platforms](platforms.md) |
| Car mode / vehicle surfaces | Browser/OS dependent | Supported in app, CarPlay controls via media session | Partial media controls; Android Auto TBD | [Preferences and diagnostics](features/preferences-diagnostics.md) |

## How To Maintain This Spec

- Update the feature spec when product behavior changes.
- Update the platform matrix when a platform gains, loses, or intentionally
  skips a feature.
- Keep implementation mechanics in platform docs unless they affect product
  behavior.
- Record larger tradeoffs as ADRs in `design/decisions/`.
- Avoid duplicating catalog, privacy, or curation rules that already live in
  [Operations](../operations.md); link to them instead.
