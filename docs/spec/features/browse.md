# Browse Specification

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

Browse is the catalog discovery surface: the "all stations" view where a user
finds something to play. It renders the shared catalog, folds live community
results into an active search, narrows by genre / country / news, sorts the
un-queried catalog, supports building a station list from multiple picks, and
offers a map view for geographic exploration. The search *field* mechanics
(normalization, tier precedence, Radio Browser API) live in
[search](search.md) and [features/search](search.md); this spec links to them
and does not re-derive them.

## Entry points

- The Browse tab in the bottom navigation (default landing page unless the user
  set another).
- Tapping the inline rrradio logo on any tab routes to the Browse tab (logo as a
  "go home" affordance); on Browse itself it re-selects the tab and resets
  scroll.
- A "+" / "add stations" affordance on a station-list detail page or the library
  home jumps into Browse in multi-select mode targeting that list (see
  [station-lists](station-lists.md)).
- Deep links / Shortcuts that open a station resolve through the catalog Browse
  consumes.

## Layout

Top to bottom:

1. **Top control row** (collapses on scroll-down, expands on scroll-to-top):
   - rrradio **logo button** (left) — go home / re-select Browse.
   - **Search field** (capsule) — magnifier icon, placeholder "Search all…",
     inline clear (✕) button when non-empty. Field behavior in
     [search](search.md).
   - **Filter button** — funnel icon; shows an accent dot when any filter is
     active.
   - **Settings button** — gear icon; opens the settings sheet.
2. **Sort row** — three columns:
   - Left: **alphabet sort** control aligned over the row artwork column.
   - Center: **result-count label** (numeric; hidden while multi-select is
     active so the dock can use the center).
   - Right: **"+" add-to-list** control opening the add-list popup.
3. **Top nav rule** — hairline divider; the boundary above which chrome stays
   sharp when a popup blurs the content below.
4. **Content area** — one of:
   - Station list/grid of rows, each row showing logo (favicon), name,
     country/tag context, a stream-quality meter, a favorite heart, and current
     /playing indicators. Rows render `featured`-first then catalog order; an
     active query replaces this with relevance order.
   - Empty-state view (search vs. catalog variants).
   - A trailing **load-more** spinner when more local pages or community results
     remain.
5. **Multi-select dock** (only while composing a list) — cancel (✕), list-name
   label + selection-count badge, save (✓). Sits above the bottom chrome; the
   mini-player is hidden while it is up.
6. **Popup overlays** (transient, centered, over a blurred content backdrop):
   filter popup, add-list popup, and a press-and-hold station-info preview.
7. **Map view** (separate surface) — a sheet with a header, an interactive map,
   and a scrollable country list (see Map section).

### Row layout (per station)

| Element | Shows |
|---|---|
| Favicon | Station logo, or a placeholder when absent. |
| Name | Display name (one line). |
| Context | Country / tag signal. |
| Quality meter | Filled bars 1–4 derived from `codec`+`bitrate` ([catalog-schema](../contracts/catalog-schema.md)); passive indicator in Browse (not tappable). |
| Favorite heart | Toggles favorite; hidden in multi-select. |
| Current/playing badge | Marks the current station and whether it is playing. |
| Selection bubble | Replaces play/favorite affordances while multi-select is active. |

## States

