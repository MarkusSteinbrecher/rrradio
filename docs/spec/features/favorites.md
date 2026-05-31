# Favorites Specification

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

Favorites are the user's primary personal radio dial: a hand-curated, reorderable
set of stations the user reaches first, presented in the visual density they
prefer (list, tiles, or app-icon grid). Recents is the automatic companion —
stations played recently, no manual upkeep — so the user can return to something
they just heard without re-finding it in the catalog.

## Entry points

- **Favorites** top-level tab (bottom navigation).
- **Library home → Favorites card** (descends into the same Favorites surface).
- **Recents** is reached from the Library home → Recents card, or the library
  page-swiper.
- Add/remove favorite from any station row's heart control (Browse, station-list
  detail, Now Playing).
- Custom stations enter favorites automatically on creation (see Business rules).
- Launch deep links / shortcuts that play a favorited or recently-played station
  surface it in these lists on next view.

## Layout

Top to bottom, the Favorites surface:

- **Chrome (shared, pinned above the page)**
  - Brand logo (taps route back to Browse), settings gear.
  - **Display-mode pill** in the brand row's center slot: one segment per *visible*
    display mode (list / tiles / app). Hidden when only one mode is visible. Hidden
    while the search field is expanded.
  - **Search field** (expandable via the magnifying-glass accessory) with a
    Favorites-scoped placeholder.
  - **Status bar**: page title ("FAVORITES"), search accessory, trailing "+"
    (create list), and a **trash toggle** (delete mode) when the page has removable
    content.
- **Page body** (one of three display modes; see Display modes):
  - **List** — dense favorite rows: favicon, station name + country flag, on-air
    mark when playing, optional now-playing track / program lines, optional cover-art
    thumb, calendar glyph when the station has program info.
  - **Tiles** — two-column cards (wider on iPad / landscape): favicon, name + flag,
    on-air mark, now-playing lines, cover-art thumb.
  - **App** — four-column app-icon grid (more columns on iPad / landscape): 64-pt
    rounded artwork tile + two-line centered name; accent underline + on-air chip on
    the current/playing station. No per-station metadata.
- **Catalog-fallback notice** (a one-line banner) replaces the favorites list when a
  search matches no favorite but does match the catalog (see States).
- **Empty state** when no favorites exist.

## States

| State | What shows | Actionable |
|---|---|---|
| **Empty** (no favorites) | `ContentUnavailableView`: "No favorites" + heart icon + "tap the heart to add" hint. | Navigate to Browse to add favorites. No reorder, no delete mode. |
| **Loading** | Catalog snapshot renders saved rows immediately from local storage; favicons / now-playing metadata fill in asynchronously. | Rows are tappable as soon as they render. |
| **Loaded** | The favorites list in the selected display mode. | Play, reorder, delete mode, search, switch display mode. |
| **No search result (favorites)** | If the query matches no favorite but matches the catalog: catalog matches render with a "no favorite matches — showing catalog" banner. If the query matches nothing at all: `ContentUnavailableView` "No stations found" + "try a different search". | Play (catalog matches use a `browse` queue). Reorder/delete disabled while searching. |
| **Partial** | Saved snapshots render even when the catalog has not refreshed; now-playing metadata lines are absent until the 60 s poll resolves. | Fully interactive. |
| **Error** | Persistence write failure is recorded as a local diagnostic; the in-memory list stays usable. A failed stream surfaces in the player, not this list. | List stays interactive. |
| **Offline** | Saved favorites/recents render from local storage; favicons and now-playing lines may be missing. | Play attempts proceed; stream errors surface in the player. |

## Display modes

Three presentations, switchable in place (no teardown):

| Mode | Icon | Layout | Per-station metadata |
|---|---|---|---|
| **list** | `list.bullet` | One column of dense rows. | Track / program lines + cover thumb. |
| **tiles** | `rectangle.grid.2x2` | 2-column cards (grows on wide canvases). | Track / program lines + cover thumb. |
| **app** | `square.grid.3x3` | 4-column app-icon grid (grows on wide canvases). | None — icons only. |

