# Browse Specification

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

Browse is the catalog discovery surface: the place a user finds something to
play. It opens on a **discovery landing** (genre chips, country chips, a
"Browse all" rail, and an editorial "Featured" rail) and only drops into the
flat result list once the user searches, taps a chip, applies a filter, or
chooses "Browse all". The result list renders the shared catalog, folds live
community results into an active search, narrows by genre / country / news /
stream-quality, sorts the un-queried catalog, and supports building a station
list (or extending Favorites) from multiple picks. The search *field* mechanics
(normalization, tier precedence, Radio Browser API) live in
[search](search.md) and [features/search](search.md); this spec links to them
and does not re-derive them.

## Entry points

- The Browse tab in the bottom navigation (default landing page unless the user
  set another). Browse opens on its **discovery landing**, not the flat list.
- Tapping the inline rrradio logo on any tab routes to the Browse tab (logo as a
  "go home" affordance); on Browse itself it re-selects the tab and resets
  scroll.
- A "+" / "add stations" affordance elsewhere enters Browse in multi-select
  mode targeting a destination: a station-list detail page or the library home
  targets that **list** (see [station-lists](station-lists.md)); the Favorites
  page targets **Favorites** (picks are added to favorites, then routed back to
  the Favorites tab); "create new" from the library home seeds a draft name with
  no target list yet.
- Deep links / Shortcuts that open a station resolve through the catalog Browse
  consumes.

Browse reaches the **result list** from the discovery landing by: typing a
search, tapping a genre / country chip, tapping a section's "See all ›" then
applying a filter, or tapping the "Browse all" header. A back chevron (or a
rightward swipe) returns to discovery.

## Layout

Top to bottom:

1. **Top control row** (single combined row; collapses on scroll-down, expands
   on scroll-to-top — Browse has no separate brand row):
   - rrradio **logo button** (left) — go home / re-select Browse.
   - **Search field** (capsule) — magnifier icon, placeholder "Search all…",
     inline clear (✕) button when non-empty. Field behavior in
     [search](search.md).
   - **Filter button** — funnel icon; shows an accent dot when any filter is
     active.
   - **Settings button** — gear icon; opens the settings sheet.
2. **Second row** — depends on mode:
   - **Discovery landing:** no second row (just a small spacer); the sort /
     count / add-list controls "belong with results", so they are suppressed.
   - **Results:** the **sort row**, three columns — left: a **back-to-discovery
     chevron** (over the artwork column) then the **alphabet sort** control
     (aligned over the name column); center: the **result-count label**
     (numeric); right: a **"+" add-to-list** control opening the add-list popup.
   - **Multi-select:** the **selection bar** takes this slot (directly under the
     search field, accent-tinted) — step strip, cancel (✕), "Adding to <name>"
     label + selection-count badge, and a labeled "Add N" save button.
3. **Top nav rule** — hairline divider; the boundary above which chrome stays
   sharp when a popup blurs the content below.
4. **Content area** — one of:
   - **Discovery landing** (default, no query / filter / multi-select): a
     "Browse by genre" chip carousel, a "Browse by country" chip carousel, a
     "Browse all" header (catalog count) over a horizontal logo rail previewing
     the full list, then a hairline and an editorial "Featured" rail of
     highlight cards. Carousels scroll horizontally; the landing itself does not
     scroll the nav away when it fits.
   - **Result list/grid** of rows, each row showing logo (favicon), name,
     country/tag context, a favorite heart, and current/playing indicators (no
     stream-quality meter — see Row layout). An optional **filter-summary
     header** above the first row spells out the active genre/country/quality
     filter. Rows render `featured`-first then catalog order; an active query
     replaces this with relevance order. Wide layouts (iPad / iPhone landscape)
     lay rows out as a multi-column grid.
   - **Empty-state view** (search vs. catalog variants).
   - A trailing **load-more** spinner when more local pages or community results
     remain.
5. **Popup overlays** (transient, centered, over a blurred content backdrop):
   filter popup, add-list popup, and a press-and-hold station-info preview. The
   mini-player is hidden while the selection bar is up.
6. **Map view** (separate surface) — a sheet with a header, an interactive map,
   and a scrollable country list (see Map section). Defined but **not wired into
   Browse on iOS at d241aa9** (no entry point — see Open questions).

### Row layout (per station)

