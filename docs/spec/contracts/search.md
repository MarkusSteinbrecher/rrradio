# Search Contract

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

Pins the **query normalization, tier precedence, ranking, and the Radio Browser
API shape** every platform must reproduce so a typed query yields the same
matches in the same order across web, iOS, and Android.

Who must honor it:

- Any surface that turns a free-text query into station results (Browse search,
  and any future search entry point).
- Any client that fetches the Radio Browser community catalog as a "more
  results" extension of a local search.

This contract owns the *search algebra*. It does NOT own:

- Browse filters/sort/empty-state UX → [browse](../features/browse.md).
- The `Station` schema, country-code normalization, ID prefixes →
  catalog-schema contract + `Shared/Station.swift`.
- Genre/tag taxonomy → `Search/StationFilters.swift` (`genres` list); filters
  are applied *after* a query matches and are out of scope here except where
  they gate a tier.
- Privacy: search query text is never sent to analytics — see
  [operations.md](../../operations.md) ("search" event: query content not sent).

## Definition

### Query normalization

Two normalizers, applied at different stages. Both are pure and locale-free.

**(A) `normalizeForSearch(s)` — character folding.** Used for the punctuation-
insensitive local match and the short-query gate.

```
normalizeForSearch(s) =
  s.lowercased()
   .filter { c in c.isLetter || c.isNumber || c ∈ {ä, ö, ü, ß} }
```

- Lowercase, then keep only Unicode letters, Unicode digits, and the four German
  diacritics `ä ö ü ß`. Drop everything else (whitespace, punctuation, symbols).
- So `"WDR5"` → `"wdr5"`, `"WDR 5"` → `"wdr5"`, `"ndr 90,3"` → `"ndr903"`,
  `"_80-Station"` → `"80station"`.
- This is the cross-platform contract mirror of the web's
  `normalizeForSearch` in `src/format.ts`. Implementations MUST match it
  character-for-character.

**(B) Tokenization (`searchTokens`) — letter/digit run splitting.** Used to build
the FTS5 `MATCH` expression and the compact-name ranking key.

- Walk the lowercased query; emit a token at every boundary between a
  *letter run* and a *digit run*, and at every non-alphanumeric character
  (which is dropped as a separator).
- `"wdr5"` → `["wdr", "5"]`. `"ndr 90,3"` → `["ndr", "90", "3"]`.
  `"jazz fm"` → `["jazz", "fm"]`.
- `compactSearchText(s)` = tokens joined with no separator = `"wdr5"`.

### Tier precedence (local → community)

A non-empty query resolves through tiers in this fixed order. Local tiers
produce the result list; the community tier is appended.

```
1. Bundled FTS5 index         (primary local match, ranked)
      ↓ index unavailable / diverged
1'. In-memory substring scan  (fallback for the entire local match)

2. FTS-miss substring safety net (only stations the index does not know)

3. Custom + Radio Browser local substring pass

4. Radio Browser community search (network, paginated, appended)
```

- **Tier 1 (FTS5):** the bundled `stations.fts5.db` SQLite index. Used whenever
  the index loaded AND its station-ID set diverges from the live catalog by
  ≤ 10% (`maximumDivergenceRatio = 0.10`). Produces ranked hits (see Ranking).
- **Tier 1′ (substring fallback):** when the index failed to open or query
  threw, OR divergence > 10%, the entire local match is a substring scan over
  `unique(catalog + custom + RadioBrowser)` using `stationMatches`. No FTS
  ranking; preserves input order. The divergence decision is **re-evaluated
  whenever the catalog's station-ID set changes** (async, off-main): if a later
  catalog state converges back under 10%, FTS is re-enabled and an active search
  re-runs through Tier 1.
- **Tier 2 (FTS-miss safety net):** with FTS active, a substring scan runs ONLY
  over catalog stations the FTS index did NOT return (`!ftsHitIDs.contains(id)`)
  — i.e. stations added to the live catalog since the bundled DB was built.
  Appended after the FTS hits.
- **Tier 3 (side pool):** custom stations + already-fetched Radio Browser
  stations are substring-matched and appended.
- **Tier 4 (Radio Browser community):** a network search against the public
  Radio Browser mirrors, paginated and merged in as the user scrolls
  ("load more"). Fires only while a query is active.

All tiers are unioned and **deduped by station `id`** (first occurrence wins),
then truncated to `limit` (local pipeline default `5000`).

### Country-code short-circuit (Tier 4 gate)

