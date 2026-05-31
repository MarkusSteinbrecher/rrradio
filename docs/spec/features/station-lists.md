# Station Lists Specification
```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

Station lists are named collections of stations that sit beside Favorites and
Recents in the library. They let a user gather stations for a mood, region, show,
or trip without crowding the main favorite dial. A list is local-first, reorderable,
and doubles as a playback queue: playing a station from a list steps previous/next
through that list.

## Entry points

- **Library Home** — every list appears as its own card in the library navigator,
  beside the Recents and Favorites cards.
- **Library page swiper** — each list is a swipeable page in the library
  page sequence (Home · lists · Recents); a tuner-style status bar shows the
  current list's title with its neighbours hinted to either side.
- **Create from Browse** — the "+" affordance on the Browse sort row opens an
  add-or-create-list popup; choosing "Create list" enters Browse multi-select to
  compose a new list.
- **Create from library chrome** — the "+" accessory in the library status bar
  (when not already inside a list) opens a create-list name prompt.
- **Add to existing list** — the "+" accessory while viewing a list, or picking an
  existing list in the Browse add-list popup, enters Browse multi-select targeting
  that list.
- **Open a list** — tap a list card on Library Home, or swipe to its page.
- **Pinned launch** — a list may be pinned as the launch landing surface (see
  [preferences-diagnostics](preferences-diagnostics.md)); the app opens directly
  into it.

## Layout

### Library Home — list card
- One card per list, in user order, after the Recents and Favorites cards.
- Shows the list name, a strip of station favicons (empty hint when the list has
  no stations), a play control, and a current-list indicator when this list is the
  active playback queue.
- Tapping a station favicon opens the list and plays that station queued against
  the list.
- In delete mode the card shows a remove control; tapping it deletes the whole
  list.

### List detail page (top to bottom)
- **Library chrome** (shared, fixed above the page): brand/logo row with a
  collapsible search field and a settings gear; a status bar with a back-to-home
  arrow, the list title (uppercased, tuner scale beneath), a leading search icon,
  a trailing "+" add-stations icon, and a trash delete-mode toggle; a divider rule.
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
- A bar pinned above the bottom chrome: a cancel control (x), the draft list name
  (or target list name) with a selection-count badge, and a save control (checkmark).
- Save is disabled until at least one station is selected and the name is non-empty.

### Add-or-create-list popup (from Browse "+")
- A card titled "Add or create list" with a "Create list" row that morphs into a
  focused name field when selected, followed by one row per existing list (accent
  checkmark on the selected target), and cancel (x) / confirm (checkmark) footer
  controls. Confirm is disabled until a target is valid (non-empty new name, or a
  picked existing list).

## States

| State | What shows | Actionable |
|---|---|---|
| **Empty (no lists)** | No list cards on Library Home; only Recents/Favorites cards. Trash/delete-mode is unavailable. | Create a list from Browse "+" or the chrome "+". |
| **Empty (list has no stations)** | Unavailable view: "Empty station list" + "Add stations from Browse to build this list." | "+" add-stations, search, delete-mode auto-unavailable (nothing to remove). |
| **Loading** | Lists render immediately from local storage on launch; no spinner. Station blobs render before the catalog refreshes from network. | Full interaction; rows reconcile in place when the catalog arrives. |
| **Loaded** | List cards on Home; list detail shows its stations in order. | Play, reorder, remove, add, delete, rename (model-level), search. |
| **Partial (search active, some matches)** | Filtered subset of the list's stations. | Play / open the visible matches. |
| **No matches (search active)** | "No stations found" view. | Clear the search to restore the full list. |
| **Offline** | Lists and their station blobs render from local storage; play attempts stream as usual. | Full library interaction; playback subject to network. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap "+" on Browse sort row | On Browse | Opens add-or-create-list popup | — |
| Select "Create list" + type name + confirm | Popup open | Enters Browse multi-select with that name seeded in the dock | Dismisses search focus |
| Pick an existing list + confirm | Popup open | Enters Browse multi-select targeting that list (name = list name) | — |
| Tap a Browse row in multi-select | Multi-select active | Toggles the station into the selection (tap order preserved) | Selection-count badge updates |
| Tap save (checkmark) in dock | ≥1 selected and name non-empty | Saves: appends to target list, or folds into an existing list whose name matches case-insensitively, or creates a new list with the selected stations | Exits multi-select; opens the destination list; switches to Library tab |
| Tap cancel (x) in dock | Multi-select active | Discards the selection and name | Exits multi-select |
| Tap "+" in library chrome (not in a list) | On a library page | Opens a create-list name prompt | — |
| Confirm create-list prompt | Name non-empty (trimmed) | Creates an empty list and opens it | Empty/whitespace name rejected (Confirm disabled) |
| Tap "+" in chrome while viewing a list | On a list detail page | Enters Browse multi-select targeting this list | Switches to Browse tab |
| Tap a list card on Home | Not in delete mode | Opens the list detail page | — |
| Swipe horizontally on a list page | Not in delete mode | Moves to the neighbouring library page | — |
| Tap a station row/cell | Not in delete/reorder | Plays the station; list becomes the active playback queue | Pushes to recents if it is a catalog (non-custom) station |
| Tap play on a list card | List non-empty | Plays the first station, queued against the list | Pushes to recents if catalog station |
| Tap a favicon in a list card | — | Opens the list and plays that station queued against the list | Switches to Library; pushes recents if catalog station |
| Long-press a row/cell | List supports reorder/remove | Enters delete mode (per-row remove badges, jiggle on icon grid) | Drives shared chrome delete state |
| Tap trash icon in status bar | Delete-mode available (list non-empty) | Toggles delete mode | Swiping to another page exits delete mode |
| Tap a row's remove badge | In delete mode | Removes that station from the list | Removing the last station auto-exits delete mode |
| Tap delete badge on a list card (Home) | Home delete mode | Deletes the whole list | Deleting the last list exits delete mode |
| Tap outside badges / background | In delete mode | Exits delete mode | — |
| Drag a row to a new position | Reorder enabled | Reorders stations within the list; persists new order | Selection haptic on drop; scroll disabled mid-drag |
| Skip next / previous (lock screen, in-app) | Playing from a list | Steps to the next/previous station in the list, wrapping circularly | Queue identity tied to the list id |
| Pull to refresh on a list page | List non-empty | One-shot now-playing metadata fetch for the list's stations | Merges results into per-row metadata cache |
| Type in the chrome search field | List detail or Recents | Filters the visible list (180 ms debounce) | Filter shared across library pages |
| App backgrounded mid-edit | Any | List state already persisted on each mutation | iCloud push debounced (see sync) |

## Business rules

- **Membership**: a list holds at most one entry per station id; re-adding the same
  station replaces the stored blob, it does not duplicate the row.
- **Name**: created/renamed names are trimmed of surrounding whitespace; an empty or
  whitespace-only name is refused (create returns nothing, rename returns false). UI
  confirm controls disable on empty trimmed input so the refusal is a safety net.
- **Identity**: each list gets a stable UUID id at creation; renames keep the id.
- **Ordering**: lists keep user order; stations keep user order within a list.
  Reorder operations that don't change the order are no-ops (no persistence write).
- **Save-from-Browse folding**: an explicit target list always wins; otherwise a
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
- **Save with empty selection or empty name**: save is refused (dock save disabled);
  no list is created or mutated.
- **Re-adding a selected station already in the target list**: replaces the blob,
  no duplicate row.
- **Removing the last station while in delete mode**: delete mode auto-exits so the
  page isn't stranded in an empty edit state.
- **Deleting the last list**: Home delete mode auto-exits.
- **Reorder during root horizontal swipe**: the page-swiper is suppressed in delete
  mode so a drag can't double as a page change.
- **Huge lists**: list detail filters synchronously per keystroke on the main thread;
  this is safe only for small library-sized lists, not catalog-scale feeds.
- **Persistence failure**: a write error is recorded as a sanitized diagnostic
  (store name + error type only); in-memory state still reflects the edit.
- **Backgrounding mid-edit**: each mutation persists locally immediately; the iCloud
  push is debounced and retried with backoff (see sync).

## Accessibility

- Remove badge: "Remove {name} from list".
- Add-stations / create controls: "Add stations to list", "Create list",
  "Add or create list".
- Status-bar controls: back-to-home "Show Library pages", delete toggle "Enter
  delete mode".
- List status bar announces the page as title + position in the swipe sequence
  ("{title}, page {index} of {total}").
- Empty list announced as "{name}, empty list".
- Dock controls labeled cancel / save; popup confirm labeled done.
- Search field, clear button, and display-mode pills carry labels.
- Names and titles support Dynamic Type; the uppercased title scales down before
  truncating from the middle. Station names wrap to two lines in icon mode.
- All controls meet a 44pt hit target.

## Localization

Strings this surface owns:

- `stationLists` ("Station Lists") — fallback list title / library label.
- `stationListsHint` ("Create a list to collect stations outside favorites.").
- `createStationList` ("Create list"), `stationListName` ("List name").
- `addOrCreateList` ("Add or create list"), `addStationsToList` ("Add stations to
  list").
- `emptyStationList` ("Empty station list"), `emptyStationListHint` ("Add stations
  from Browse to build this list.").
- `noStationsFound` ("No stations found"), `trySearch` ("Try a station name, country
  code, or tag.").
- `removeFromList` — parameterized on `{name}` ("Remove {name} from list").
- `stationListEmptyA11y` — parameterized on `{name}` ("{name}, empty list").
- `statusBarPageA11y` — parameterized on `{title}`, `{index}`, `{total}`.

Parameter needs: `{name}` (station/list name), `{title}`/`{index}`/`{total}` (page
position). No plural categories required today (count badge is a bare numeral).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Station-list overview | Not planned for current web. | Reference. | Supported. |
| Create/delete list | Not planned for current web. | Supported. | Supported. |
| Rename list | Not planned for current web. | Supported (model + edit-state; see Open questions on chrome affordance). | Supported. |
| Create from Browse multi-select | Not planned for current web. | Supported (popup name entry + selection dock). | Supported. |
| Add stations from Browse | Not planned for current web. | Supported. | Supported. |
| Remove stations from a list | Not planned for current web. | Supported. | Supported. |
| Reorder lists | Not planned for current web. | Supported. | Supported with up/down controls. |
| Reorder stations inside a list | Not planned for current web. | Supported (interactive drag). | Supported with up/down controls. |
| Play list as queue | Not planned for current web. | Supported (circular skip). | Supported. |
| Empty-list guidance | Not planned for current web. | Supported ("Add stations from Browse…"). | Supported. |
| Cloud sync | Not applicable. | Supported through CloudKit. | Not applicable. |
| Local persistence | Not planned for current web. | Supported. | Supported. |

## Android Current Status

Android now has the core station-list model in scope: list overview, create,
rename, delete, Browse batch-add, station removal, list reorder, station
reorder, local persistence, and queue-scoped playback are implemented. Remaining
polish is Android-native drag/reorder ergonomics if the up/down controls feel
too heavy.

## Open questions

1. **Rename affordance on iOS.** The rename mutation (`renameStationList`) and a
   per-page rename edit-state exist and are tested, but the current shared library
   chrome surfaces only create (name prompt), add-stations, and delete — no live
   rename control on the list detail page. Where should rename live (tap the title?
   a long-press menu?) and does Home need an inline rename too?
2. **List/station caps.** No cap exists today; should very large lists get a cap or
   off-main filtering like Browse?
3. **List-level reorder on iOS.** Lists reorder is marked Supported, but the live
   surface for dragging whole lists vs. the Android up/down controls is unconfirmed
   in the read sources.

## Reference

- `rrradio/Library/Library.swift` — `StationList` model; create/rename/delete/reorder
  lists, add/remove/reorder stations, uniqueness, name trimming, decode quarantine,
  catalog reconciliation, cross-store custom-station removal, cloud-sync apply.
- `Shared/StationFeed.swift` — `StationFeed` protocol, `FeedID.stationList`,
  `FeedCapabilities`, playback-queue source matrix.
- `Shared/StationPlaybackQueue.swift` — circular skip-next/previous, queue identity,
  remove/replace-in-queue.
- `rrradio/Library/Feeds/StationListFeed.swift` — the list feed (resolves by id,
  capabilities: reorder/remove/rename/delete/long-press info).
- `rrradio/Views/FeedPages/StationFeedPage.swift` — list detail renderer: rows/tiles/
  icons, delete badges, reorder, search, empty / no-match states, pull-to-refresh.
- `rrradio/Views/FeedPages/LibraryHomePage.swift` — list cards, play, delete a list.
- `rrradio/Views/FeedPages/LibraryChrome.swift` / `LibraryPageStatusBar.swift` —
  create prompt, add-stations "+", delete-mode toggle, status bar / tuner scale.
- `rrradio/Views/FeedPages/AddListPopupCard.swift` — add-or-create-list picker.
- `rrradio/Views/FeedPages/BrowseSelectionDock.swift` /
  `State/BrowseSelectionState.swift` — Browse multi-select dock and selection model.
- `rrradio/Views/FeedPages/BrowsePage.swift` — multi-select entry + save folding
  logic.
- `rrradio/Views/FeedPages/State/StationListEditState.swift` — per-list delete /
  rename edit state.
- `rrradio/Views/ContentView.swift` — list page wiring (remove/reorder callbacks,
  add-stations request).

## Known deviations

- Station-list blobs share the per-record decode-failure → data-loss cascade that
  [sync-merge](../contracts/sync-merge.md) tracks as C1 (resolved) and
  [catalog-schema](../contracts/catalog-schema.md) flags as its atomic-decode open
  question. See `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice10.md`
  §C1 for the prior bug and its keep-local resolution.