| State | What shows | Actionable |
|---|---|---|
| **Loading (cold)** | Catalog resolves cache → bundled snapshot → network ([catalog-schema](../contracts/catalog-schema.md)); the first source renders immediately. | Rows are tappable as soon as any source renders. |
| **Loaded (no query, no filter)** | Full catalog, `featured`-first, capped to the visible window (first 25 rows), load-more grows it. | Play, favorite, info-hold, sort, filter, multi-select. |
| **Loaded (filtered)** | Catalog narrowed by country/genre/news; count reflects the filtered set. | Same; filter dot lit. |
| **Loaded (query active)** | Local matches (relevance order) then community results appended as the user pages; sort suppressed. | Play, favorite, info-hold, multi-select; load-more pages local then Radio Browser. |
| **Empty (query)** | "No stations found" + "try a different search" with a magnifier glyph. | Clear search to return to catalog. |
| **Empty (catalog)** | Catalog empty title + "no rows" description. | Retry occurs via the catalog refresh ladder; nothing in-view to tap. |
| **Partial** | Local results render while community results stream in behind the load-more spinner. | All loaded rows actionable; spinner is non-interactive. |
| **Error (catalog refresh fails, data already shown)** | Stays in loaded state on cache/bundled data; no error chrome. | Normal. |
| **Error (community fetch fails)** | Load-more row vanishes; looks identical to "no more results" (no error UI — see Known deviations). | Loaded rows still actionable. |
| **Offline** | Disk-cache / bundled catalog renders; community (Radio Browser) tier yields nothing. | Play (stream may fail per [playback](../playback.md)); favorite; filter; sort. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap logo | On another tab | Route to Browse tab | — |
| Tap logo | Already on Browse | Re-select tab | Scroll to top, chrome re-expands |
| Tap settings gear | — | Open settings sheet | — |
| Type in search field | — | Debounced 180 ms, then query updates | Resets visible window to 25; (re)issues community search; recomputes results off-main |
| Submit search (return) | — | Commit query immediately, bypassing debounce | Dismisses keyboard |
| Tap clear (✕) in field | Field non-empty | Clears text and query | Community paginator reset; catalog re-shows |
| Tap filter funnel | — | Open filter popup over blurred content | — |
| Tap outside filter popup | Popup open | Dismiss without applying | Draft discarded |
| Expand a filter section | Filter popup open | Reveal genres (news + genre rows) or countries (search + rows) | — |
| Toggle a genre / news / country row | Filter popup open | Toggle membership in the draft; section badge updates | — |
| Type in country search | Country section expanded | Filters country rows; selected countries pinned to top | — |
| Tap ✓ (apply) | Filter popup open | Apply draft filter, close popup | Resets window; re-issues community search with first genre/country; recomputes |
| Tap trash (clear) | Draft non-empty | Reset draft to no filter (still must Apply) | — |
| Tap ✕ (cancel) in popup | Filter popup open | Close, discard draft | — |
| Tap alphabet sort | No active query | Cycle off → A→Z → Z→A → off | Resets window; recomputes order |
| (Sort while query active) | Query active | Sort suppressed; relevance order kept | — |
| Tap "+" add-to-list | — | Open add-list popup (Create new / pick existing) | — |
| Pick "Create new" + name | Add-list popup | Enter multi-select, no target list, dock seeded with name | Mini-player hidden; count label hidden |
| Pick existing list | Add-list popup | Enter multi-select targeting that list, dock seeded with its name | Same |
| Tap a row (multi-select off) | Loaded | Play station | Pushes to recents if it is a catalog station; queues the visible window for skip-next |
| Tap a row (multi-select on) | Multi-select active | Toggle selection (tap order preserved) | Dock count updates |
| Tap favorite heart | Multi-select off | Toggle favorite | Library mutation; sync per [data-sync](../data-sync.md) |
| Press-and-hold a row | Multi-select off | Show station-info preview overlay while held | Releasing dismisses it |
| Tap dock ✓ (save) | ≥1 selected AND name non-empty | Append to target list, or append to a name-matched list, or create a new one | Leaves multi-select; opens the destination list in Library |
| Tap dock ✕ (cancel) | Multi-select active | Discard selection, leave multi-select | Mini-player returns |
| Scroll to load-more spinner | More local pages remain | Grow visible window by 25 | — |
| Scroll to load-more spinner | Local exhausted, query active | Fetch next community page (50 rows) | Network call per [search](search.md) |
| Open map | (map surface entered) | Show map sheet | — |
| Pinch / pan map | Map open | Re-clusters: country pins when zoomed out, station pins under ~7° latitude span, logo pins under ~2.5° with ≤35 stations | Recomputes visible pins (cap 70) |
| Tap country pin / country row | Map open | Select that country, recenter map on it | Drives the bound `selectedCountry` |
| Tap "All countries" | Map open | Clear country selection, recenter to world | — |
| Tap a station pin | Map open (pins shown) | Open that station and dismiss the map | Plays / routes to the station |
| Backgrounding / tab switch away | — | Cancel debounce + filter tasks, reset community paginator, dismiss info preview | — |