Radio Browser's name match is greedy; a 1–2 char query against a single country
returns thousands of irrelevant rows. So the **community tier is suppressed**
when:

```
country filter is active  AND  normalizeForSearch(trimmedQuery).count ≤ 2
```

In that case `canonicalQuery` returns `nil` and no network call fires. Local
tiers still run. (Note: this is a *result-quality gate keyed on query length and
a country filter*, NOT a "type a 2-letter ISO code to filter by country"
feature — that does not exist.)

### Loose-query splitting (Radio Browser only)

Before sending a query to Radio Browser, a single-token query (no internal
whitespace) is split at letter↔digit boundaries by inserting a space:

- `"wdr5"` → `"wdr 5"`, `"radio1"` → `"radio 1"`.
- A query that already contains whitespace is sent **as-is** (trimmed).
- An empty/whitespace-only query becomes `nil` (param omitted).

This is the network analogue of normalizer (B): it gives Radio Browser's
`name` matcher the same "WDR5 finds WDR 5" tolerance the local index has.

### Radio Browser API

| Item | Value |
|---|---|
| Protocol | HTTPS only (scheme hardcoded `https`) |
| Mirror hosts | `de1.api.radio-browser.info`, `at1.api.radio-browser.info`, `nl1.api.radio-browser.info` |
| Mirror order | last-successful host first, else seed order; failover advances on bad status or error |
| Search path | `/json/stations/search` |
| Stats path | `/json/stats` (→ `{ "stations": Int }`) |
| Region path | `/api/public/region` on the rrradio-stats Worker (`https://stats.rrradio.org`, NOT Radio Browser) — see operations.md |
| `User-Agent` | `rrradio-ios/<CFBundleShortVersionString>` (platform-specific UA string) |
| Page size | 60 (client default); the Browse paginator requests 50 |

**Search query params (every request):**

| Param | Value | Meaning |
|---|---|---|
| `limit` | page size | max rows this page |
| `offset` | page * size | pagination cursor |
| `order` | `votes` | rank by community vote count |
| `reverse` | `true` | highest votes first |
| `hidebroken` | `true` | exclude streams the upstream flags broken |
| `name` | loose-split query | omitted when query empty |
| `tag` | genre `rbTag` or `news` | omitted when no genre/news filter |
| `countrycode` | uppercased ISO alpha-2 | omitted when no country filter |

## Detail

### FTS5 `MATCH` expression

For tokens `t1 … tn`:

- `n == 1`: `"t1"*` (prefix match).
- `n > 1`: `"t1"* "t2"* … "tn"*  OR  "t1t2…tn"*` — each token as a prefix-AND,
  OR'd with the concatenation as a single prefix term (so `"jazz fm"` also
  matches a station literally named `jazzfm`).
- Empty token set → empty MATCH → zero hits (no error).

### FTS5 index schema (the bundled `stations.fts5.db` contract)

This contract is the **owner** of the bundled FTS5 index schema and the
divergence guard below; [catalog-schema](catalog-schema.md) ships the index as a
catalog-derived acceleration layer and points here for both rules.

| Object | Column | Meaning |
|---|---|---|
| `stations_fts` | `name` | station display name (weight 4.0) |
| `stations_fts` | `tags` | space-joined tags (weight 1.0) |
| `stations_fts` | `country` | ISO country code (weight 0.5) |
| `stations_fts` | `surface` | space-joined `broadcaster + streamURL + homepage` tokens (weight 0.25) |
| `stations_meta` | `station_id` | catalog `Station.id`, joined on `rowid` |
| `stations_meta` | `recents_rank_hint` | default ordering for unfiltered listing |

- The DB is refreshed from the web catalog build with
  `RRRADIO_IOS_FTS_DB=…/stations.fts5.db npm run catalog` (operations.md).
- Hydrating a `Station` from `surface`: split on spaces; the first `http(s)`
  token is the stream URL, the second is the homepage; any tokens before the
  first URL are the broadcaster. A row with no name or no stream URL is dropped.

### Ranking (Tier 1, FTS5)

Results are re-sorted in memory after the SQL `bm25` fetch. Sort key, ascending:

1. **Name-match tier** (`nameMatchTier`, lower is better), computed from
   `compactSearchText(name)` vs `compactSearchText(query)`:
   - `0` exact compact-name equality
   - `1` compact name has the query as a prefix
   - `2` compact name contains the query
   - `3` no compact-name match (FTS matched on tags/country/surface only)
2. **`bm25` score** ascending (SQLite bm25 is negative; lower = stronger).
   Column weights `bm25(stations_fts, 4.0, 1.0, 0.5, 0.25)` for
   name/tags/country/surface.
