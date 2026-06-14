# Station Lists Specification
```yaml
status: review
platforms: [web, ios, android]
reconciled-against: 8fc085b
```

## Purpose

Station lists are named collections of stations that sit beside Favorites and
Recents in the library. They let a user gather stations for a mood, region, show,
or trip without crowding the main favorite dial. A list is local-first, reorderable,
and doubles as a playback queue: playing a station from a list steps previous/next
through that list.

## Entry points

- **Library Home** — every list appears as its own card in the library navigator,
  above the pinned Recents card. (Favorites is a separate bottom-nav tab, not a
  Home card.)
- **Library page swiper** — each list is a swipeable page in the library
  page sequence (Home · lists · Recents); a tuner-style status bar shows the
  current list's title with its neighbours hinted to either side. Favorites is
  reached only via its own tab and sits out of this sequence.
- **Create from Browse** — the "+" affordance on the Browse sort row opens the
  add-or-create-list popup; choosing "Create list" + a name enters Browse
  multi-select to compose the list. The list is created only on save, with the
  picked stations.
- **Create from library chrome** — the "+" accessory in the Home status bar opens
  the same add-or-create-list popup (the create-list row plus the existing lists).
  Choosing "Create list" + a name routes into Browse multi-select; the list is
  created only on save. There is no empty-list creation path.
- **Add to existing list** — the "+" accessory while viewing a list, or picking an
  existing list in the add-or-create popup, enters Browse multi-select targeting
  that list.
- **Open a list** — tap a list card on Library Home, or swipe to its page.
- **Pinned launch** — a list may be pinned as the launch landing surface (see
  [preferences-diagnostics](preferences-diagnostics.md)); the app opens directly
  into it.

## Layout

### Library Home — list card
- One card per list, in user order, above a single pinned Recents card. (No
  Favorites card — Favorites is its own tab.)
- Shows the list name, a strip of station favicons (empty hint when the list has
  no stations), a play control (disabled/dimmed when the list is empty), and a
  now-playing indicator when this list is the active, on-air playback queue.
- Tapping a station favicon opens the list and plays that station queued against
  the list.
- In edit (delete) mode the card swaps its play control for two trailing badges:
  a rename (pencil) badge and a remove (minus) badge. Tapping rename opens a
  rename alert; tapping remove deletes the whole list (with a confirmation for
  non-empty lists — see Interactions). The Recents card is dimmed and locked
  (not reorderable, renamable, or removable) while edit mode is active.

### List detail page (top to bottom)
- **Library chrome** (shared, fixed above the page): brand/logo row with a
  collapsible search field, a display-mode pill (list / tiles / app), and a
  settings gear; a status bar with a back-to-home arrow, the list title
  (uppercased, monospaced, tuner scale of neighbour titles to either side), a
  leading search icon, a trailing "+" add-stations icon, and a trash
  delete-mode toggle (shown only when the list is non-empty); a divider rule.
  The list-detail page has no rename affordance — rename lives on the Home card
  in edit mode.
- **Station rows/cells**: one row per station in the list, in list order. List
  detail uses the quiet card row — station name + country flag only, no tag line,
  no signal bars, no favorite heart, no stream-quality control. List, tiles, and
  app-icon display modes are available (display-mode pill in the brand row).
- **Empty state** when the list has no stations: a centered unavailable view with
  a slashed-antenna icon, the title "Empty station list", and the hint "Add
  stations from Browse to build this list."
- **No-matches state** when a search query excludes every station: a magnifying
  glass icon, "No stations found", and "Try a station name, country code, or tag."

### Browse multi-select dock (while composing a list)
- An accent-tinted bar pinned at the **top** of Browse, directly under the search
  field (not in the bottom chrome). Carries a two-step progress strip (step 1
  "Add list" done, step 2 "Pick stations" active) above an action row: a cancel
  control (x), an "Adding to {name}" label with a live selection-count badge, and
  a primary that reads "Add N" once stations are picked or a disabled "Select
  stations" prompt while the selection is empty.
