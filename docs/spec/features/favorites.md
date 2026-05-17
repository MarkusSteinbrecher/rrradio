# Favorites Specification

Favorites are the user's primary personal radio dial.

## Shared Behavior

- A station can be added to or removed from favorites from list rows, Now
  Playing, and platform-appropriate secondary surfaces.
- Favorites keep a stable user-defined order.
- Removing a favorite should not delete a custom station from the custom-station
  library unless the user explicitly deletes that station.
- Recents fill automatically after playback starts.
- Media previous/next controls should use favorites when the active source is
  favorites, or when no richer active queue exists.
- The selected Favorites display mode must be restored before the first visible
  Favorites render after app launch. The UI must not briefly show one mode and
  then jump to another.

## Display Modes

The product supports multiple Favorites presentations where a platform has the
surface area:

- List: dense favorite rows for scanning and metadata.
- Tiles: visual station tiles for quick launch.
- App: large app-like favorite launch tiles.

Platforms may hide a mode only through an explicit preference or platform note.
The selected mode and the visible/order settings are user preferences.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Add/remove favorites | Supported. | Supported. | Supported. |
| Reorder favorites | Supported. | Reference native behavior. | Partial; basic controls exist, native drag/reorder remains. |
| Favorites list view | Supported. | Supported. | Supported. |
| Favorites tile/app views | Partial/current web behavior may differ. | Reference. | Supported; visible/order settings still need parity. |
| Recents | Supported, capped. | Supported, capped. | Supported, capped. |
| iCloud sync | Not planned. | Supported for favorites and order. | Not applicable. |
| Manual file export/import | Supported. | Planned/optional. | Supported through Android library backup. |
| Cross-platform sync | Not planned. | Not planned outside CloudKit. | Not planned for first port. |

## Persistence

- Web persists favorites and recents in browser storage; favorites can be
  exported/imported through the manual backup file.
- iOS persists locally and can sync favorites through CloudKit.
- Android persists locally in DataStore; favorites are included in the manual
  Android backup file.
- Recents remain local-only on every platform unless a future sync ADR changes
  that decision.
- Android persists the selected Favorites display mode in DataStore and restores
  it together with the landing page preference before applying a Favorites
  startup tab. Visible/order settings remain part of the remaining native parity
  work.

## Empty And Search States

- No favorites: invite the user to add favorites from Browse.
- No favorite search result: stay in Favorites context, then optionally offer
  catalog matches without making the scope ambiguous.
- No recents: explain that played stations appear after listening.