3. **`station_id`** case-insensitive ascending (stable tiebreak).

The SQL fetches `max(requestedLimit, min(500, requestedLimit + 50))` rows so the
in-memory tier-resort has headroom, then truncates to `requestedLimit`.

**When a query is active, the local relevance order is preserved** — the
alphabet / quality / favorites Browse sort is suppressed. Sort only applies to
the un-queried catalog browse.

### Radio Browser dedupe (Tier 4)

Within a single fetched page, results are deduped by a **normalized stream URL
key**:

- Key = `effectiveURL` with `scheme → https`, host lowercased, port stripped if
  80/443, trailing `/` removed. Unparseable URLs key on their trimmed-lowercased
  raw string.
- `effectiveURL` = `url_resolved` if non-empty, else `url`.
- On key collision the **higher-scoring** station wins; score =
  `hasRealLogo*1000 + hasTags*100 + clickcount`, where `hasRealLogo` is a
  favicon that is non-empty and does not end in `/favicon.ico`.
- First-seen key order is preserved (the winner replaces in place).
- Across pages, the paginator additionally drops any station whose `id`
  (`rb-<stationuuid>`) was already shown.

## Examples

### Normalization

| Input | `normalizeForSearch` | tokens | compact |
|---|---|---|---|
| `WDR5` | `wdr5` | `[wdr, 5]` | `wdr5` |
| `WDR 5` | `wdr5` | `[wdr, 5]` | `wdr5` |
| `ndr 90,3` | `ndr903` | `[ndr, 90, 3]` | `ndr903` |
| `_80-Station` | `80station` | `[80, station]` | `80station` |
| `Jazzradio Berlin` | `jazzradioberlin` | `[jazzradio, berlin]` | `jazzradioberlin` |

### FTS MATCH

- `"wdr5"` → tokens `[wdr, 5]` → `MATCH '"wdr"* "5"* OR "wdr5"*'`
- `"jazz"` → tokens `[jazz]` → `MATCH '"jazz"*'`

### Radio Browser request (query "jazz fm", Germany filter, page 0)

```
GET https://de1.api.radio-browser.info/json/stations/search
      ?limit=50&offset=0&order=votes&reverse=true&hidebroken=true
      &name=jazz%20fm&countrycode=DE
User-Agent: rrradio-ios/1.4.0
```

### Radio Browser response row (subset) → mapped `Station`

```json
{
  "stationuuid": "9617a958-0601-11e8-ae97-52543be04c81",
  "name": "Jazz FM",
  "url": "http://stream.example.com/jazz",
  "url_resolved": "https://stream.example.com/jazz",
  "homepage": "https://jazzfm.example.com",
  "favicon": "https://jazzfm.example.com/logo.png",
  "tags": "jazz,smooth jazz,lounge",
  "countrycode": "DE",
  "bitrate": 128,
  "codec": "MP3",
  "clickcount": 4210,
  "geo_lat": 52.52,
  "geo_long": 13.405
}
```

maps to:

```
Station(
  id: "rb-9617a958-0601-11e8-ae97-52543be04c81",
  name: "Jazz FM",
  streamUrl: https://stream.example.com/jazz,   // url_resolved preferred
  homepage: https://jazzfm.example.com,
  country: "DE",
  tags: ["jazz", "smooth jazz", "lounge"],       // split on ',', trimmed
  favicon: https://jazzfm.example.com/logo.png,
  bitrate: 128,
  codec: "MP3",                                   // uppercased
  listeners: 4210,                                // from clickcount
  geo: [52.52, 13.405]
)
```

Field mapping rules (these restate the `Station` decode rules — `rb-` id
prefix, country/codec uppercasing, `schemaVersion` ride-along — owned by
[catalog-schema](catalog-schema.md)):
- `id` = `"rb-" + stationuuid`.
- `name` trimmed; empty → `"Unknown"`.
- A row with no parseable `effectiveURL` (no scheme) is dropped entirely.
- `tags` splits on `,`, trims, drops empties; all-empty → nil.
- `bitrate`/`listeners` ≤ 0 → nil. `codec` empty → nil, else uppercased.
- `geo` only when both lat and long are present.

## Versioning & evolution

- **Normalizer (A) is a frozen cross-platform contract.** Changing the kept
  character set (e.g. adding accents for another language) is a coordinated
  change across web `src/format.ts`, iOS, and Android — diverging silently
  desyncs results.