- Save is disabled until at least one station is selected and the name is non-empty
  (Favorites-target mode seeds the name with the Favorites title so its save gates
  only on the selection).

### Add-or-create-list popup (from the Browse "+" or the Home "+")
- A card opened by a two-step progress strip (step 1 "Add list" active, step 2
  "Pick stations" upcoming). A "Create list" row morphs into a focused name field
  when selected; when its drafted name collides case-insensitively with an
  existing list an inline "Name already in use" warning appears and confirm is
  blocked. Below it, one row per existing list (accent checkmark on the selected
  target). Footer: a cancel (x) control and a labeled "Pick stations →" advance.
- The advance is disabled until a target is valid (non-empty, non-duplicate new
  name, or a picked existing list). Confirming does not finish — it advances to
  step 2 (Browse multi-select); a new list is created only on save in step 2.

## States

| State | What shows | Actionable |
|---|---|---|
| **Empty (no lists)** | No list cards on Library Home; only the pinned Recents card. Trash/delete-mode is unavailable. | Create a list from the Browse "+" or the Home "+". |
| **Empty (list has no stations)** | Unavailable view: "Empty station list" + "Add stations from Browse to build this list." | "+" add-stations, search, delete-mode auto-unavailable (nothing to remove). |
| **Loading** | Lists render immediately from local storage on launch; no spinner. Station blobs render before the catalog refreshes from network. | Full interaction; rows reconcile in place when the catalog arrives. |
| **Loaded** | List cards on Home; list detail shows its stations in order. | Play, reorder, remove (undoable), add, delete (confirmed), rename (Home card edit mode), search. |
| **Partial (search active, some matches)** | Filtered subset of the list's stations. | Play / open the visible matches. |
| **No matches (search active)** | "No stations found" view. | Clear the search to restore the full list. |
| **Offline** | Lists and their station blobs render from local storage; play attempts stream as usual. | Full library interaction; playback subject to network. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap "+" on Browse sort row | On Browse | Opens the add-or-create-list popup | — |
| Tap "+" in Home status bar | On Library Home | Opens the same add-or-create-list popup as a centered floating card with a backdrop | — |
| Select "Create list" + type name + advance | Popup open | Routes into Browse multi-select with that name seeded in the dock; the list is not created yet | Clears Browse search/filter/sort; switches to Browse tab |
| Pick an existing list + advance | Popup open | Routes into Browse multi-select targeting that list (name = list name) | Switches to Browse tab |
| Type a name colliding with an existing list | Create-list row active | Shows "Name already in use"; advance disabled | — |
| Tap a Browse row in multi-select | Multi-select active | Toggles the station into the selection (tap order preserved) | Selection-count badge updates |
| Tap "Add N" in dock | ≥1 selected and name non-empty | Saves: appends to the explicit target list, or folds into an existing list whose name matches case-insensitively, or creates a new list with the selected stations | Exits multi-select; opens the destination list; switches to Library tab |
| Tap cancel (x) in dock | Multi-select active | Discards the selection and name; no list is created | Exits multi-select |
| Tap "+" in chrome while viewing a list | On a list detail page | Enters Browse multi-select targeting this list | Switches to Browse tab |
| Tap a list card on Home | Not in edit mode | Opens the list detail page | — |
| Tap a list card on Home | In edit mode | Exits edit mode (does not navigate) | — |
| Swipe horizontally on a list page | No drag in flight | Moves to the neighbouring library page | Resting edit (jiggle) state exits on the page change |
| Tap a station row/cell | Not in delete/reorder | Plays the station; list becomes the active playback queue | Pushes to recents if it is a catalog (non-custom) station |
| Tap play on a list card | List non-empty | Plays the first station, queued against the list | Pushes to recents if catalog station |
| Tap a favicon in a list card | Not in edit mode | Opens the list and plays that station queued against the list | Switches to Library; pushes recents if catalog station |
| Long-press a row/cell or Home card | Feed supports reorder/remove (Home: ≥1 list) | Enters edit mode (per-row remove badges, Home cards also get a rename badge; jiggle on icon grid) and, when reorderable, begins the drag | Drives shared chrome delete state |
| Tap trash icon in status bar | Delete-mode available (list non-empty; Home has ≥1 list) | Toggles edit mode | Swiping to another page exits edit mode |
| Tap a row's remove badge | In edit mode | Removes that station from the list; raises an undo toast | Removing the last station auto-exits edit mode |
| Tap a Home card's rename (pencil) badge | Home edit mode | Opens a rename alert seeded with the list name; confirming renames (empty/whitespace blocked) | — |
| Tap a Home card's remove (minus) badge | Home edit mode | Empty list deletes immediately; a non-empty list raises a destructive confirmation dialog ("Delete '{name}'?") before deleting | Deleting the last list exits edit mode |
| Tap Undo in the removal toast | Toast visible | Restores the whole removal batch to each station's original index | Toast dismisses |
| Tap outside badges / background | In edit mode | Exits edit mode | — |
| Drag a row to a new position | Reorder enabled | Reorders stations within the list; persists new order (no-order-change is a no-op) | Selection haptic on drop; scroll + page-swiper locked mid-drag |
| Drag a list card on Home | ≥2 lists and no active search | Reorders whole lists; persists new order; Recents stays pinned at the tail | Selection haptic on drop; scroll + page-swiper locked mid-drag |
| Skip next / previous (lock screen, in-app) | Playing from a list | Steps to the next/previous station in the list, wrapping circularly | Queue identity tied to the list id |
| Pull to refresh on a list page | List non-empty | One-shot now-playing metadata fetch for the list's stations | Merges results into per-row metadata cache |
| Type in the chrome search field | On a library page | Filters the visible content: list-detail / Recents rows by station match (180 ms debounce); Home cards by list title or member-station name | Filter shared (one query) across library pages |
| App backgrounded mid-edit | Any | List state already persisted on each mutation | iCloud push debounced (see sync) |

