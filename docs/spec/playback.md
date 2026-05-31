# Playback Specification

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
- Pause keeps the current station selected.
- Resume restarts the current station.
- Stop clears active playback unless a platform-specific wake flow needs a
  silent keep-alive source.
- The mini-player appears after playback starts or when an offline state needs
  a product-level surface.
- The current station should stay visible across list, favorite, and Now
  Playing surfaces.
- Station stepping from media controls should use the active playback queue
  where one exists, then fall back to favorites where appropriate.

## Stream Support

| Format | Web | iOS | Android |
|---|---|---|---|
| MP3 | `HTMLAudioElement` | AVPlayer | Media3/ExoPlayer |
| AAC | `HTMLAudioElement` | AVPlayer | Media3/ExoPlayer |
| HLS | Safari native, `hls.js` elsewhere | AVPlayer | Media3/ExoPlayer |
| Playlist redirects | Parse or resolve before playback where needed. | Resolve through player/fetcher support where needed. | Resolves plain `.m3u` / `.pls` before MediaItem playback; HLS `.m3u8` remains native. |

Only HTTPS streams publish by default. Catalog exceptions require the
`httpAllowed` escape hatch documented in [Operations](../operations.md).

## Recovery

All platforms must handle transient stream failure:

- Detect error, stalled, disconnected, and route/interruption states.
- Retry by rebuilding the media source, not only by calling play again.
- Keep errors privacy-preserving in telemetry or diagnostics.
- Avoid tight retry loops.
- Surface offline state at product level when the device loses connectivity.

Platform notes:

- Web must treat `HTMLAudioElement` as unreliable after some failures and
  rebuild source state.
- iOS should keep AVPlayer item rebuilding and audio-session interruption
  handling as native reference behavior.
- Android should use Media3 player error callbacks and rebuild the MediaItem or
  player item when required.

## Background And Media Controls

| Surface | Web | iOS | Android |
|---|---|---|---|
| Lock screen | Media Session API where supported. | MPNowPlayingInfoCenter. | Media3 media session notification. |
| Headphones/Bluetooth | Browser/OS dependent. | MPRemoteCommandCenter. | Media session transport controls. |
| Background playback | Browser/OS dependent. | Background audio entitlement. | Foreground media service. |
| Vehicle controls | Browser/OS dependent. | Media controls, CarPlay behavior through system surfaces. | Media controls; Android Auto is an explicit open decision. |
| Watch companion | Not applicable. | watchOS remote controls iPhone playback. | Wear OS out of scope for first Android port. |

## Queue Rules

- Browse playback uses the current filtered browse result as the queue where a
  platform has queue semantics.
- Favorites playback uses ordered favorites as the queue.
- Station-list playback uses the selected station list as the queue.
- Recents playback uses the visible recents order.
- If a station is launched outside a known list, it is a single-station queue.
- Previous/next media controls should not jump to unrelated catalog stations
  when the user is in a curated list or station list.

## Testing Expectations

- Unit tests cover state transitions, queue selection, retry classification,
  and metadata parsing.
- Browser tests cover cold boot and visible controls.
- Native real-device testing is required for background audio, lock-screen
  controls, interruptions, Bluetooth, and wake-to-radio.