| Element | Shows |
|---|---|
| Favicon | Station logo, or a placeholder when absent. |
| Name | Display name (one line). |
| Context | Country / tag signal. |
| Favorite heart | Toggles favorite; hidden in multi-select. |
| Current/playing badge | Marks the current station and whether it is playing. |
| Geo-restriction badge | Stations whose curated `availableIn` excludes the visitor's region render dimmed and badged ([catalog-schema](../contracts/catalog-schema.md)). |
| Selection bubble | Replaces play/favorite affordances while multi-select is active; "already-in-list" rows render inert and out of the selection. |

The stream-quality meter is **not** shown on Browse rows — the row's only tap
target is "play this station"; the codec/bitrate detail stays reachable from the
press-and-hold station-info preview.

## States

| State | What shows | Actionable |
|---|---|---|
| **Loading (cold)** | Catalog resolves cache → bundled snapshot → network ([catalog-schema](../contracts/catalog-schema.md)); the first source renders immediately. | Discovery chips / rail populate as catalog counts land; rows are tappable as soon as any source renders. |
| **Discovery (no query, no filter, not multi-select)** | Genre + country chips (catalog match counts, "See all ›"), the "Browse all" header + logo rail, and the "Featured" rail. Chips/rails appear only when non-empty; the "Browse all" header is always present. | Tap a chip → filter into results; "See all ›" → open filter sheet on that section; "Browse all" → full unfiltered list; tap/play a highlight; search to leave discovery. |
| **Loaded (no query, no filter — "Browse all")** | Full catalog, `featured`-first, capped to the visible window (first 25 rows), load-more grows it. | Play, favorite, info-hold, sort, filter, multi-select, back-to-discovery. |
| **Loaded (filtered)** | Catalog narrowed by country/genre/news/quality; count reflects the filtered set; a filter-summary header spells out the active filter. | Same; filter dot lit; back chevron returns to discovery. |
| **Loaded (query active)** | Local matches (relevance order) then community results appended as the user pages; sort suppressed. | Play, favorite, info-hold, multi-select; load-more pages local then Radio Browser. |
| **Empty (query)** | "No stations found" + "try a different search" with a magnifier glyph. | Clear search to return to discovery (or the filtered list if a filter is still active). |
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
| Tap a genre chip | Discovery | Apply that single genre as the filter, drop into results | Leaves discovery; filter dot lit |
| Tap a country chip | Discovery | Apply that single country as the filter, drop into results | Leaves discovery; filter dot lit |
| Tap "See all ›" (genre/country header) | Discovery | Open filter popup with that section pre-expanded | — |
| Tap "Browse all" header / a logo on its rail | Discovery | Drop into the full, unfiltered list (no filter applied) | Leaves discovery; back chevron returns |
| Tap / play a highlight card | Discovery | Play that station | Pushes to recents if catalog; queues the current visible window for skip-next |
| Tap back chevron | Results (search/chip/filter, not multi-select) | Clear search + filter + browse-all, return to discovery | — |
| Swipe right over the result list | Results, back chevron shown | Same as back chevron (return to discovery) | Vertical scroll untouched; multi-select excluded |
| Type in search field | — | Debounced 180 ms, then query updates | Leaves discovery; resets visible window to 25; (re)issues community search; recomputes results off-main |
| Submit search (return) | — | Commit query immediately, bypassing debounce | Dismisses keyboard |
| Tap clear (✕) in field | Field non-empty | Clears text and query | Community paginator reset; discovery re-shows (if no filter) |
| Tap filter funnel | — | Open filter popup over blurred content | — |
| Tap outside filter popup | Popup open | Dismiss without applying | Draft discarded |
| Expand a filter section | Filter popup open | Reveal genres (news + genre rows), countries (search + rows), or quality (low/medium/high rows) | — |
| Toggle a genre / news / country / quality row | Filter popup open | Toggle membership in the draft; section badge + live match count update | — |
| Type in country search | Country section expanded | Filters country rows; selected countries pinned to top | — |
| Tap apply ("Show N stations") | Filter popup open, ≥1 match | Apply draft filter, close popup | Resets window; re-issues community search with first genre/country; recomputes |
| (Apply while 0 matches) | Draft matches nothing | Apply button disabled | — |
| Tap "Clear" | Draft non-empty | Reset draft to no filter (still must Apply) | — |
| Tap ✕ (cancel) in popup | Filter popup open | Close, discard draft | — |
| Tap alphabet sort | No active query | Cycle off → A→Z → Z→A → off | Resets window; recomputes order |
| (Sort while query active) | Query active | Sort suppressed; relevance order kept | — |
| Tap "+" add-to-list | Results | Open add-list popup (Create new / pick existing) | — |
| Pick "Create new" + name | Add-list popup | Enter multi-select, no target list, bar seeded with name | Mini-player hidden; count label hidden |
| Pick existing list | Add-list popup | Enter multi-select targeting that list, bar seeded with its name | Same |
| Enter from a list / "create new" / Favorites "+" | (external entry) | Enter multi-select; clears search/filter/sort; seeds target + name (Favorites seeds the page title) | Same |
| Tap a row (multi-select off) | Loaded | Play station | Pushes to recents if it is a catalog station; queues the visible window for skip-next |
| Tap a row (multi-select on) | Multi-select active | Toggle selection (tap order preserved); already-in-list rows inert | Selection count updates |
| Tap favorite heart | Multi-select off | Toggle favorite | Library mutation; sync per [data-sync](../data-sync.md) |
| Press-and-hold a row | Multi-select off | Show station-info preview overlay while held | Releasing dismisses it |
| Tap "Add N" (save) | ≥1 selected AND name non-empty | Favorites target → add picks to Favorites, route to Favorites tab; else append to target/name-matched list, else create a new one | Leaves multi-select; opens the destination in Library / Favorites |
| Tap ✕ (cancel) in selection bar | Multi-select active | Discard selection, leave multi-select | Mini-player returns |
| Scroll to load-more spinner | More local pages remain | Grow visible window by 25 | — |
| Scroll to load-more spinner | Local exhausted, query active | Fetch next community page (50 rows) | Network call per [search](search.md) |
| Pinch / pan map | Map open | Re-clusters: country pins when zoomed out, station pins under ~7° latitude span, logo pins under ~2.5° with ≤35 stations | Recomputes visible pins (cap 70) |
| Tap country pin / country row | Map open | Select that country, recenter map on it | Drives the bound `selectedCountry` |
| Tap "All countries" | Map open | Clear country selection, recenter to world | — |
| Tap a station pin | Map open (pins shown) | Open that station and dismiss the map | Plays / routes to the station |
| Backgrounding / tab switch away | — | Cancel debounce + filter + discovery-count tasks, reset community paginator, dismiss info preview | — |