## Business rules

- **Membership**: a list holds at most one entry per station id; re-adding the same
  station replaces the stored blob, it does not duplicate the row.
- **Name**: created/renamed names are trimmed of surrounding whitespace; an empty or
  whitespace-only name is refused (create returns nothing, rename returns false). UI
  confirm controls disable on empty trimmed input so the refusal is a safety net.
  Rename to the unchanged name is a no-op (no persistence write).
- **Duplicate names (create)**: the create-list popup blocks a new name that matches
  an existing list case-insensitively (after trim) and shows an inline warning. This
  guard is on the create path only; the save-from-Browse fold still merges a matching
  name into the existing list.
- **Identity**: each list gets a stable UUID id at creation; renames keep the id.
- **Ordering**: lists keep user order; stations keep user order within a list.
  Reorder operations that don't change the order are no-ops (no persistence write).
  Home list-reorder needs ≥2 lists and no active search; Recents is never part of
  the reorderable set (it trails as a pinned card).
- **Save-from-Browse folding**: a Favorites target (the Favorites-page "+") wins
  first — selected stations are added to Favorites and the user returns to the
  Favorites tab. Otherwise an explicit target list wins; otherwise a
  case-insensitive name match against an existing list appends to it; otherwise a
  new list is created. Selected stations are added in tap order.
- **Playback queue**: playing from a list sets the active queue to `source =
  stationList`, `sourceID = list.id`. Skip steps wrap circularly. A single-station
  queue stays on that station. Removing the now-playing station from the queue keeps
  playback if other stations remain; an emptied queue ends.
- **Recents on play**: playing a catalog station from a list pushes it to recents;
  custom (user-created) stations are not pushed.
- **Limits**: no fixed cap on list count or stations per list. Recents (a sibling
  surface) caps at 12; lists do not.
- **Station-removal undo**: removing stations via the edit-mode badge is recoverable
  rather than re-confirmed. Removals coalesce into one batch behind a single
  "Removed … · Undo" toast; Undo restores every station in the batch to its original
  index. The toast auto-dismisses after 5 s (15 s under VoiceOver).
