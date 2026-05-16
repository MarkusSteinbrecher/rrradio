# Station Lists Specification

Station lists are named collections that sit beside Favorites. They are useful
for temporary sets, moods, regions, or stations that should not become the main
favorite dial.

## Shared Product Behavior

- Users can create a named list.
- Users can rename and delete a list.
- Users can add stations to a list.
- Users can remove stations from a list.
- Users can reorder lists.
- Users can reorder stations inside a list.
- Opening a list shows only stations in that list.
- Playing a station from a list establishes the list as the active playback
  queue for previous/next.
- Empty list states should tell the user to add stations from Browse.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Station-list overview | Not planned for current web. | Reference. | Supported. |
| Create/delete list | Not planned for current web. | Supported. | Supported. |
| Rename list | Not planned for current web. | Supported. | Planned. |
| Add stations from Browse | Not planned for current web. | Supported. | Supported. |
| Remove stations from a list | Not planned for current web. | Supported. | Supported. |
| Reorder lists | Not planned for current web. | Supported. | Planned. |
| Reorder stations inside a list | Not planned for current web. | Supported. | Planned. |
| Play list as queue | Not planned for current web. | Supported. | Supported. |
| Cloud sync | Not applicable. | Supported through CloudKit. | Not applicable. |
| Local persistence | Not planned for current web. | Supported. | Supported. |

## Android Current Status

Android now has the core station-list model in scope: list overview, create,
delete, Browse batch-add, station removal, local persistence, and queue-scoped
playback are implemented. Remaining parity work is rename, reorder lists,
reorder stations inside a list, and Android-native list management polish.