## Business rules

- **Discovery gate:** the discovery landing shows only when the search is empty,
  no filter is active, the page is not mid-multi-select, and "Browse all" has not
  been tapped. Any of those drops into the result list. Genre/country chips and
  the Featured rail render only when non-empty; the "Browse all" header is always
  present so the full list is reachable without first applying a filter.
- **Discovery counts:** per-genre and per-country catalog match counts are
  computed off-main (the genre scan compiles a regex per station), recomputed on
  catalog revision; chips sort by count desc with a stable id/code tiebreak.
  Country chips cap at 20; highlight cards cap at 8; the "Browse all" logo rail
  caps at 30 stations carrying real artwork. Chip counts ≥ 1000 abbreviate
  ("1.4k", "17k").
- **Highlights:** the editorial "Featured" feed loads lazily from the highlights
  store; entries whose `stationId` isn't in the catalog are dropped, deduped by
  station; an all-unavailable feed hides the rail.
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
- **Filter matching:** within a dimension, membership is OR (any selected genre
  matches, any selected country matches, any selected quality class matches);
  across dimensions it is AND (a row must satisfy genre AND country AND news AND
  quality). News and genres compose; the news toggle is an additional AND
  predicate.
- **Quality classes:** the quality filter is multi-select Low / Medium / High
  buckets mapped from the station's derived `codec`+`bitrate` level (levels 1–2 =
  Low, 3 = Medium, 4 = High; unknown codec/bitrate scores level 1 → Low). Empty
  means quality is not filtered.
- **Filter → community mapping:** the first sorted selected genre's `rbTag`
  (else `news` when only the news toggle is on) and the first sorted selected
  country code are passed to the community search. The quality filter is local
  only — it is not forwarded to Radio Browser.