## Business rules

- **Search debounce:** 180 ms after the last keystroke; Submit commits
  immediately.
- **Visible window (paging):** renders the first 25 of the result set; each
  load-more grows the cursor by 25. Window resets to 25 on any query / filter /
  sort change. The rendered window is clamped to never exceed the result count
  and never drop below one page.
- **Local result cap:** the FTS-backed search result set is capped at 5000 rows.
- **Featured-first ordering:** the un-queried catalog lists `featured: true`
  stations first, then catalog order ([catalog-schema](../contracts/catalog-schema.md)).
- **Sort suppression under query:** an active query forces relevance order; the
  alphabet/quality/favorite sort applies only to the un-queried catalog. (Rule
  owned by [search](search.md).)
- **Sort cycle (alphabet):** off → ascending → descending → off. The
  quality-high/low and favorite-first/last sorts exist in the sort model but the
  Browse sort row's only on-screen control cycles the alphabet sort.
- **Sort comparators:** name uses locale-aware case-insensitive compare with
  station-id tiebreak; quality uses the derived `codec`+`bitrate` meter;
  favorites partitions favorited vs. not. (See [catalog-schema](../contracts/catalog-schema.md)
  for the quality meter.)
- **Community tier fires only when a query is non-empty** and surfaces as a
  "more results" extension; it is dormant for pure catalog browsing.
- **Community page size:** the Browse paginator requests 50 rows per page (the
  client default is 60); tier ordering, dedupe, and the country-code
  short-circuit are owned by [search](search.md).
- **Filter → community mapping:** the first sorted selected genre's `rbTag`
  (else `news` when only the news toggle is on) and the first sorted selected
  country code are passed to the community search.
- **Result count label** equals the merged local+community result count (the
  community hits are already merged into the result set, so they are not
  double-counted). Hidden while multi-select is active.
- **Multi-select save resolution:** save targets the requested list if present;
  else a list whose name case-insensitively matches the typed name; else creates
  a new list. Save requires ≥1 station and a non-empty trimmed name. Selection is
  stored as full `Station` values (not just IDs) so picks made under an earlier
  query survive into the save even when no longer in the visible pool. Selection
  persists across page swipes within Browse.
- **Filter sections:** genres = a news toggle plus the fixed `genres` taxonomy;
  countries = the catalog's available 2-letter country codes, device region
  pinned first, currently-selected pinned to top while searching.
- **Map clustering thresholds:** station pins appear when the visible latitude
  span < 7°; logo pins (favicon) when span < 2.5° and ≤35 visible stations;
  otherwise country-aggregate pins. Visible station pins capped at 70; map shows
  up to 100 country pins and the country list up to 80 rows. Country aggregation
  requires a valid `geo` and a 2-letter country; rows sort by station count
  desc, then country display name.
- **Recents:** playing a *catalog* station pushes it to recents; community /
  custom stations do not (see [favorites](favorites.md)).

## Data dependencies

- [search](../contracts/search.md) — query normalization, tier precedence,
  ranking, the Radio Browser API shape, dedupe, and the country-code
  short-circuit. The search field UX is [features/search](search.md).
- [catalog-schema](../contracts/catalog-schema.md) — the `Station` field set,
  required/optional rules, `featured`-first ordering, the `codec`+`bitrate`
  quality meter, `geo` for the map, `availableIn` geo-restriction badging, and
  the cache → bundled → network load-order ladder.
- [operations.md](../../operations.md) — catalog generation, curation, and
  source provenance (not restated here).
- [playback](../playback.md) — what happens when a tapped stream fails or is
  geo-restricted.
- [station-lists](station-lists.md) — destination of multi-select save.

## Edge cases

- **Stale / superseded query, filter, or sort:** the off-main filter pipeline is
  cancellable (polls cancellation every 512 stations); a newer keystroke /
  filter / sort / catalog change preempts an in-flight scan so they do not stack.
