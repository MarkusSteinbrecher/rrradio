# Navigation Specification

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: 8fc085b
```

## Purpose

The app shell is a flat, three-destination navigation — **Browse**, **Favorites**,
**Library** — that stays put while content changes above it. Browse is the catalog;
Favorites is the user's hand-curated dial; Library is the home for everything else the
user has accumulated (recently played, and their named station lists). The structure
is deliberately shallow: every primary surface is one tap from any other, and the user
is never more than two taps from playing something they've saved.

## Entry points

- The persistent **bottom tab bar** (mobile) and **left sidebar rail** (desktop web,
  ≥1024px) — the three destinations are always visible.
- Launch lands on **Browse** by default; a per-user **landing-page** preference can
  switch the boot destination (see [preferences-diagnostics](preferences-diagnostics.md)).
- A station deep link / inbound search (`?q=` on web) overrides the landing preference
  and opens Browse with the query applied.
- Now Playing is **not** a tab — it is a surface reached from the mini-player or a
  playing row, layered over the active destination (see [now-playing](now-playing.md)).

## Layout

The three destinations, in fixed order:

- **Browse** (globe icon) — the catalog: discovery landing, genre/country filters,
  search, results, map. See [browse](browse.md).
- **Favorites** (heart icon) — the Favorites surface, a top-level destination (not
  nested under Library). See [favorites](favorites.md).
- **Library** (folder icon) — the **Library home**, a navigator over the user's
  collections, top to bottom:
  - **User station lists** — one entry per named list, in user order; each opens its
    detail. A "new list" affordance creates one in place. See [station-lists](station-lists.md).
  - **Recents** — the auto-maintained recently-played list, a system entry pinned at
    the tail (below the lists). See [listening-history](listening-history.md).
  - Tapping any entry opens that collection's detail; a back affordance returns to the
    Library home.
  - **Favorites is not a Library-home entry** — it is reached only via its own
    top-level tab (matching iOS, whose Library home renders lists + Recents only).

Active-destination treatment: the current destination is accent-colored with an
indicator (a 2pt underline on iOS; an active pill / highlighted rail item on web). The
bar/rail never reorders.

## States

| State | What shows | Actionable |
|---|---|---|
| **Default** | Three destinations; Browse active on first launch (or the landing target). | Switch destination; the active surface owns its own states. |
| **Library home — empty** | The Recents system entry is always present (with its own empty state inside); no user-list entries when none exist, plus the "new list" affordance. | Create a list; open Recents. |
| **Library home — loaded** | User lists in order, then the pinned Recents entry. | Open any entry; create a list. |
| **Collapsed rail** (desktop) | The sidebar narrows to icons only; labels hide. | All three destinations remain tappable. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap Browse / Favorites / Library | Not already there | Switches the active destination and restores that surface's sub-state. | `track(tab/<name>)`. |
| Tap a Library-home entry (a list / Recents) | On the Library home | Opens that collection's detail. | — |
| Back from a Library detail | In a list / Recents detail | Returns to the Library home. | — |
| Re-tap the active destination | Already there | (iOS) pops to the destination root / scrolls to top. | — |
| Swipe horizontally within Library | iOS only | Pages Home · lists · Recents (the inner page-swiper). | — |

## Business rules

- **Three destinations, fixed order:** Browse, Favorites, Library. No more, no fewer.
- **Favorites is a top-level tab only** — it is *not* a Library-home entry (matching
  iOS, whose Library home renders the user's lists + Recents and excludes Favorites).
- **Recents lives only under Library** (it is not a top-level tab).
- **Station lists live only under Library** — there is no top-level Lists tab; the
  lists are the Library-home entries.
- The **landing-page** preference may target Browse / Favorites / Library (iOS reaches
  deeper — a specific list or a pinned station). A deep link or inbound search wins
  over the landing preference.

## Data dependencies

- [favorites](favorites.md), [station-lists](station-lists.md), [listening-history](listening-history.md)
  — the surfaces the Library home and Favorites tab present.
- [preferences-diagnostics](preferences-diagnostics.md) — the landing-page target.

## Edge cases

- **Last list deleted while open:** the Library detail falls back to the Library home.
- **Landing target points at a now-empty collection:** the destination still opens
  (its own empty state shows).
- **Narrow viewport (web):** below 1024px the sidebar rail is replaced by the bottom
  tab bar; the same three destinations, same routing.

## Accessibility

- Each destination button: label = destination name; the active one announces selected
  state.
- Library-home entries: label = collection name; value = station count; a "button"
  trait that opens the detail.
- Focus order follows visual order (Browse → Favorites → Library; within the Library
  home, the lists then the pinned Recents entry).

## Localization

Strings this surface owns: the three destination labels (`browse`, `favorites`,
`library`) and the Library-home Recents row title (`recents`). List names are user
data. See [localization](../contracts/localization.md).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Three-destination shell (Browse / Favorites / Library) | Supported (sidebar rail ≥1024px; bottom tab bar below). | Reference (bottom tab bar). | Supported (Lists / Browse / Favorites tab structure). |
| Favorites as its own top-level destination | Supported. | Reference. | Supported. |
| Library home (user lists + pinned Recents) | Supported; functional rows (icon · name · count) into existing detail views — no favicon-strips, per-card play button, now-playing indicator, or drag-reorder yet. | Reference (card navigator with favicon strips, per-card play, now-playing equalizer, long-press reorder). | Partial. |
| Library inner page-swiper (Home · lists · Recents) | Not planned for current web (tap-in + back instead of a horizontal swiper). | Reference. | Planned. |
| Recents under Library only | Supported. | Reference. | Supported. |
| Landing-page targets | Partial (Browse / Favorites / Library). | Reference (… plus a specific list or a pinned station). | Partial. |
| Collapsible nav rail | Supported (desktop sidebar collapses to icons). | Not applicable. | Not applicable. |

## Open questions

- Whether web brings the Library home to full iOS card fidelity (favicon strips,
  per-card play, now-playing indicator, drag-reorder) or keeps the functional-row form.
- Whether the web landing preference should gain the deeper iOS targets (a specific
  list, a pinned station).

## Reference

- `rrradio/Views/ContentView.swift` — `BottomTabBar`, the `AppTab` enum
  (browse / favorites / library), tab icons (`globe.desk` / `heart` / `folder`), the
  2pt active underline.
- `rrradio/Views/FeedPages/LibraryHomePage.swift` — the Library-home card navigator
  (Recents + Favorites + user-list cards).
- `rrradio/Views/LibraryListSelection.swift` — the `.home` / `.recents` / `.favorites`
  / `.stationList` selection model and `orderedSelections` (Favorites renders as a Home
  card but is excluded from the inner page-swiper sequence).
- `rrradio/Views/FeedPages/FavoritesPage.swift` — the Favorites surface (shared by the
  tab and the Library-home Favorites entry).

## Known deviations

None recorded. File new mismatches under `rrradio-ios/internal/audit/` and link them
here.