- **Filter apply gate:** the filter popup's apply button is labeled with the live
  match count ("Show N stations") and is disabled when the draft matches zero
  stations; the count is recomputed only when the draft changes (typing in the
  country search does not rescan).
- **Result count label** equals the merged local+community result count (the
  community hits are already merged into the result set, so they are not
  double-counted). Hidden while multi-select is active.
- **Multi-select save resolution:** a Favorites target adds the picks to
  Favorites and returns to the Favorites tab (no list name involved). Otherwise
  save targets the requested list if present; else a list whose name
  case-insensitively matches the typed name; else creates a new list. List saves
  require ≥1 station and a non-empty trimmed name. Selection is stored as full
  `Station` values (not just IDs) so picks made under an earlier query survive
  into the save even when no longer in the visible pool. Selection persists
  across page swipes within Browse. Rows already in the target list / Favorites
  render inert and stay out of the new-additions selection.
- **Filter sections:** genres = a news toggle plus the fixed `genres` taxonomy;
  countries = the catalog's available 2-letter country codes, device region
  pinned first, currently-selected pinned to top while searching; quality =
  Low / Medium / High classes.
- **Map clustering thresholds:** station pins appear when the visible latitude
  span < 7°; logo pins (favicon) when span < 2.5° and ≤35 visible stations;
  otherwise country-aggregate pins. Visible station pins capped at 70; map shows
  up to 100 country pins and the country list up to 80 rows. Country aggregation
  requires a valid `geo` and a 2-letter country; rows sort by station count
  desc, then country display name.
- **Filter-summary header:** when a filter is active, a header above the first
  row spells out the applied filter — genres (catalog display order), then News,
  then countries (localized, sorted), then the minimum stream-quality classes.
  The sort row keeps only the numeric count.
- **Back to discovery:** the back chevron / rightward swipe is available whenever
  results are on screen because of a search or filter, except in multi-select
  (the selection bar owns the exit there). It clears search + filter + the
  browse-all flag. The swipe reads as "back" past ~56 pt travel or a far-enough
  predicted fling, and only when predominantly horizontal-rightward.
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
- **Backgrounding / leaving Browse:** debounce + filter + discovery-count tasks
  cancel, the community paginator resets, and any info preview is dismissed.
- **Discovery counts cancellable:** the off-main genre/country count pass polls
  cancellation every 1024 stations; a catalog refresh supersedes the prior pass.
  Counts are skipped while a search is active (production first-appears empty).
- **Map not reachable from Browse (iOS):** the map surface compiles and works
  standalone but has no entry point wired into Browse at d241aa9, so its
  interactions below are dormant on iOS until a presenter is added (Open
  questions).
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
- Back-to-discovery chevron labeled "back to discovery".
- Discovery chips are single elements labeled "<name>, <n> stations"; section
  "See all ›" exposes its plain label; the "Browse all" row is a button labeled
  "browse all" with an "all stations" hint; the logo rail is hidden from
  VoiceOver (the header is the accessible route).
- Highlight cards are single buttons labeled badge + station + genres.
- Alphabet sort's label states the *next* action ("sort ascending" / "sort
  descending" / "clear alphabetic sort").
- Add-to-list "+" labeled "add to list"; selection-bar buttons labeled "cancel"
  and the live "Add N" save label; the filter-summary header reads "filters
  active" + the summary.
- Filter popup: cancel = "cancel", clear = "clear filters", apply = the live
  match-count label ("Show N stations"); selected picker rows expose the selected
  trait; quality meter graphics are hidden from VoiceOver.
- Load-more spinner labeled "loading".
- Map pins expose readable labels ("Open <station>", "<country>, <n> stations") —
  currently as literal English text, not localized (see Known deviations).
- Dynamic Type: row text and the filter picker rows scale; the picker label
  rows shrink minimally before truncating. Count label and badges use a
  monospaced numeric style.
- Focus order follows top control row → sort / selection row → result rows.

## Localization

Strings this surface owns (keys, not literals):

- Search: `searchAll` (placeholder), `clearSearch`.
- Sort: `sortAscending`, `sortDescending`, `clearAlphabeticSort`.
- Filters: `browseFiltersA11y`, `noFiltersActive`, `filtersActive`,
  `createFilter`, `clear`, `clearFilters`, `genre`, `country`, `news`,
  `searchCountries`, `rowQuality`, `qualityLow`, `qualityMedium`, `qualityHigh`,
  `showMatchingStations` / `showMatchingStationsOne`.