- **FTS index is a build artifact**, regenerated per release from the same
  catalog the web build uses. The `name/tags/country/surface` columns and their
  bm25 weights are the schema contract; a client reading a DB with a different
  column set must fall back to substring search.
- **Divergence guard:** when the bundled index drifts > 10% from the live
  catalog (`maximumDivergenceRatio`), the client abandons FTS and uses substring
  search — so a stale bundle degrades gracefully instead of hiding new stations.
  The guard re-evaluates on every catalog station-ID change and can re-enable
  FTS if the catalog later converges back under the threshold; it is not a
  one-way latch for the session.
- **Radio Browser API is external and unversioned.** Treat unknown JSON fields
  as ignorable; only the fields in the mapping table are consumed. New mirrors
  or a different host list is a client-config change, not a contract break.
- `Station.schemaVersion` (default `1`) rides along on hydrated rows; bump only
  on an incompatible `Station` shape change.

## Failure & fallback

| Condition | Behavior |
|---|---|
| Empty / whitespace query | Search is a no-op; Browse shows the filtered catalog, RB paginator reset, no network call. |
| FTS DB missing at launch | `bundled()` returns nil; all queries use substring fallback (Tier 1′). Diagnostic `search/fts unavailable` recorded. |
| FTS query throws mid-session | Caught; that query falls back to substring over `unique(catalog+custom+RB)`. Diagnostic `search/fts failed`. |
| FTS index diverged > 10% | Client uses substring fallback; diagnostic `search/fts stale disabled` recorded. The guard re-evaluates on each catalog-ID change and re-enables FTS if drift falls back under 10%. A non-zero divergence still under the threshold keeps the index and logs `search/fts stale but usable`. |
| Empty FTS MATCH (no alnum tokens) | Zero FTS hits, no error; substring tiers still run. |
| Radio Browser mirror returns non-2xx or errors | Failover to next mirror after a jittered backoff (`75ms · 2^attempt + 0..75ms`, attempt clamped 0–4). |
| All Radio Browser mirrors fail | Search throws upstream; the paginator catches it and sets `hasMore = false`. **No error UI or retry surfaces** — see Known deviations. |
| Country filter + query ≤ 2 chars | Radio Browser tier suppressed (`canonicalQuery → nil`); local tiers still run. |
| Stale / superseded query | The local filter task is cancellable (polls every 512 stations); a newer keystroke/filter/sort cancels the in-flight scan. RB paginator drops results whose key ≠ current query/tag/country. |
| HTTP-only stream wins dedupe | Kept station may carry an `http://` URL that ATS blocks on iOS. See Known deviations (M5). |

## Platform obligations

| Obligation | Web | iOS | Android |
|---|---|---|---|
| Normalizer (A) char set: lowercase + letters + digits + `ä ö ü ß`, drop the rest | Reference (`src/format.ts`) | Match | Match |
| Tier order: local FTS/substring → FTS-miss net → custom+RB local → RB community | Must match result order | Reference | Must match |
| Dedupe whole pipeline by station `id`, first-occurrence wins | Required | Required | Required |
| Query-active suppresses alphabet/quality/favorite sort (relevance order kept) | Required | Reference | Required |
| Country-filter + ≤2-char-query → skip RB network call | Required | Reference | Required |
| RB request params (`order=votes`, `reverse=true`, `hidebroken=true`, loose-split `name`) | Required | Reference | Required |
| RB HTTPS-only; coerce `http_resolved`/`url` scheme for the dedupe key | Required | Reference | Required |
| RB dedupe by normalized stream URL; winner = `logo*1000+tags*100+clickcount` | Required | Reference | Required |
| Map RB row → `Station` per the field table (`rb-` id, MP3 uppercased, `≤0 → nil`) | Required | Reference | Required |
| Bundled/full-text index | Supported | Reference (`stations.fts5.db`) | Optional — may use in-memory substring if FTS too slow on device (browse.md) |
| Graceful fallback when index missing/diverged | Required | Reference | Required |
| FTS column weights name>tags>country>surface and name-tier→bm25→id ranking | If FTS used | Reference | If FTS used |

## Open questions

- **RB result quality vs. votes-only order.** Ordering is purely community
  `votes` desc with `hidebroken=true`; there is no per-result re-ranking against
  the user's query the way local FTS re-sorts by name tier. Whether RB results
  should be name-relevance-reordered before append is an undecided product call.
- **Loose-split only fires for single-token queries.** A multi-word query like
  `"radio 1"` is sent verbatim, so `"radio1"` and `"radio 1"` are normalized
  alike locally but diverge at the RB tier. Intended? Unconfirmed.
