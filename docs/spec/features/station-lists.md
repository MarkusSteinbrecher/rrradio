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
| Station-list overview | Not planned for current web. | Reference. | Planned. |
| Create/rename/delete list | Not planned for current web. | Supported. | Planned. |
| Add stations from Browse | Not planned for current web. | Supported. | Planned. |
| Play list as queue | Not planned for current web. | Supported. | Planned. |
| Cloud sync | Not applicable. | Supported through CloudKit. | Not applicable. |
| Local persistence | Not planned for current web. | Supported. | Planned. |

## Android First-Port Scope

Android can ship without station lists if the first port is focused on playback,
Browse, Favorites, Recents, and custom stations. Once station lists are in
scope, Android should follow the iOS product behavior but use Android-native
list management and drag/reorder affordances.