- Discovery: `browseByGenre`, `browseByCountry`, `seeAll`, `browseAll`,
  `allStations`, `featured`, `backToDiscovery`.
- Add-to-list / selection bar: `addToList`, `cancel`, `addingTo`, `addCount`,
  `selectStations`, `done`.
- Count: `stationsCount` (pluralized — `.one` / `.other` / locale variants).
- Empty states: `noStationsFound`, `trySearch`, `catalogEmpty`, `catalogNoRows`.
- Chrome: `browse`, `goHome`, `settings`, `loading`.
- Map: `map`; country names rendered via the OS locale's region display names;
  flag emoji derived from the code. (The map's "All countries", "Open
  <station>", and "<n> stations" labels are hardcoded English at d241aa9 even
  though `allCountries` exists — see Known deviations.)

Plural / parameter needs: `stationsCount`, the chip counts, and the country-row
counts are numeric and need locale-aware number formatting; `addCount` /
`showMatchingStations` take a count parameter; the result-count label and the
map's "<n> stations" are pluralizable.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Curated catalog | Supported. | Supported. | Supported. |
| Large Radio Browser-backed catalog | Supported. | Supported with bundled index/cache behavior. | Supported with cache-backed loading. |
| Discovery landing (genre/country chips + Featured rail + Browse all) | Not planned for current web. Web has no discovery landing — Browse shows the catalog directly under a filter row (genre/country dropdowns, played/news/curated toggles); the `featured` flag feeds a separate editorial rail, not a Browse discovery surface. | Supported. | Planned. |
| Search normalization | Supported. | Reference native behavior. | Supported. |
| Country filter | Supported. | Supported with native picker rows. | Supported. |
| Genre/tag filter | Supported. | Supported. | Supported. |
| News filter toggle | Supported. | Supported. | Supported. |
| Stream-quality (Low/Medium/High) filter | Not planned for current web. No quality-bucket filter exists; web filters are genre, country, and the news/curated toggles. | Supported (multi-select buckets). | Planned. |
| Filter apply gated on live match count | Not planned for current web. Web filters apply instantly via dropdowns/toggles — there is no filter popup or apply-with-count gate. | Supported. | Planned. |
| Searchable country picker with selected-pinned-to-top | Partial. Country selection is a plain native `<select>` populated from the catalog's codes (alphabetical); no in-picker search and no selected-pinned-to-top. | Supported. | Supported. |
| Back-to-discovery chevron + swipe | Not planned for current web. No discovery surface to return to; clearing the search/filter controls reverts to the catalog list. | Supported. | Planned. |
| Map browse | Supported with web map asset. | Surface built (MapKit) but no Browse entry point wired at d241aa9. | Planned with native map, provider TBD. |
| Add several stations to a station list | Not planned for current web. | Supported from Browse. | Supported. |
| Add several stations to Favorites | Not planned for current web. | Supported (Favorites "+" target). | Planned. |
| Multi-select selection bar (name + count + save) | Not planned for current web. | Supported (top, under the search field). | Supported. |
| Sort controls | Not planned for current web. Browse has no sort row; the catalog renders most-played-first then catalog order, with no user-facing sort control. | Reference native behavior. | Supported for name, quality, and favorite-state sorting. |
| Alphabet sort cycle (off/A–Z/Z–A) in the sort row | Not planned for current web. No sort row exists. | Reference native behavior. | Supported. |
| Quality / favorite-state sort | Not planned for current web. | In the sort model; not exposed by the Browse sort row's single control. | Supported. |
| Stream-quality meter on Browse rows | Not shown on web rows. Rows carry capability stars (stream/track/program) and a bitrate tooltip, not a Low/Medium/High meter. | Hidden in Browse (reachable from the info preview). | Per platform. |
| Featured-first catalog ordering | Not applied on Browse for web. The home list orders most-played-first then catalog order; `featured` drives only the separate editorial highlights rail, not Browse row order. | Supported. | Partial. |
| Result-count label | Supported. | Supported. | Supported. |
| Visible-window paging (load more) | Supported. | Supported (25-row pages). | Supported. |
| Community results appended to active search | Supported. | Supported (50-row pages). | Supported. |
| Sort suppressed while a query is active | Not applicable. Web exposes no sort control, so there is nothing to suppress. | Reference. | Required. |
| Station info preview | Basic row details. | Supported from station rows (press-and-hold). | Supported with long-press row preview. |
| Geo-restriction dim/badge on rows | Supported. | Supported. | Planned. |
| Wide-layout multi-column grid | Not planned for current web. The layout caps to a single-column ~480px phone-width frame on wider screens; rows never lay out as a multi-column grid. | Supported (iPad + iPhone landscape). | Planned. |