- **FTS index missing or diverged > 10%:** Browse falls back to a substring scan
  over `unique(catalog + custom + community)`; results still render, unranked.
  Owned by [search](search.md).
- **Community fetch error / all mirrors fail:** the load-more row disappears with
  no error UI or retry — indistinguishable from "no more results" (Known
  deviations).
- **Country filter + query ≤ 2 chars:** community tier is suppressed (local tiers
  still run) to avoid thousands of irrelevant rows ([search](search.md)).
- **Huge result sets:** broad queries are capped to 5000 local rows and rendered
  25 at a time, so the list never lays out the full match set at once.
- **Catalog refresh fails after data already shown:** stays loaded on
  cache/bundled data; no error chrome.
- **Custom-station changes / catalog revision changes** trigger a recompute so
  the visible set stays consistent.
- **Backgrounding / leaving Browse:** debounce + filter tasks cancel, the
  community paginator resets, and any info preview is dismissed.
- **Map with no `geo` data:** stations without valid `geo` are absent from pins
  and country aggregates; the country list simply omits them.
- **Geo-restricted rows:** stations with `availableIn` are dimmed and badged for
  out-of-region users; play maps upstream 401/403 to a geo-restricted message
  ([catalog-schema](../contracts/catalog-schema.md), [playback](../playback.md)).

## Accessibility

- Logo button labeled "go home"; settings labeled "settings"; clear-search
  labeled "clear search".
- Filter button carries a label ("filters") and a value reflecting whether
  filters are active ("no filters active" / "filters active").
- Alphabet sort's label states the *next* action ("sort ascending" / "sort
  descending" / "clear alphabetic sort").
- Add-to-list "+" labeled "add to list"; dock buttons labeled "cancel" / "save".
- Filter popup: cancel = "cancel", clear = "clear filters", apply = "done";
  selected picker rows expose the selected trait.
- Load-more spinner labeled "loading".
- Map pins expose readable labels ("Open <station>", "<country>, <n> stations").
- Dynamic Type: row text and the filter picker rows scale; the picker label
  rows shrink minimally before truncating. Count label and badges use a
  monospaced numeric style.
- Focus order follows top control row → sort row → result rows → dock.

## Localization

Strings this surface owns (keys, not literals):

- Search: `searchAll` (placeholder), `clearSearch`.
- Sort: `sortAscending`, `sortDescending`, `clearAlphabeticSort`.
- Filters: `browseFiltersA11y`, `noFiltersActive`, `filtersActive`,
  `createFilter`, `clearFilters`, `genre`, `country`, `news`, `searchCountries`.
- Add-to-list / dock: `addToList`, `cancel`, `save`, `done`.
- Empty states: `noStationsFound`, `trySearch`, `catalogEmpty`, `catalogNoRows`.
- Chrome: `browse`, `goHome`, `settings`, `loading`.
- Map: `map`, `allCountries`; country names rendered via the OS locale's
  region display names; flag emoji derived from the code.

Plural / parameter needs: the result-count label and country-station counts are
numeric and need locale-aware number formatting; the map's "<n> stations" and
country-row counts are pluralizable.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Curated catalog | Supported. | Supported. | Supported. |
| Large Radio Browser-backed catalog | Supported. | Supported with bundled index/cache behavior. | Supported with cache-backed loading. |
| Search normalization | Supported. | Reference native behavior. | Supported. |
| Country filter | Supported. | Supported with native picker rows. | Supported. |
| Genre/tag filter | Supported. | Supported. | Supported. |
| News filter toggle | Supported. | Supported. | Supported. |
| Searchable country picker with selected-pinned-to-top | Supported. | Supported. | Supported. |
| Map browse | Supported with web map asset. | Supported with MapKit. | Planned with native map, provider TBD. |
| Add several stations to a station list | Not planned for current web. | Supported from Browse. | Supported. |
| Multi-select dock (name + count + save) | Not planned for current web. | Supported. | Supported. |
| Sort controls | Supported. | Reference native behavior. | Supported for name, quality, and favorite-state sorting. |
| Alphabet sort cycle (off/A–Z/Z–A) in the sort row | Supported. | Reference native behavior. | Supported. |
| Quality / favorite-state sort | Supported. | Supported in the sort model. | Supported. |
| Featured-first catalog ordering | Supported. | Supported. | Partial. |
| Result-count label | Supported. | Supported. | Supported. |
| Visible-window paging (load more) | Supported. | Supported (25-row pages). | Supported. |
| Community results appended to active search | Supported. | Supported (50-row pages). | Supported. |
| Sort suppressed while a query is active | Required. | Reference. | Required. |
| Station info preview | Basic row details. | Supported from station rows (press-and-hold). | Supported with long-press row preview. |
| Geo-restriction dim/badge on rows | Supported. | Supported. | Planned. |
| Wide-layout multi-column grid | Responsive. | Supported (iPad + iPhone landscape). | Planned. |