- The user switches mode by tapping a segment in the chrome's display-mode pill.
- **Order** (sequence of the segments) and **visibility** (which modes appear) are
  user preferences set in **Settings → Favorites display**: per-mode up/down move
  buttons reorder; a per-mode toggle shows/hides. At least one mode is always visible
  (the last visible mode cannot be hidden).
- The selected mode is restored from preferences **before** the first visible
  Favorites render — the UI must not flash one mode and jump to another.
- If the persisted selection points at a now-hidden mode, the selection falls back
  to the first visible mode.
- Switching modes restarts/stops now-playing polling (app mode stops it).

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap a row / tile / icon | Not in delete mode | Plays the station with a **favorites** queue (catalog-fallback search uses a **browse** queue). | Pushes a recent (catalog stations only); selection haptic on reorder commits elsewhere. |
| Tap a row / tile / icon | In delete mode | Exits delete mode (no play). | — |
| Tap heart on a row (list, where shown) | Station is favorite | Removes from favorites. For a **custom** station, deletes the custom station from the library. | Persists; row animates out. |
| Tap heart on a row | Station not favorite | Adds to favorites at the top. | Persists. |
| Long-press a row / tile / icon (~0.36 s) | List/tiles: long-press also drives the info preview; any mode | Enters **delete mode**: app icons jiggle, minus badges appear on every cell; the chrome trash toggle engages. | Snappy 0.16 s animation. |
| Tap a minus badge | In delete mode | Removes that favorite (custom station deleted; see above). | Persists; cell animates out. |
| Drag a cell onto another | Not searching, not in catalog-fallback, ≥1 favorite | Reorders favorites; the dragged cell moves through the grid, throttled so fine adjustments pass but the array isn't thrashed. | New order persisted on drop; selection haptic. |
| Release a long-press without moving | In delete mode | Stays in delete mode (lets the user tap a minus or drag) — matches iPhone Home. | — |
| Tap empty background | In delete mode | Exits delete mode. | — |
| Drag rolled back / cancelled | Mid-drag | Exits delete mode; order unchanged. | — |
| Tap the chrome trash toggle | Page has removable content | Toggles delete mode for the page. | — |
| Tap a display-mode pill segment | Segment is a visible mode, not current | Switches the display mode in place. | Persists selection; restarts/stops metadata polling. |
| Type in the search field | — | Debounced 180 ms; filters favorites by name; falls back to catalog matches when no favorite matches. | Reorder/delete disabled while searching. |
| Clear search (X) | Query non-empty | Restores the full favorites list. | — |
| Pull to refresh | ≥1 favorite, list/tiles | Immediately refetches now-playing metadata instead of waiting for the next 60 s poll. | — |
| Long-press (info hold) on a row | List | Shows a station info preview overlay; suppresses the next play tap. | Dismisses on release. |
| Heart control in **Now Playing** | A station is current | Toggles the current station's favorite state (custom station deletion applies). | Persists. |
| Media **previous / next** (lock screen, CarPlay, watch) | Active queue source is favorites (or no richer queue) | Steps to the adjacent favorite, **wrapping circularly**. | See [playback-state-machine](../contracts/playback-state-machine.md). |
| Removing the last favorite | In delete mode | Auto-exits delete mode; empty state shows. | — |

## Business rules

- **Add at top.** A newly favorited station is inserted at index 0; re-adding an
  existing favorite only refreshes its stored snapshot in place.
- **Stable user order.** Favorites keep a user-defined order; reorder rewrites it and
  persists immediately. Reorder is disabled while searching or showing the catalog
  fallback.
- **Custom stations are always favorites.** Creating a custom station adds it to
  favorites; on load the library re-asserts that every custom station is present in
  favorites. Un-favoriting a custom station **deletes** the custom station (and
  removes it from recents and all lists). Un-favoriting a catalog station only
  removes the favorite — it never deletes anything else.