## Open questions

- The quality-high/low and favorite-first/last sorts exist in the iOS sort model
  and `BrowseFeed`, but the Browse sort row only surfaces the alphabet cycle.
  Whether those should get dedicated controls in the sort row (and whether all
  platforms expose the same sort set) is unresolved. The matrix records them as
  product-supported behaviors regardless of which control exposes them.
- The map view is built as a self-contained MapKit surface but has **no entry
  point wired into Browse on iOS at d241aa9** — no control opens it. Whether the
  map ships as a Browse affordance (and which control opens it) is an unresolved
  product decision; until then its interactions are dormant on iOS.
- Community-result re-ranking against the query (vs. votes-only order) is an
  open product call carried in [search](search.md).
- No enforced minimum/maximum query length aside from the country-filter
  ≤2-char community gate ([search](search.md)).

## Reference

iOS source (the only place iOS mechanics are named):

- `rrradio/Views/FeedPages/BrowsePage.swift` — the page: combined top row,
  search field (180 ms debounce), discovery gate + chip/count computation,
  sort suppression under query, off-main cancellable filter pipeline, 25-row
  visible window, 5000-row local cap, load-more, filter-summary header,
  back-to-discovery chevron/swipe, multi-select entry (list / create-new /
  Favorites), play/recents, quality-meter suppression on rows.
- `rrradio/Views/FeedPages/BrowseFiltersSheet.swift` — genre/news/country/quality
  filter popup, country search, selected-pinned ordering, live match-count apply
  gate, clear/cancel, quality meter graphics.
- `rrradio/Views/FeedPages/BrowseSortRow.swift` — back-to-discovery chevron,
  alphabet sort cycle, count label, add-to-list "+".
- `rrradio/Views/FeedPages/BrowseSelectionDock.swift` — top selection bar
  (cancel / "Adding to <name>" + count / "Add N") and save-enabled rule.
- `rrradio/Views/FeedPages/BrowseDiscoveryView.swift` — discovery surface: genre
  / country chips, "Browse all" header + logo rail, Featured highlights rail,
  count abbreviation (`BrowseDiscoveryFormat`).
- `rrradio/Views/FeedPages/State/BrowseSelectionState.swift` — selection model
  (full-Station storage, tap order, list / favorites target).
- `rrradio/Views/FeedPages/State/RadioBrowserPaginator.swift` — community
  pagination (50-row pages), `hasMore`, reset, short-query country short-circuit.
- `rrradio/Views/StationMapView.swift` / `rrradio/Views/StationMapData.swift` —
  map clustering thresholds, country aggregation, pins, country list. (Built but
  not presented from Browse at d241aa9.)
- `Shared/StationFeed.swift` — `BrowseFilter` (incl. `qualityBuckets`),
  `BrowseSort`, playback-queue source matrix.
- `rrradio/Models/StreamQuality.swift` — `StreamQualityBucket`,
  `streamQualityBucket(forLevel:)`, `streamQualityLevel`.
- `rrradio/Library/Feeds/BrowseFeed.swift` — feed wiring, `sorted(_:by:)`
  comparators.
- `rrradio/Search/StationFilters.swift` — `genres` taxonomy + `rbTag`,
  `availableCountries`, genre matching (text + `\bfunk\b` regex).
- `rrradio/Search/CatalogStationSearch.swift` — `matchesBrowseFilters`
  (OR-within / AND-across, quality), `indexedStations` tier orchestration.
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
- **Map labels are hardcoded English** — the map's "All countries", "Open
  <station>", and "<n> stations" strings bypass localization even though an
  `allCountries` key exists. The map is also a **dead surface** (no Browse entry
  point) at d241aa9 (slice 17 calls it out as such). Not yet captured in a
  dedicated audit entry; the intent is full localization + a real entry point
  (Open questions).
