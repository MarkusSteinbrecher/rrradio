# Search and filter

> Verify station search (incl. whitespace-insensitive matching like "WDR5" → "WDR 5"), country filter, tag filter, and combinations. Simulator is fine for this flow. ~5 minutes.

## Preconditions

- [ ] Build under test: __________
- [ ] Test environment: simulator or real-device
- [ ] Catalog loaded; at least 100 stations in the list
- [ ] You know roughly what stations exist (skim the list once before starting)

## Steps

1. Tap the search field — expected: keyboard appears; field gains focus; placeholder "Search stations" or similar.
2. Type **"wdr"** — expected: list filters to include all WDR stations (WDR 2, WDR 3, WDR 4, WDR 5, 1Live, etc.). No empty state.
3. Replace search with **"wdr5"** (no space) — expected: WDR 5 appears in the list. Whitespace-insensitive matching is the load-bearing behaviour ([`SearchTests.swift`](../../../ios/rrradioTests/SearchTests.swift)).
4. Replace with **"BBC"** uppercase — expected: BBC stations appear. Case-insensitive.
5. Replace with **"radio swiss pop"** (multi-word) — expected: Radio Swiss Pop appears. Word-order-insensitive matching: "swiss radio pop" should also match.
6. Clear the search — expected: full list returns.
7. Open the **country filter** (chip / picker / dropdown) — expected: list of countries appears, sorted alphabetically.
8. Select **Austria** (or **AT**) — expected: list filters to Austrian stations (FM4, Ö1, Ö3, ORF Sounds, etc.).
9. Without clearing the country filter, select a **tag** (e.g. **alternative** or **news**) — expected: list narrows further to AT-stations matching that tag.
10. Clear filters — expected: full list restored; chips/badges show no active filter.
11. Apply an unusual combination ("country: DE" + tag "jazz") — expected: small set of stations or a graceful empty state with friendly copy. No crash.

## Acceptance

- [ ] Whitespace-insensitive search works: "wdr5" returns "WDR 5"
- [ ] Case-insensitive search works
- [ ] Multi-word search works regardless of word order
- [ ] Country filter narrows the list
- [ ] Tag filter narrows the list
- [ ] Combined country + tag filter narrows further
- [ ] Empty result has friendly copy, not a blank screen
- [ ] Clearing filters returns the full list

## Notes for the tester

- The search/filter logic is exercised by `ios/rrradioTests/SearchTests.swift` and `StationFiltersTests.swift` — if a result feels wrong, the unit test is the second source of truth.
- Country names vs codes: the picker shows full names, but the tags themselves are stored as ISO codes (`DE`, `AT`, `CH`). Either should work in search.
- Tag normalization: `News` and `news` should both match; `pop-music` and `pop music` ideally both match (catalog cleanup may not be fully consistent — surface mismatches as data bugs, not app bugs).