- **Favorites as playback queue.** Playing from Favorites builds a queue with source
  `favorites`; previous/next then step through the favorites order (circular). The
  catalog-fallback search path uses a `browse` queue so skip walks the catalog
  matches instead of the user's favorites.
- **Recents auto-fill.** A recent is pushed when playback starts — but only for
  **catalog** stations (custom stations are excluded). Recents dedupe **by station
  id**: pushing a station already present removes its prior entry and re-inserts it
  at the top.
- **Recents cap.** iOS keeps the most recent **12** stations; older entries fall off
  the tail. (Web/Android cap and any time-window dedupe are governed by their own
  storage — see Open questions.)
- **Recents are read-only.** No reorder, no swipe-delete; the library trims its own
  tail.
- **Now-playing metadata** for list/tiles polls every **60 s**; the currently-playing
  row prefers the live player snapshot over the poll. App mode never polls.
- **Display-mode restore** happens before first render; at least one mode is always
  visible.

## Data dependencies

- [catalog-schema](../contracts/catalog-schema.md) — `Station` shape, stable ids,
  reserved id prefixes (`custom-`, `rb-`), favicon resolution. Favorites/recents store
  full `Station` snapshots locally and reconcile them against the catalog on refresh.
- [sync-merge](../contracts/sync-merge.md) — favorites + favorites-order + custom +
  list merge algebra (remote-order-wins); display-mode order/visibility preference
  keys; recents are **non-syncable**.
- [playback-state-machine](../contracts/playback-state-machine.md) — playback queue
  model, the `favorites` / `recents` queue sources, and circular previous/next
  stepping.

## Edge cases

- **Stale snapshot.** Saved favorite/recent snapshots from older app versions are
  reconciled to the canonical catalog copy on catalog refresh; entries whose id left
  the catalog are kept so the user can still play them.
- **Corrupt local store.** If the favorites/recents blob fails to decode, its bytes
  are quarantined to a recovery key and the list starts empty rather than being
  silently overwritten.
- **Persistence failure.** A failed write records a local diagnostic and leaves the
  in-memory list intact.
- **Reorder during search.** Disabled — only the full, unfiltered favorites order is
  mutable.
- **Removing the last favorite while editing** auto-exits delete mode.
- **Backgrounding mid-drag / mid-search** leaves the persisted order and the saved
  list untouched; transient drag state resets on return.
- **Cloud merge collision.** On CloudKit sync, remote favorites order wins; local-only
  ids trail; custom-station deletions propagate. See [sync-merge](../contracts/sync-merge.md).
- **Huge favorites set.** The grid swaps layouts in place and reconfigures visible
  cells rather than rebuilding, so mode switches stay cheap on large lists.

## Accessibility

- List heart control: "Add to favorites" / "Remove from favorites".
- Minus badge: "Remove from favorites".
- Display-mode segment: "<Mode title> view".
- App-icon cell: label = station name; hint = "Tap to play, long-press to rearrange"
  (delete mode: "Tap to exit remove mode").
