# Search Specification

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

A single free-text field inside the Browse surface that lets a user find a
station by typing any fragment of its name, country, tag, broadcaster, or stream
URL. As the user types, results refine in place: strongest local catalog matches
first, then community streams from Radio Browser appended below as a "more
results" extension. Search is the fast path to "play that one station I have in
mind" without scrolling the full catalog.

This document owns the *interaction surface* — the field, typing feedback,
result list, fallback, clearing, and empty states. It does NOT own the search
*algebra* (normalization, tier precedence, ranking, Radio Browser API shape):
that is the [search contract](../contracts/search.md). It does NOT own the
surrounding catalog browse, filters, sort, count label, multi-select, or map:
those are [browse](browse.md).

## Entry points

- The search field is a permanent control in the Browse top row, between the
  logo and the filter button. There is no separate "search mode" or search tab.
- Reaching Browse (bottom-nav Browse tab, or any "go home" / logo tap that lands
  on Browse) exposes the field.
- The field is not auto-focused on arrival; the user taps it to begin typing.
- A query persists for the life of the Browse page; leaving and returning to the
  page resets it to empty.

## Layout

Top to bottom, the search-relevant elements of the Browse surface:

- **Search field** — a rounded capsule containing, left to right:
  - a magnifying-glass icon (passive),
  - the text input, placeholder `Search all stations...` when empty,
  - a clear (✕) button, shown only when the field is non-empty.
- **Filter button** (right of the field) and **count label** (in the sort row
  below) react to the active query but are owned by [browse](browse.md).
- **Result list** — the scrollable station rows below the top nav rule. While a
  query is active this is the search result set; while empty it is the filtered
  catalog browse. Each row shows the station name, country/tag context, logo when
  available, and play/favorite affordances (row anatomy owned by [browse](browse.md)).
- **Load-more spinner** — a full-width progress row at the tail of the result
  list; appearing on screen requests the next page (local window growth, then
  Radio Browser).
- **Empty-results view** — replaces the list when the query yields nothing
  (see States).

## States

| State | What shows | Actionable |
|---|---|---|
| Empty query (no search) | Filtered catalog browse; placeholder in field; no clear button. | All browse interactions; tapping field starts typing. |
| Typing (pre-debounce) | Field shows live text + clear button; result list still reflects the *previous* committed query for up to 180 ms. | Clear button; submit (commits immediately); continue typing. |
| Loading more (Radio Browser) | Existing local results plus a spinner row at the tail. | Scroll, play any visible row, clear, refine query. |
| Loaded (has results) | Result rows: local matches first, community results appended; count label reflects total. | Play, favorite, info-preview, multi-select add, scroll/page. |
| No results | `ContentUnavailableView` with magnifying-glass icon, title `No stations found`, description `Try a station name, country code, or tag.` | Clear button; edit query. No retry control. |
| FTS index unavailable / diverged | Indistinguishable to the user — results still render via substring fallback. | Same as loaded. |
| Radio Browser failure | Indistinguishable from "no more results": the spinner row disappears, no error UI. | Same as loaded. See Known deviations. |
| Offline | Local catalog + custom + cached Radio Browser results still match; no new community results load (spinner resolves to no-more). | Local interactions only. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap search field | Field not focused | Field gains focus; keyboard appears | Browse page-swipe gesture is suppressed while focused |
| Type a character | Field focused | Live text updates; clear button appears once non-empty | Schedules a debounced query commit (180 ms) |
| Stop typing ≥180 ms | Pending debounce | Query commits; result list recomputes; display window resets to first page; Radio Browser fetch (re)starts if query non-empty | Cancels prior debounce/filter tasks |
| Continue typing within 180 ms | Pending debounce | Prior debounce cancelled, restarted | No intermediate recompute |
| Press return / Search key | Field focused | Query commits immediately, bypassing debounce; keyboard dismisses | Cancels pending debounce |
| Tap clear (✕) | Field non-empty | Field text and committed query both clear; list returns to filtered catalog | Cancels debounce; Radio Browser paginator resets |
| Scroll the list | Keyboard up | Keyboard dismisses immediately on scroll | — |
| Load-more row appears | More local results buffered | Display window grows by one page (25 rows) | — |
| Load-more row appears | Local window exhausted, query active | Radio Browser paginator fetches the next page (50 rows) | Network call; results append, deduped by id |
| Tap a result row | — | Plays that station; queues the currently visible window | Catalog stations push to recents |
| Long-press a result row | Not in multi-select | Shows station info preview overlay | Released → preview dismisses |
| Change country/genre/news filter | — | Query result set re-filters; Radio Browser re-fetches with derived tag/country | Display window resets |
| Enter multi-select / receive list-selection request | — | Search is cleared, filters reset (browse-owned) | — |
| Leave Browse page | — | Debounce + filter tasks cancelled; Radio Browser paginator reset; info preview dismissed | Query lost on return |