- **List-delete confirmation**: deleting a whole list is the one badge action that is
  confirmed, not undoable — an empty list deletes immediately, a non-empty list
  prompts a destructive dialog first, because it destroys curated membership + order
  and propagates to every device via CloudKit.
- **Cross-store consistency**: deleting a custom station removes it from every list
  (and favorites and recents) automatically.
- **Catalog reconciliation**: persisted station blobs in lists are healed in place to
  the canonical catalog copy when their id matches a refreshed catalog entry; entries
  whose id left the catalog are kept playable as-is.

## Data dependencies

- [sync-merge](../contracts/sync-merge.md) — station-list records, the
  `StationListsIndex` authoritative-membership index, and the station-lists merge
  algebra (authoritative-remote when an index exists; otherwise union by id with
  remote-wins). Lists are part of the synced snapshot; recents are not.
- [catalog-schema](../contracts/catalog-schema.md) — the `Station` shape stored in a
  list blob and the canonical catalog copy used for in-place reconciliation.

## Edge cases

- **List deleted out from under the detail page**: the page title falls back to the
  generic "Station Lists" label and the page shows its empty/missing state; the feed
  resolves the list by id on every read.
- **Decode failure on stored lists**: unreadable bytes are quarantined to a recovery
  key and an empty list set is returned rather than overwriting the original; per
  sync, a single bad list blob never wipes or stalls the rest (keep-local on
  unresolved id).
- **Save with empty selection or empty name**: save is refused (dock "Add N" primary
  disabled); no list is created or mutated. A create-flow brand-new list is created
  only on save, so backing out of step 2 never leaves an empty list behind.
- **Re-adding a selected station already in the target list**: replaces the blob,
  no duplicate row.
- **Removing the last station while in delete mode**: delete mode auto-exits so the
  page isn't stranded in an empty edit state.
- **Deleting the last list**: Home delete mode auto-exits.
- **Reorder during root horizontal swipe**: the page-swiper locks its selection only
  while a card/row drag is actually in flight, so a drag can't double as a page
  change. A swipe in the resting jiggle (edit) state is allowed and exits edit mode
  on the page change.
- **Huge lists**: list detail filters synchronously per keystroke on the main thread;
  this is safe only for small library-sized lists, not catalog-scale feeds.
- **Persistence failure**: a write error is recorded as a sanitized diagnostic
  (store name + error type only); in-memory state still reflects the edit.
- **Backgrounding mid-edit**: each mutation persists locally immediately; the iCloud
  push is debounced and retried with backoff (see sync).

## Accessibility

- Row remove badge: "Remove {name} from list".
- Home card edit badges: "Rename {name}" (pencil), "Remove {name}" (minus).
- Home card itself: "Show stations in {name}" (non-empty) / "{name}, empty list".
- Add-stations / create controls: "Add stations to list", "Create list",
  "Add stations to favorites".
- Status-bar controls: back-to-home "Show Library pages", delete toggle "Enter
  delete mode".
- List status bar announces a page in the swipe sequence as title + position
  ("{title}, page {index} of {total}"); Favorites (out of the sequence) announces
  just its title.
- Removal undo toast posts a VoiceOver announcement on appear and on each added
  removal; its action is labeled "Undo".
- Dock controls labeled cancel / "Add N"; popup advance labeled "Pick stations".
- Search field, clear button, and display-mode pills carry labels.
- Names and titles support Dynamic Type; the uppercased title scales down before
  truncating from the middle. Station names wrap to two lines in icon mode.
- All controls meet a 44pt hit target.

## Localization

Strings this surface owns:

- `stationLists` ("Station Lists") — fallback list title / library label.
- `stationListsHint` ("Create a list to collect stations outside favorites.").
- `createStationList` ("Create list"), `stationListName` ("List name"),
  `renameList` ("Rename list"), `listNameInUse` ("Name already in use").
