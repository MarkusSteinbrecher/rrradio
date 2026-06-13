# Playback Specification

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

Playback is the core product surface. Every platform should prioritize reliable
start, pause, resume, stop, retry, and media-control behavior over decorative
UI differences.

The formal state machine — states, transitions, retry policy, stream-quality
selection, queue stepping, and the media-control / now-playing-info contract — is
[playback-state-machine](contracts/playback-state-machine.md). This doc is the
behavioral summary; the contract is authoritative for exact states and limits.

## Shared Behavior

- A station row starts playback for that station.
- Starting a new station replaces the current audio source in place.
- Pause keeps the current station selected and the session active for fast resume.
- Resume on a paused station unpauses in place; resume on a failed/errored station
  rebuilds the source from scratch (manual retry).
- Stop clears active playback and the active queue unless a platform-specific wake
  flow needs a silent keep-alive source.
- The mini-player appears after playback starts or when an offline state needs
  a product-level surface.
- The current station should stay visible across list, favorite, and Now
  Playing surfaces.
- Station stepping from media controls should use the active playback queue
  where one exists, then fall back to favorites where appropriate.
- A station the broadcaster region-locks (curated availability excludes the
  listener's region) surfaces a friendly region-locked message and is treated as
  a permanent failure — no retry.

## Stream Support

| Format | Web | iOS | Android |
|---|---|---|---|
| MP3 | `HTMLAudioElement` | AVPlayer | Media3/ExoPlayer |
| AAC | `HTMLAudioElement` | AVPlayer | Media3/ExoPlayer |
| HLS | Safari native, `hls.js` elsewhere | AVPlayer native (`.m3u8`) | Media3/ExoPlayer |
| Playlist redirects | Parse or resolve before playback where needed. | Catalog ships the resolved stream URL; the player streams it directly and does not parse `.pls` / `.m3u` at playback time. | Resolves plain `.m3u` / `.pls` before MediaItem playback; HLS `.m3u8` remains native. |

Only HTTPS streams publish by default. Catalog exceptions require the
`httpAllowed` escape hatch documented in [Operations](../operations.md).

## Recovery

All platforms must handle transient stream failure:

- Detect error, stalled, disconnected, and route/interruption states.
- Retry by rebuilding the media source, not only by calling play again.
- Cap automatic retries (≤3 per station session) and back off between attempts;
  never spin a tight retry loop.
- Keep errors privacy-preserving in telemetry or diagnostics.
- Surface offline state at product level when the device loses connectivity, and
  auto-reconnect the current station once connectivity returns — but only when
  playback was active (playing, loading, or errored), never when the user had
  paused or nothing was selected.
- Region-locked stations do not retry; the friendly region message is preserved.

Platform notes:

- Web must treat `HTMLAudioElement` as unreliable after some failures and
  rebuild source state.
- iOS keeps AVPlayer item rebuilding, audio-session interruption handling,
  output-route-loss pause, and media-services-reset recovery as native reference
  behavior; a connectivity monitor drives the network-restore auto-reconnect.
- Android should use Media3 player error callbacks and rebuild the MediaItem or
  player item when required.

## Background And Media Controls

| Surface | Web | iOS | Android |
|---|---|---|---|
| Lock screen | Media Session API where supported. | MPNowPlayingInfoCenter. | Media3 media session notification. |
| Headphones/Bluetooth | Browser/OS dependent. | MPRemoteCommandCenter. | Media session transport controls. |
| Background playback | Browser/OS dependent. | Background audio entitlement. | Foreground media service. |
| Vehicle controls | Browser/OS dependent. | In-app big-button car mode on a car audio route; native CarPlay app (Favorites / Recents / Lists / Browse-by-country + system Now Playing) implemented behind a dev build, pending Apple's CarPlay-audio entitlement. | Media controls; Android Auto is an explicit open decision. |
| Watch companion | Not applicable. | watchOS app remote-controls iPhone playback (mirrors player state, steps stations, plays favorites/lists). | Wear OS out of scope for first Android port. |

Media-control surfaces expose play, pause, toggle, and previous/next (station
step); previous/next is enabled only when the active queue holds more than one
station. Live streams disable seek / skip-by-time controls.

## Queue Rules

- Browse playback uses the current filtered browse result as the queue where a
  platform has queue semantics.
- Favorites playback uses ordered favorites as the queue.
- Station-list playback uses the selected station list as the queue.
- Recents playback uses the visible recents order.
- If a station is launched outside a known list, it is a single-station queue.
- Stations are de-duplicated by id (first occurrence wins, order preserved);
  stepping is circular within the queue.
- Removing the last station from the active queue clears the queue but keeps the
  current station playing; stepping then becomes unavailable.
- Previous/next media controls should not jump to unrelated catalog stations
  when the user is in a curated list or station list.

## Testing Expectations

- Unit tests cover state transitions, queue selection, retry classification,
  and metadata parsing.
- Browser tests cover cold boot and visible controls.
- Native real-device testing is required for background audio, lock-screen
  controls, interruptions, Bluetooth, CarPlay, and wake-to-radio.

## Platform Matrix

Status words per the [README](README.md) status legend.

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Start / pause / resume / stop | Supported. | Reference. | Supported. |
| Source rebuild on new station | Supported. | Reference. | Supported. |
| Automatic retry (≤3, backoff) | Supported. | Reference. | Supported. |
| Geo-restriction = permanent (no retry) | Supported. | Reference. | Supported. |
| Network-restore auto-reconnect | Supported. | Reference. | Supported. |
| Lock-screen / system now-playing | Partial (browser-dependent). | Reference. | Supported. |
| Headphone / Bluetooth transport | Partial (browser-dependent). | Reference. | Supported. |
| Background playback | Partial. | Reference. | Supported. |
| Active playback queue + circular stepping | Supported. | Reference. | Supported. |
| In-app car mode | Not applicable. | Supported. | Not planned. |
| Native vehicle integration | Not applicable. | Partial; CarPlay app implemented, entitlement-gated (issue #51). | Planned (Android Auto is an open decision). |
| Watch companion remote | Not applicable. | Supported. | Not applicable. |
| Wake-to-radio keep-alive | Not applicable. | Supported (iOS-only). | Not planned. |

## Open questions

- Listener-selectable stream quality (`best` / `data` / `low`) — no platform
  ships a tier selector; see [playback-state-machine](contracts/playback-state-machine.md).
- Android Auto support for the first Android port.
- Whether to deactivate the audio session on a long pause vs. keeping it active
  for instant resume — see Known deviations.

## Reference

- iOS player: `rrradio-ios/rrradio/Player/AudioPlayer.swift` — state machine,
  retry scheduler, audio-session + remote-command wiring, now-playing info,
  network-restore reconnect (`reconnectCurrentAfterConnectivityRestored`).
- iOS queue model: `rrradio-ios/Shared/StationPlaybackQueue.swift`.
- iOS connectivity: `rrradio-ios/rrradio/NetworkMonitor.swift`, with the
  network-change handler in `rrradio-ios/rrradio/App.swift`.
- iOS CarPlay: `rrradio-ios/rrradio/CarPlay/CarPlayController.swift`,
  `rrradio-ios/rrradio/CarPlay/CarPlaySceneDelegate.swift` (entitlement-gated via
  the `rrradio-CarPlay` dev scheme, issue #51); in-app car mode in
  `rrradio-ios/rrradio/Player/CarModeController.swift`.
- iOS watch remote: `rrradio-ios/Shared/WatchRemoteProtocol.swift`,
  `rrradio-ios/rrradioWatch/WatchRemoteModel.swift`,
  `rrradio-ios/rrradio/WatchRemote/PhoneRemoteControlController.swift`.
- The exact states, transitions, retry numbers, queue fields, now-playing
  fields, and remote-command mapping are in
  [playback-state-machine](contracts/playback-state-machine.md).

## Known deviations

- Audio-session deactivation on close paths was historically incomplete; largely
  remediated at the reconciled commit (pause still deliberately keeps the session
  active for fast resume). See the Known deviations section of
  [playback-state-machine](contracts/playback-state-machine.md) and
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice5.md` (A2),
  `…-slice24.md` (N6).