## Business rules

- **Debounce: 180 ms** after the last keystroke before the query commits.
  Pressing return commits immediately.
- **Searchable surface** per station: name, tags, country code, broadcaster,
  stream host + full stream URL, homepage host + full homepage URL. Empty query
  matches everything (search is a no-op filter).
- **Whitespace/punctuation tolerance:** `WDR5` matches `WDR 5`; `ndr 90,3`
  matches `ndr 903`. The exact folding and tier precedence are the
  [search contract](../contracts/search.md).
- **Tier order (local → community):** bundled full-text index → in-memory
  substring fallback when the index is missing/diverged → substring net for
  catalog stations the index didn't know → custom + already-fetched Radio
  Browser → Radio Browser network search appended on load-more. Full pipeline
  deduped by station id (first occurrence wins). Contract owns the precise rules.
- **Query active suppresses sort:** while a non-empty query is committed, the
  alphabet / quality / favorites Browse sort is ignored so the relevance order
  shows through. Sort applies only to the un-queried catalog.
- **Local result cap: 5000.** The local pipeline truncates to 5000 matches so a
  broad query doesn't pull the entire catalog into memory.
- **Visible window paging: 25 rows.** The list renders only the first 25 results,
  growing by 25 each load-more hit before falling through to Radio Browser.
- **Radio Browser fires only while a query is active**, and is suppressed when a
  country filter is active and the query is ≤2 normalized characters (contract:
  country-code short-circuit). It is a "more results" extension, never ambient
  catalog enrichment.
- **Radio Browser page size: 50** (Browse paginator). Pagination stops when a
  page returns empty or a fetch fails.
- The **count label** reflects the merged local+community total already in the
  result set (Radio Browser hits are folded into the filtered list, not added on
  top). Owned by [browse](browse.md).

## Data dependencies

- [search contract](../contracts/search.md) — query normalization, tokenization,
  tier precedence, FTS5 ranking, Radio Browser API shape, dedupe, failure
  matrix. This feature implements that contract's UX.
- [catalog-schema](../contracts/catalog-schema.md) — the `Station` schema the
  searchable surface reads from and the bundled full-text index is derived from.
- [browse](browse.md) — the surrounding catalog/filter/sort/count/map surface and
  station-row anatomy this search field lives inside.

## Edge cases

- **No local match, has community match:** the list shows zero local rows but
  the load-more row pulls Radio Browser results, which then populate. A genuine
  "no results" state only renders when both local and fetched community sets are
  empty.
- **FTS index missing at launch:** every query silently uses the substring
  fallback; results still render. No user-visible difference. (Diagnostic logged.)
- **FTS query throws mid-session:** that query falls back to a substring scan over
  catalog + custom + Radio Browser. No user-visible error.
- **FTS index diverged >10% from the live catalog:** client abandons the index for
  the session and substring-searches, so newly added stations are still found.
- **Radio Browser mirror/network failure:** the paginator stops; the spinner row
  vanishes; this is indistinguishable from "no more results" — no error or retry
  UI surfaces (Known deviations).
- **Backgrounding / leaving Browse:** in-flight debounce, filter, and Radio
  Browser tasks are cancelled; paginator resets. Returning shows an empty field.
- **Rapid typing:** each keystroke restarts the 180 ms debounce; superseded local
  filter scans are cancellable (they poll cancellation while iterating) so they
  don't stack up; stale Radio Browser pages are dropped when the query key changes.
- **Huge result set:** capped at 5000 locally and rendered 25 at a time, so the
  list lays out a bounded number of rows regardless of query breadth.
- **Country filter + 1–2 char query:** local tiers still run; the Radio Browser
  call is skipped to avoid thousands of irrelevant community rows.
- **Whitespace-only query:** treated as empty — search is a no-op, no network call.

## Accessibility

- Search field: standard text-field semantics; placeholder `Search all stations...`
  announced when empty.
- Clear button: labeled `Clear search`; 44×44 hit target.
- Load-more spinner: labeled with the localized `Loading` string.
- No-results view: title `No stations found` and description
  `Try a station name, country code, or tag.` are read as the unavailable-content
  message.