- Tile cell hint: "Long-press to rearrange" (delete mode: "Tap outside to exit remove
  mode").
- On-air mark is labeled "On air".
- Calendar glyph is labeled "Program info".
- Recents count overflow circle on cards announces the total station count (plural).
- Dynamic Type: text scales; the app-grid name is capped at two lines with tail
  truncation. App-grid artwork is decorative (accessibility-hidden); the cell exposes
  a combined element.
- Focus order follows visual order, top-to-bottom / leading-to-trailing.

## Localization

Strings this surface owns: page title (`favorites`), empty title (`noFavorites`),
empty hint (`tapHeart`), no-result title (`noStationsFound`) + hint (`trySearch`),
catalog-fallback banner (`noFavoriteSearchResultsShowingCatalog`), search placeholder
(`searchFavorites`), display-mode titles + detail strings (`favoritesDisplayList` /
`Tiles` / `App` and their `…Detail`), the recents title (`recents`) + placeholder
(`searchRecents`) + empty hint, and the accessibility hints above. Plural need:
recents/station count circle (`stationsCount`). Parameterized: geo-restriction label,
stream-quality message. See [localization](../contracts/localization.md).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Add/remove favorites | Supported. | Supported. | Supported. |
| Reorder favorites | Supported. | Reference native behavior. | Partial; basic controls exist, native drag/reorder remains. |
| Favorites list view | Supported. | Supported. | Supported. |
| Favorites tile/app views | Partial/current web behavior may differ. | Reference. | Supported; visible/order settings still need parity. |
| Display-mode order/visibility preferences | Partial. | Reference (Settings → Favorites display). | Partial; order/visibility parity remains. |
| Drag-to-reorder + delete mode (jiggle/badges) | Supported. | Reference. | Partial. |
| Custom station forced-favorite + delete-on-unfavorite | Supported. | Reference. | Supported. |
| Favorites as playback queue (circular skip) | Supported. | Reference. | Partial. |
| Per-row now-playing metadata (list/tiles) | Supported. | Reference. | Partial. |
| Recents | Supported, capped. | Supported, capped (12). | Supported, capped. |
| Recents auto-fill on play (catalog-only) | Supported. | Supported. | Supported. |
| iCloud sync | Not planned. | Supported for favorites and order. | Not applicable. |
| Manual file export/import | Supported. | Planned/optional. | Supported through Android library backup. |
| Cross-platform sync | Not planned. | Not planned outside CloudKit. | Not planned for first port. |

## Persistence

- Web persists favorites and recents in browser storage; favorites can be
  exported/imported through the manual backup file.
- iOS persists favorites, recents, custom stations, and station lists locally
  (per-store keys) and syncs favorites + favorites-order + custom + lists through
  CloudKit; recents stay local-only.
- Android persists locally in DataStore; favorites are included in the manual Android
  backup file; recents remain local-only.
- The Favorites display-mode selection, order, and visibility are user preferences;
  iOS syncs them via CloudKit and restores the selection before the first Favorites
  render. Android persists the selection and restores it with the landing-page
  preference; order/visibility parity remains.
- Recents are non-syncable on every platform unless a future sync ADR changes that
  decision (see [sync-merge](../contracts/sync-merge.md)).

## Open questions

- Recents cap and dedupe diverge by platform: iOS caps at 12 and dedupes purely by id
  (no time window). The shared product intent (a larger cap, e.g. 30, and/or a 60 s
  same-station dedupe window) is not yet reconciled into a single number across web /
  iOS / Android.
- Web's tile/app display modes and order/visibility settings have no agreed parity
  target with the iOS Reference behavior.

## Reference

- `rrradio/Views/FeedPages/FavoritesPage.swift` — the three-mode renderer, delete
  mode, drag-to-reorder wiring, search debounce + catalog fallback, play + recent push.
- `rrradio/Views/StationKit.swift` — `FavoritesDisplayMode` (order/visibility/selection
  normalization), `FavoriteJiggleModifier`, delete badge, list row / tile / app-icon
  views, drop delegates.
- `rrradio/Library/Library.swift` — favorites/recents/custom/list stores: add/remove,
  `toggleFavorite`, `reorderFavorites`, `pushRecent` / `pushRecentIfCatalogStation`,
  `recentsLimit = 12`, catalog reconciliation, cloud-sync apply, quarantine-on-decode.
- `rrradio/Library/Feeds/FavoritesFeed.swift`, `RecentsFeed.swift` — feed capabilities
  and queue source bindings.
- `rrradio/Views/FeedPages/LibraryChrome.swift` — display-mode pill, search field,
  delete-mode toggle, title/placeholder per selection.
- `rrradio/Views/SettingsView.swift` — Favorites display-mode order/visibility config.
- `Shared/StationPlaybackQueue.swift` — queue model + circular stepping.
- `rrradio/Player/AudioPlayer.swift`, `rrradio/Player/Metadata/FavoriteNowPlayingStore.swift`
  — active queue source, station stepping, 60 s now-playing poll.

## Known deviations

None recorded. File new mismatches under `rrradio-ios/internal/audit/` and link them
here.
