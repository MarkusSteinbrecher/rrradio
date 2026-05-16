# Now Playing Specification

Now Playing is a destination view for the current station, not a transient
modal. It should carry playback controls, current metadata, station identity,
and secondary listening actions.

## Shared Behavior

- Now Playing opens from the mini-player, station rows, and platform-specific
  launch surfaces.
- The current station logo or fallback artwork is prominent.
- The current artist/title appears when metadata is available.
- The station name remains visible even when track metadata is present.
- Playback controls include play/pause and platform-appropriate previous/next.
- Favorite state can be toggled from Now Playing.
- Sleep timer and wake-to-radio controls are reachable from Now Playing where
  implemented.
- Details, lyrics, and program schedule panels appear only when useful data is
  available.
- Opening external music services must never send track data to telemetry.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Destination view | Supported. | Reference. | Partial; current Android surface is still a thin sheet. |
| Mini-player handoff | Supported. | Supported. | Supported. |
| Track metadata | Supported. | Reference. | Partial; basic ICY metadata exists. |
| Cover art fallback | Supported. | Reference. | Partial; station artwork fallback exists, track cover art is deferred. |
| Program schedule | Supported for wired broadcasters. | Supported for wired broadcasters. | Planned. |
| Lyrics | Supported where lookup matches. | Planned/partial native parity. | Planned. |
| Music-service search links | Supported. | Planned/partial native parity. | Planned. |
| Car mode | Not a dedicated web feature. | Supported. | Android Auto/TBD; media notification first. |

## Native Port Notes

Android should avoid starting with a thin playback screen. The first native
version should include enough Now Playing behavior to feel like the same app:
station identity, artwork, track metadata, favorite toggle, sleep timer entry,
and media controls.
