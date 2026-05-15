# Custom Stations Specification

Custom stations let users add private streams that are not in the published
catalog.

## Shared Behavior

- The user can paste a stream URL.
- HTTPS is required unless a future platform-specific exception is explicitly
  approved.
- The app validates that the stream is reachable and audio-like before saving
  where platform APIs allow it.
- Duplicate detection should avoid creating a custom copy when the stream
  matches an existing catalog station.
- Saving a valid custom station should make it visible in the user's library.
- Deleting a custom station requires clear destructive confirmation on native
  platforms.
- Custom station stream URLs are private user-entered data.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Add custom stream | Supported. | Reference. | Supported. |
| Probe before save | Partial. | Reference. | Supported. |
| Duplicate detection | Supported where implemented. | Reference. | Supported. |
| Auto-favorite on save | Product-preferred behavior. | Supported. | Supported. |
| Local persistence | `localStorage`. | UserDefaults. | DataStore. |
| Manual file export/import | Supported. | Planned/optional. | Planned/optional. |
| Cloud/account sync | Not planned. | Optional CloudKit sync. | Not planned for first port. |

## Android First-Port Requirement

Android includes custom stations. The first aligned implementation probes
streams before save, rejects duplicate stream URLs, auto-favorites saved
custom stations, confirms deletion, and rejects private/local network targets
unless a separate local-network feature is approved.