- **No query length cap / minimum.** Aside from the country-filter ≤2-char RB
  gate, there is no minimum query length or maximum query length enforced. A
  1-char query with no country filter still hits RB. Should there be a floor?
- **FTS index version field.** `stations.fts5.db` carries no embedded build
  version/timestamp the client can read; divergence is inferred only from the
  ID-set ratio. A version stamp would let the client log staleness precisely.

## Reference

- **Related contracts:** [catalog-schema](catalog-schema.md) (owns the `Station`
  schema and decode rules that the RB-row→Station mapping restates; ships the
  bundled FTS index whose schema + divergence guard this contract owns),
  [privacy-data-boundaries](privacy-data-boundaries.md) (owns the privacy matrix
  row for the Radio Browser query request shape).

iOS source (the only place iOS mechanics are named):

- `rrradio/Search/Search.swift` — `normalizeForSearch`, `stationMatches`,
  `stationSearchSurface`.
- `rrradio/Search/SearchIndex.swift` — FTS5 open/query, `matchQuery`,
  `searchTokens`, `nameMatchTier`, bm25 ranking, divergence validation,
  `stations.fts5.db` schema usage.
- `rrradio/Search/CatalogStationSearch.swift` — tier orchestration
  (`indexedStations`), FTS-miss safety net, dedupe by id, filter gating.
- `rrradio/Search/StationFilters.swift` — `genres` taxonomy + `rbTag` (used to
  derive the RB `tag` param), country helpers.
- `rrradio/Models/RadioBrowserClient.swift` — mirror failover, search params,
  `looseSearchQuery`, `RadioBrowserStation` decode/mapping, `dedupeByStreamUrl`,
  `normalizeStreamUrl`.
- `rrradio/Views/FeedPages/State/RadioBrowserPaginator.swift` — pagination,
  cancellation key, `canonicalQuery` country-code short-circuit.
- `rrradio/Views/FeedPages/BrowsePage.swift` — search debounce (180ms),
  query-active sort suppression, detached cancellable filter pipeline,
  `searchResultLimit = 5000`, `stationPageSize = 25`.
- `rrradio/Models/RegionResolver.swift` — `/api/public/region` visitor-country
  resolution (consumed by geo-restriction UX, adjacent to search).
- `rrradio/Resources/stations.fts5.db` — the bundled FTS5 artifact.

## Known deviations

- **Radio Browser fetch errors fail silently** — `RadioBrowserPaginator`'s
  `catch` sets `hasMore = false` and exits; the load-more row vanishes, so a
  network/server/rate-limit failure looks identical to "no more results." No
  error UI, no retry. See `internal/audit/2026-05-25-ios-code-review-slice17.md`
  (B6) and the upstream client note in
  `internal/audit/2026-05-25-ios-code-review-slice11.md`.
- **HTTPS-coercion can collapse dedupe to an ATS-blocked HTTP variant** —
  `normalizeStreamUrl` coerces `scheme=https` for the dedupe *key* but the kept
  station retains its original URL; an HTTP/HTTPS pair can collapse to the HTTP
  entry when it scores higher, which iOS ATS then refuses to play. See
  `internal/audit/2026-05-25-ios-code-review-slice11.md` (M5).
- **`availableIn` fail-open on all-invalid input** — a geo-restriction payload
  with no valid ISO codes normalizes to nil ("no restriction"), silently making
  a geo-gated station universally available. Adjacent to search via the
  result-visibility path. See
  `internal/audit/2026-05-25-ios-code-review-slice11.md` (M2).
- **Region endpoint sends the visitor IP to the rrradio-stats Worker** — the
  visitor-country resolver (and other telemetry) routes user IPs through the
  rrradio-stats Worker so Cloudflare's edge can echo `CF-IPCountry`; the IP-
  disclosure surface remains. At d241aa9 the Worker base is the production
  `https://stats.rrradio.org`, NOT the developer-personal
  `*.markussteinbrecher.workers.dev` subdomain the audit still describes — the
  host moved since the audit was filed. See
  `internal/audit/2026-05-25-ios-code-review-slice11.md` (M3/M4, now partly
  stale on the host) and the privacy-boundary summary in
  `internal/audit/2026-05-25-audit-handover.md`.
- No malformed-JSON *silent-fail* exists in the search path: `JSONDecoder`
  failures in `RadioBrowserClient.search` throw and propagate to the
  failover/paginator (which then hits the silent B6 gap above), rather than
  being swallowed as `[]`.