## Open questions

- The quality-high/low and favorite-first/last sorts exist in the iOS sort model
  and `BrowseFeed`, but the Browse sort row only surfaces the alphabet cycle.
  Whether those should get dedicated controls in the sort row (and whether all
  platforms expose the same sort set) is unresolved. The matrix records them as
  product-supported behaviors regardless of which control exposes them.
- The map view exists as a self-contained surface; its exact entry point on iOS
  (which control opens it) should be confirmed at reconciliation and stated in
  Entry points.
- Community-result re-ranking against the query (vs. votes-only order) is an
  open product call carried in [search](search.md).
- No enforced minimum/maximum query length aside from the country-filter
  ≤2-char community gate ([search](search.md)).

## Reference

iOS source (the only place iOS mechanics are named):

- `rrradio/Views/FeedPages/BrowsePage.swift` — the page: top row, search field
  (180 ms debounce), sort suppression under query, off-main cancellable filter
  pipeline, 25-row visible window, 5000-row local cap, load-more, multi-select
  entry, play/recents.
- `rrradio/Views/FeedPages/BrowseFiltersSheet.swift` — genre/news/country filter
  popup, country search, selected-pinned ordering, apply/clear/cancel.
- `rrradio/Views/FeedPages/BrowseSortRow.swift` — alphabet sort cycle, count
  label, add-to-list "+".
- `rrradio/Views/FeedPages/BrowseSelectionDock.swift` — multi-select dock
  (cancel / name+count / save) and save-enabled rule.
- `rrradio/Views/FeedPages/State/BrowseSelectionState.swift` — selection model
  (full-Station storage, tap order, save target).
- `rrradio/Views/FeedPages/State/RadioBrowserPaginator.swift` — community
  pagination (50-row pages), `hasMore`, reset.
- `rrradio/Views/StationMapView.swift` / `rrradio/Views/StationMapData.swift` —
  map clustering thresholds, country aggregation, pins, country list.
- `Shared/StationFeed.swift` — `BrowseFilter`, `BrowseSort`, playback-queue
  source matrix.
- `rrradio/Library/Feeds/BrowseFeed.swift` — feed wiring, `sorted(_:by:)`
  comparators.
- `rrradio/Search/StationFilters.swift` — `genres` taxonomy + `rbTag`,
  `availableCountries`, genre matching.
- `rrradio/Search/CatalogStationSearch.swift` — `matchesBrowseFilters`,
  `indexedStations` tier orchestration.
- `rrradio/Models/Catalog.swift` — `browseOrdered` / `orderForBrowse`
  (featured-first) and the load-order ladder.

## Known deviations

- **Community (Radio Browser) fetch errors fail silently** — the paginator's
  catch sets `hasMore = false`, so a network/server/rate-limit failure looks
  identical to "no more results"; no error UI or retry surfaces. See
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice17.md` (B6) and
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice11.md`.
- **HTTPS-coercion can collapse community dedupe to an ATS-blocked HTTP variant**
  — see `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice11.md` (M5).
- **`availableIn` fail-open on all-invalid input** silently makes a geo-gated
  Browse row universally available — see
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice11.md` (M2).