- `addStationsToList` ("Add stations to list"), `addStationsToFavorites` ("Add
  stations to favorites"), `addStationList` ("Add list") / `pickStations` ("Pick
  stations") — the popup/dock two-step labels.
- `emptyStationList` ("Empty station list"), `emptyStationListHint` ("Add stations
  from Browse to build this list."), `emptyList` ("Empty list") — the Home card hint.
- `noStationsFound` ("No stations found"), `trySearch` ("Try a station name, country
  code, or tag.").
- `deleteListTitle` ("Delete “{name}”?"), `deleteListStationsKept`
  (plural: "The station in it stays available in Browse." / "Its {count} stations
  stay available in Browse.").
- `stationRemovedToast` ("Removed {name}"), `stationsRemovedToast` (plural:
  "{count} station(s) removed"), `undo` ("Undo").
- `removeFromList` — parameterized on `{name}` ("Remove {name} from list").
- `showStationsIn` ("Show stations in {name}"),
  `stationListEmptyA11y` — parameterized on `{name}` ("{name}, empty list").
- `statusBarPageA11y` — parameterized on `{title}`, `{index}`, `{total}`.

Parameter needs: `{name}` (station/list name), `{count}` (removed/kept station
count), `{title}`/`{index}`/`{total}` (page position). Plural categories are
required for `stationsRemovedToast` and `deleteListStationsKept` (count-driven
copy); the dock selection-count badge remains a bare numeral.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Station-list overview | Supported (the Library home lists each list above the pinned Recents entry; list-detail page). | Reference. | Supported. |
| Create/delete list | Supported (in-app inline create row; two-step inline "Delete list?" confirm — no native dialogs). | Supported. | Supported. |
| Rename list | Supported (in-app inline rename in the list-detail header). | Supported (Home card edit-mode pencil → rename alert). | Supported (pencil on the list row and on the list-detail page → rename dialog; no edit-mode gate). |
| Create from Browse multi-select | Not planned for current web (web creates a list from the per-row add-to-list sheet, not a Browse multi-select dock). | Supported (popup name entry + selection dock). | Supported (Browse "Add stations to list" enters select mode → bottom save bar → choose/create-list sheet; no two-step progress strip, top-pinned dock, or duplicate-name guard). |
| Add stations to a list | Supported via the per-row list affordance on any station row → add-to-list sheet (toggle membership; create-and-add a new list inline). No top-pinned multi-select dock. | Supported. | Supported. |
| Remove stations from a list | Partial; remove by toggling the station off in the add-to-list sheet — no in-list-detail per-row remove or undo toast. | Supported (with undo toast). | Partial (immediate per-row remove; no undo toast yet). |
| Reorder lists | Not planned for current web. | Supported (interactive drag on Home; Recents pinned). | Supported with up/down controls. |
| Reorder stations inside a list | Not planned for current web. | Supported (interactive drag). | Supported with up/down controls. |
| Play list as queue | Not planned for current web (media-session prev/next steps the favorites list, not the open list). | Supported (circular skip). | Supported (circular skip-next/previous; queue scoped to the open list, surfaced via the foreground MediaSessionService / media3 player). |
| Empty-list guidance | Supported ("Add stations with the list icon on any station row."). | Supported ("Add stations from Browse…"). | Supported. |
| Cloud sync | Not applicable. | Supported through CloudKit. | Not applicable. |
| Local persistence | Supported (browser `localStorage`; the manual JSON backup carries lists — see [data-sync](../data-sync.md)). | Supported. | Supported (Jetpack DataStore; SAF JSON export/import covers lists for manual backup). |

## Android Current Status

Android implements the core station-list model: list overview, create, rename,
delete, Browse batch-add, station removal, list reorder, station reorder, local
persistence (Jetpack DataStore), and queue-scoped circular playback surfaced
through the foreground MediaSessionService. Native mechanics differ from the iOS
reference in several places, all tracked toward parity:

- **Reorder** uses explicit up/down arrow controls on each row, not the iOS
  long-press interactive drag. Planned: Android-native drag/reorder ergonomics if
  the controls feel too heavy.
- **Remove from list** is an immediate per-row remove with no undo toast. Planned:
  the undoable removal batch + "Removed … · Undo" toast.
- **Create-from-Browse** routes through a Browse "Add stations to list" select
  mode, a bottom save bar, and a choose-or-create-list sheet — without the iOS
  two-step progress strip, top-pinned dock, or case-insensitive duplicate-name
  guard. Planned: the two-step popup/dock affordance and the duplicate-name guard.
- **Delete confirmation** prompts a confirm dialog for every list (empty lists are
  not deleted immediately). The Home-card jiggle/edit-mode chrome, page swiper,
  tuner status bar, and list-detail display-mode pill (list/tiles/icons) are not
  ported; the lists tab is a flat scrollable list of summary rows. All Planned
  toward parity.

There is no CloudKit equivalent; lists stay device-local and ride the SAF JSON
backup export/import for manual transfer.

## Open questions

1. **Rename on the list-detail page.** Rename now ships as a Home card edit-mode
   pencil badge, resolving where the primary affordance lives. A per-list rename
   edit-state still exists but is unwired on the detail page itself — should the
   detail page also offer rename (tap the title?), or is the Home card the only
   intended entry point?
2. **List/station caps.** No cap exists today; should very large lists get a cap or
   off-main filtering like Browse?

## Reference

- `rrradio/Library/Library.swift` — `StationList` model; create/rename/delete/reorder
  lists, add/remove/reorder stations, uniqueness, name trimming, decode quarantine,
  catalog reconciliation, cross-store custom-station removal, removal-undo records
  (`StationRemoval`, `restore`), cloud-sync apply. `recentsLimit = 12`.
- `Shared/StationFeed.swift` — `StationFeed` protocol, `FeedID.stationList`,
  `FeedCapabilities`, playback-queue source matrix.
- `Shared/StationPlaybackQueue.swift` — circular skip-next/previous, queue identity,
  remove/replace-in-queue.
- `rrradio/Views/LibraryListSelection.swift` — page-swipe ordering
  (`orderedSelections`: Home · user lists · Recents; Favorites excluded).
- `rrradio/Library/Feeds/StationListFeed.swift` — the list feed (resolves by id,
  capabilities: reorder/remove/rename/delete/long-press info).
- `rrradio/Views/FeedPages/StationFeedPage.swift` — list detail renderer: rows/tiles/
  icons, delete badges, reorder, search, empty / no-match states, pull-to-refresh.
- `rrradio/Views/FeedPages/LibraryHomePage.swift` — list cards (interactive
  drag-reorder, pinned Recents), play, rename alert, delete-confirmation dialog.
- `rrradio/Views/FeedPages/LibraryChrome.swift` / `LibraryPageStatusBar.swift` —
  add-or-create "+" (Home), add-stations "+", Favorites "+", delete-mode toggle,
  status bar / tuner scale.
- `rrradio/Views/FeedPages/AddListPopupCard.swift` /
  `AddListStepStrip.swift` — add-or-create-list picker with the two-step strip and
  duplicate-name guard.
- `rrradio/Views/FeedPages/BrowseSelectionDock.swift` /
  `State/BrowseSelectionState.swift` — top-pinned Browse multi-select dock and
  selection model (incl. Favorites-target mode).
- `rrradio/Views/FeedPages/BrowsePage.swift` /
  `BrowseStationListSelectionRequest.swift` — multi-select entry, save folding +
  Favorites-target logic.
- `rrradio/Views/FeedPages/State/StationListEditState.swift` — per-list delete /
  rename edit state (rename draft unwired on the detail page).
- `rrradio/Views/StationKit.swift` — `StationListCard` (rename/delete badges) and
  `LibrarySelectionCard` (Recents card).
- `rrradio/Views/StationRemovalUndo.swift` — removal-undo controller + toast.
- `rrradio/Views/ContentView.swift` — list page wiring (remove/reorder callbacks,
  add-stations request, create-list popup host, undo-toast host).

## Known deviations

- Station-list blobs share the per-record decode-failure → data-loss cascade that
  [sync-merge](../contracts/sync-merge.md) tracks as C1 (resolved) and
  [catalog-schema](../contracts/catalog-schema.md) flags as its atomic-decode open
  question. See `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice10.md`
  §C1 for the prior bug and its keep-local resolution.