- Result rows expose their own play/favorite/selection labels (owned by
  [browse](browse.md)).
- Field text uses a fixed 16 pt input and 14 pt icon; result rows honor Dynamic
  Type per the row component.
- Focus order: logo → search field → filter button → settings, then into the
  result list.

## Localization

This surface owns four strings:

| Key | English |
|---|---|
| `searchAll` | `Search all stations...` |
| `clearSearch` | `Clear search` |
| `noStationsFound` | `No stations found` |
| `trySearch` | `Try a station name, country code, or tag.` |

- No plurals or interpolated parameters in the search-owned strings.
- The result count label is a bare integer (browse-owned); no pluralization.
- Country names in result rows are localized via the OS region table
  (browse-owned). Query normalization itself is locale-free (contract).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Free-text search field in Browse | Supported | Reference | Supported |
| Debounced incremental results | Supported | Reference (180 ms) | Supported |
| Submit commits immediately (bypass debounce) | Supported | Reference | Supported |
| Whitespace/punctuation-tolerant matching (`WDR5`↔`WDR 5`) | Supported | Reference | Supported |
| Searchable surface: name + tags + country + broadcaster + URLs | Supported | Reference | Supported (name/tags/country baseline) |
| Bundled full-text index path | Supported | Reference (`stations.fts5.db`) | Optional — substring if FTS too slow on device |
| Graceful substring fallback when index missing/diverged | Required | Reference | Required |
| Query-active suppresses alphabet/quality/favorite sort | Required | Reference | Required |
| Radio Browser community results appended on load-more | Supported | Reference | Supported with cache-backed loading |
| Country-filter + ≤2-char-query suppresses RB call | Required | Reference | Required |
| Visible-window paging then RB pagination | Supported | Reference (25 then 50) | Supported |
| Clear button resets field + query + RB paginator | Supported | Reference | Supported |
| No-results unavailable view with guidance text | Supported | Reference | Supported |
| Radio Browser failure surfaces no error/retry | Matches | Reference | Matches |

## Open questions

- **No minimum query length** (outside the country-filter ≤2-char RB gate). A
  1-char query with no country filter still hits Radio Browser. Should there be a
  floor? (Mirrored from the [search contract](../contracts/search.md) open
  questions.)
- **No loading indicator distinct from "no more results."** A Radio Browser fetch
  failure and an exhausted result set look identical. A retry affordance is
  unspecified.
- **Field is never auto-focused on arrival.** Whether arriving via a deliberate
  "search" intent should focus the field is unconfirmed.
- **Community-result ordering is votes-only**, not re-ranked against the query the
  way local results are. Whether the appended block should be relevance-reordered
  is an undecided product call.

## Reference

iOS source (the only place iOS mechanics are named):

- `rrradio/Views/FeedPages/BrowsePage.swift` — the search field, 180 ms debounce,
  submit-commits-now, clear, query-active sort suppression, detached cancellable
  filter pipeline, `searchResultLimit = 5000`, `stationPageSize = 25`,
  load-more → Radio Browser handoff, no-results `ContentUnavailableView`.
- `rrradio/Search/Search.swift` — `normalizeForSearch`, `stationMatches`,
  `stationSearchSurface` (the searchable surface).
- `rrradio/Search/CatalogStationSearch.swift` — tier orchestration
  (`indexedStations`), FTS-miss safety net, filter gating, dedupe by id.
- `rrradio/Search/SearchIndex.swift` — bundled FTS5 open/query, ranking,
  divergence validation.
- `rrradio/Search/StationFilters.swift` — genre `rbTag` mapping used to derive
  the Radio Browser tag param, country helpers.
- `rrradio/Views/FeedPages/State/RadioBrowserPaginator.swift` — pagination,
  cancellation key, `canonicalQuery` country-code short-circuit, silent failure.
- `rrradio/Views/FeedPages/State/FeedPageState.swift` — `searchText` vs committed
  `query`, `displayLimit`, `searchFocused`.
- `rrradio/Views/LocaleController.swift` — the four owned string keys.

## Known deviations

- **Radio Browser fetch errors fail silently** — a network/server/rate-limit
  failure stops pagination with no error UI or retry, indistinguishable from
  "no more results." See
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice17.md` (B6) and
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice11.md`.
- **HTTPS-coercion can collapse Radio Browser dedupe to an ATS-blocked HTTP
  variant** — a kept community result may carry an `http://` URL iOS refuses to
  play. See `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice11.md` (M5).
