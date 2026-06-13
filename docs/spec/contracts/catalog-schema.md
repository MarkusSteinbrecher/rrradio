# Catalog & Station Schema Contract

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

Pins the wire schema of the published station catalog and the load-order every
platform uses to render it. The catalog is the one piece of **public app data**
shared verbatim across web, iOS, and Android: a single JSON document published
at `https://rrradio.org/stations.json`, regenerated from `data/stations.yaml`
on every web deploy.

Every platform MUST:

- Decode the same envelope and the same per-station field set with the same
  optionality and the same defaults.
- Treat unknown fields as forward-compatible (ignore, never fail).
- Resolve catalog data through the same fallback ladder so a cold install,
  an offline launch, and a network refresh all render the same roster.

Catalog **generation, curation, and source provenance** are owned by
[`../../operations.md`](../../operations.md) ("Station catalog — workflow",
"Sources inventory") — this contract does not restate them. Broadcaster
metadata fetchers and the `station-capabilities.json` hint layer are owned by
[`features/metadata-artwork.md`](../features/metadata-artwork.md).

## Definition

### Envelope

`stations.json` is a single JSON object:

```
CatalogResponse := {
  "$schema":  string,        // JSON-Schema URL; advisory, IGNORED by clients
  "stations": Station[]      // the roster; REQUIRED
}
```

- The decoder reads exactly one key: `stations`. `$schema` and any other
  top-level key are ignored.
- `stations` is decoded **atomically**: the array decodes all-or-nothing. One
  station that violates a required-field rule (below) fails the whole decode.

### Station

A `Station` is a flat object (no nested `stream` sub-object — `streamUrl`,
`bitrate`, and `codec` are sibling fields). Decode rules:

- **Required, strict:** `id`, `streamUrl`. Missing/empty/malformed ⇒ decode
  throws.
- **Required, lossy:** `name`. Accepts string, or number coerced to string;
  missing ⇒ throws.
- **Everything else:** optional. Absent or null ⇒ the field's default. Adding a
  new optional field is forward-compatible by construction.

The catalog is the **curated tier** of stations. The same `Station` shape also
carries user-created and imported stations on a platform's local stores;
those use reserved id prefixes (`custom-`, `rb-`) that MUST stay namespaced
away from catalog ids (catalog ids are domain-derived slugs, e.g.
`builtin-grrif`, `bbc-radio-1`).

### Load-order (fallback ladder)

A platform resolves the catalog in this fixed order; the first source that
yields stations renders immediately, later sources upgrade it in place:

1. **Disk cache** — last successful network payload, persisted locally. Instant
   render, works offline.
2. **Bundled snapshot** — an app-shipped copy of `stations.json`, used only
   when the disk cache is empty (first install / cold cache).
3. **Network refresh** — `GET https://rrradio.org/stations.json`, always
   attempted. On success it overwrites cache + in-memory roster; on failure the
   already-rendered cache/bundled data stays.

A bundled **search index** (full-text, station-id keyed) is a parallel,
optional acceleration layer over whatever roster step 1–3 produced. Its schema
and the divergence guard that disables it when it drifts from the live roster
are owned by [search](search.md).

## Detail

### Envelope fields

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `$schema` | string | yes | JSON-Schema reference. Advisory only; clients MUST ignore it. | — (ignored) |
| `stations` | `Station[]` | **no** | The full published roster. | — (decode fails if absent) |

### Station fields

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `id` | string | **no** | Stable unique key. Catalog ids are domain-derived slugs. Reserved prefixes: `custom-` (user-created), `rb-` (Radio Browser import). | — (throws if absent) |
| `name` | string | **no** | Display name. Lossy-decoded: a numeric value coerces to its string form. Trimmed of surrounding whitespace. | — (throws if absent) |
| `shortName` | string | yes | Distinguishing short label within the station's brand family — the tail left after stripping the leading words it shares with same-broadcaster siblings (`Antenne Bayern - Chillout` → `Chillout`, `BBC Radio 4` → `4`). **Advisory**: a space-constrained UI (e.g. the iOS icon-grid caption) MAY substitute it when the full `name` would truncate; otherwise clients render `name`. Trimmed; empty ⇒ treated as absent. Derived at build time grouped by the family model's `country` + homepage host, or set explicitly in `data/stations.yaml` (override wins; `shortName: ""` opts out). Absent when the station stands alone, is its family's shared prefix, or the tail is only codec/bitrate noise or longer than a caption could show. | none |
| `streamUrl` | string (URL) | **no** | Audio stream endpoint. Must be a non-empty parseable URL. | — (throws if absent/empty/unparseable) |
| `schemaVersion` | int | yes | Schema generation of this record. Absent ⇒ treated as version `1` (the catalog and all pre-versioning records). Opt-in additive; not yet emitted by the catalog. | `1` |
| `broadcaster` | string | yes | Broadcaster/fetcher family key (e.g. `orf`, `grrif`). Stable cross-platform contract; consumed by the fetcher router in [metadata-fetchers](metadata-fetchers.md). | none |
| `homepage` | string (URL) | yes | Broadcaster website. Malformed ⇒ dropped to none. | none |
| `country` | string | yes | ISO 3166-1 alpha-2 country code. Normalized: trimmed, upper-cased; rejected unless exactly 2 A–Z letters (invalid ⇒ none). | none |
| `tags` | string[] | yes | Genre/descriptor tags. | none |
| `favicon` | string (URL) | yes | Station logo. Relative paths resolve against the catalog URL `https://rrradio.org/stations.json` using standard URL resolution, which drops the `stations.json` filename — so `stations/x.png` becomes `https://rrradio.org/stations/x.png`. Malformed ⇒ dropped to none. | none |
| `bitrate` | int | yes | Stream bitrate in kbps. Feeds the quality meter. | none |
| `codec` | string | yes | Stream codec (e.g. `AAC`, `MP3`, `FLAC`). Feeds the quality meter. | none |
| `listeners` | int | yes | Current listener count hint. | none |
| `metadataUrl` | string | yes | Per-station now-playing endpoint or fetcher-specific slug, when the broadcaster has one. Routing/use defined in [metadata-fetchers](metadata-fetchers.md). | none |
| `metadata` | string | yes | Key into the platform's metadata-fetcher registry (mirrors the broadcaster fetcher key); routing keyed off it in [metadata-fetchers](metadata-fetchers.md). | none |
| `status` | string enum | yes | Catalog taxonomy: `working` \| `icy-only` \| `stream-only` (see below). `icy-only` forces the generic ICY path in [metadata-fetchers](metadata-fetchers.md). | none |
| `geo` | number[2] | yes | `[lat, lon]` for map placement. | none |
| `featured` | bool | yes | Floats to the top of Browse ordering when `true`. | none (treated as `false`) |
| `availableIn` | string[] | yes | ISO 3166-1 alpha-2 codes where the stream is reachable. Each code normalized as `country`; deduped; an all-invalid list collapses to none. Absent/empty ⇒ no known restriction (the common case). When set, clients dim + badge the row "(Country) only" for out-of-region users and map upstream 401/403 to a geo-restricted message. The playback consequence (no retry, permanent geo error) is specified in [playback-state-machine](playback-state-machine.md). | none |
| `hasScheduleData` | bool | yes | Whether the station exposes current-broadcast / schedule info, gating calendar / show-card UI. Absent ⇒ `false`. Not yet emitted by the catalog. Forward path for schedule routing in [metadata-fetchers](metadata-fetchers.md). | `false` |

Catalog payloads MAY carry additional keys not in this table (observed:
`faviconLicense`, `faviconSource`, `faviconSourceUrl`; planned per
`operations.md`: a `favicons: {76, 128, 152}` pre-sized-variant object). These
are **not part of the decoded contract today** — clients ignore unknown keys.
See Open questions for the favicon-variants gap.

### `status` taxonomy

| Value | Meaning | Capability mapping (`station-capabilities.json`) |
|---|---|---|
| `working` | Full per-broadcaster metadata fetcher + curated logo. | `metadataStrategy: api`, `backgroundPollPriority: normal` |
| `icy-only` | Metadata only via ICY/HLS fallback; no structured fetcher. | `metadataStrategy: icy` (or `hls`), `backgroundPollPriority: low` |
| `stream-only` | Audio only; no usable metadata. Must NOT be background-probed. | `metadataStrategy: none`, `backgroundPollPriority: never` |

User-created stations are minted as `stream-only`. The promotion path
`stream-only → icy-only → working` is a curation workflow owned by
`operations.md` ("Per-station curation process").

### Stream quality model

There is **no `best`/`data`/`low` quality enum and no per-quality stream
variants** in the catalog. A station has exactly one `streamUrl`. Quality is a
**derived display meter**, computed from `codec` + `bitrate`, returning a level
`1–4` (rendered as filled bars):

| Condition | Level |
|---|---|
| `codec` ∈ {`flac`, `alac`, `wav`, `pcm`} | 4 (lossless) |
| no/zero `bitrate` | 1 |
| `aac`/`opus`: ≥128 / ≥96 / ≥64 / else | 4 / 3 / 2 / 1 |
| `mp3`/`mpeg`: ≥192 / ≥128 / ≥96 / else | 4 / 3 / 2 / 1 |
| other codec: ≥192 / ≥128 / ≥96 / else | 4 / 3 / 2 / 1 |

`codec` is matched case-insensitively after trimming. This meter is a
presentation derivative, not a wire field; platforms SHOULD compute it with the
same thresholds for parity.

The 1–4 level also collapses to a coarse three-way **quality bucket** that
drives the Browse quality filter (a multi-select of low / medium / high
classes):

| Meter level | Bucket |
|---|---|
| 1–2 | low |
| 3 | medium |
| 4 | high |

The filter UI is iOS-only today; the bucket boundaries are part of the same
derived model and SHOULD match wherever a platform exposes a quality filter.

## Examples

### Minimal valid station

```json
{ "id": "example-fm", "name": "Example FM", "streamUrl": "https://stream.example.org/live.aac" }
```

Decodes with `schemaVersion: 1`, `hasScheduleData: false`, all other fields
none.

### Real catalog station (from the bundled snapshot)

```json
{
  "id": "builtin-grrif",
  "name": "Grrif",
  "streamUrl": "https://grrif.ice.infomaniak.ch/grrif-128.aac",
  "broadcaster": "grrif",
  "homepage": "https://www.grrif.ch/",
  "country": "CH",
  "tags": ["rock", "indie", "alternative", "swiss"],
  "favicon": "stations/grrif.png",
  "faviconLicense": "broadcaster",
  "faviconSource": "broadcaster",
  "bitrate": 128,
  "codec": "AAC",
  "metadata": "grrif",
  "status": "working",
  "geo": [47.3656, 7.3434],
  "featured": true
}
```

Notes: `favicon` is relative and resolves against the catalog base URL.
`faviconLicense`/`faviconSource` are present on the wire but ignored by the
decode contract. Quality meter = 4 (AAC ≥128).

### Geo-restricted station

```json
{
  "id": "builtin-grrif",
  "streamUrl": "https://grrif.ice.infomaniak.ch/grrif-128.aac",
  "name": "Grrif",
  "availableIn": ["CH"]
}
```

Out-of-region users see a dimmed, "Switzerland only"-badged row; an upstream
401/403 on play maps to a geo-restricted message. See `operations.md`
("Geo-restricted stations") for the curation rule.

### Brand-family short name

```json
{
  "id": "antenne-bayern-chillout",
  "name": "Antenne Bayern - Chillout",
  "shortName": "Chillout",
  "streamUrl": "https://s1-webradio.antenne.de/chillout/stream/mp3",
  "homepage": "https://www.antenne.de/",
  "country": "DE"
}
```

`shortName` is the tail left after stripping the leading words this station
shares with its `antenne.de` siblings ("Antenne Bayern - 90er Hits", …). A
tight UI MAY render `Chillout` when the full `name` would truncate; everywhere
else `name` is shown. A standalone station, or a family's bare prefix (plain
"Antenne Bayern"), carries no `shortName`.

### Envelope

```json
{
  "$schema": "https://rrradio.org/schemas/stations.json",
  "stations": [ /* … tens of thousands of stations … */ ]
}
```

## Versioning & evolution

- **Forward-compatible by convention.** New fields MUST be optional with a
  safe default, decoded as "present-or-default". A v1 client seeing a v2 record
  ignores the unknown keys and keeps rendering.
- **`schemaVersion`** carries the record generation. It is **opt-in additive**:
  absent ⇒ `1`. The catalog does not emit it yet, so every shipped record
  decodes as `1` today. It is reserved to discriminate a future
  incompatible change (a renamed or newly-required field), where a
  version-tagged decoder branch handles older payloads instead of throwing.
- **Breaking changes are prohibited without a version bump.** Renaming a field,
  changing a field's meaning, or making an optional field required is a
  breaking change: it MUST bump `schemaVersion` and ship a decoder branch that
  still reads the prior shape. Removing a required field (`id`, `name`,
  `streamUrl`) is never allowed.
- **`$schema`** is advisory and may change freely; it is not a version gate.
- **Migration:** because the catalog is republished on every web deploy and
  clients refetch it (no App Store gate), additive evolution propagates to all
  installs on the next refresh. The bundled snapshot lags until an app release
  refreshes it, so transitional fields (e.g. `hasScheduleData`) MUST keep a
  decoder-side fallback until the catalog publish has reached every install.

## Failure & fallback

### Decode failures

| Input | Result |
|---|---|
| `stations` key absent | Whole decode throws; payload rejected. |
| Any one station missing/empty/unparseable `id`, `name`, or `streamUrl` | **Whole array decode throws** — the entire payload is rejected, not just the bad row. Clients fall back to the previous good source (cache → bundled). |
| Malformed `homepage`/`favicon` URL | That field silently drops to none; the station still decodes. |
| `country` not 2 A–Z letters | Drops to none. |
| `availableIn` all-invalid codes | Collapses to none ⇒ station treated as unrestricted. |
| Unknown top-level or station key | Ignored. |

### Source fallback

| Condition | Behavior |
|---|---|
| Network fetch succeeds (HTTP 2xx) | Replace roster + persist to disk cache. If the parsed roster equals the current one, skip re-render. |
| Network non-2xx / transport error, roster already rendered | Keep cache/bundled data; record the refresh error out-of-band; stay in a loaded state. |
| Network fails, nothing rendered yet | Surface a failed state (only when the screen is otherwise empty). |
| Disk cache empty (first install) | Use the bundled snapshot, then refresh from network. |
| Bundled snapshot missing/corrupt | Skip it; rely on network. |

### Stale / divergent search index

The bundled FTS index and its divergence guard (the `≤ 10%` station-id-set
divergence rule) are specified in [search](search.md) — this contract does not
restate them.

## Platform obligations

| Obligation | Web | iOS | Android |
|---|---|---|---|
| Decode the envelope reading only `stations`; ignore `$schema` and unknown keys | Supported | Supported | Supported |
| Enforce required (`id`, `name`, `streamUrl`) / optional field rules with the documented defaults | Partial — required-field rejection only, per-station skip (not atomic), drops several optional fields | Supported | Cache-backed catalog load; field-rule parity is porting work |
| Treat new optional fields as forward-compatible (never fail on unknown shape) | Supported | Supported | Supported |
| Honor the `status` taxonomy (`working`/`icy-only`/`stream-only`) and its capability mapping | Partial — reads the three values for row capability badges; no `station-capabilities.json` strategy/poll-priority mapping | Supported | Partial |
| Honor `availableIn` (dim/badge + geo-restricted error mapping) | Supported | Supported | Planned |
| `featured`-first Browse ordering | Not planned — Browse home orders by play-count then catalog order; `featured` is not decoded | Supported | Partial |
| Quality meter from `codec`+`bitrate` with the documented 1–4 thresholds | Not planned — renders `codec`+`bitrate` as a plain text label (e.g. "MP3 · 192 kbps"); no derived 1–4 meter or quality bucket | Supported | Partial |
| Load-order ladder: cache → bundled snapshot → network refresh | Browser/runtime cache | Disk cache + bundled `stations.json.lzfse` + network | Cache-backed load; bundled snapshot is porting work |
| Bundled full-text search index with divergence guard (rule in [search](search.md)) | Runtime | Bundled `stations.fts5.db` + divergence guard | Optional search index deferred |
| Reserve `custom-` / `rb-` id prefixes against catalog collisions | Partial — mints `custom-` for user stations; Radio Browser imports keep the bare `stationuuid` (no `rb-` prefix) | Supported | Supported |

The bundled snapshot and FTS index are platform-local accelerations, not part
of the wire contract — but every platform that ships them MUST keep them
refreshable from the same `stations.json` source and MUST never let a stale
local asset override fresher network data.

## Open questions

- **No published `schemaVersion` + atomic decode = silent data-loss risk.**
  The field exists in the decoder (defaulting to `1`) but the catalog does not
  emit it, and there is no version-switch decoder branch nor a CI guard that
  fails when the decoder's strict-throw set grows. A future PR that makes a new
  field required, or renames `streamUrl`, would make older/down-rev clients
  throw on the whole array and (via the local-store decode path) cascade to a
  silent wipe — the same per-record decode-failure → data-loss cascade
  documented in [sync-merge](sync-merge.md) §Known deviations C1.
  **Proposed rule for all platforms:** (1) always emit
  `schemaVersion` in published payloads; (2) decode per-station defensively so
  one bad record is skipped rather than failing the whole roster; (3) branch the
  decoder by `schemaVersion` and never add a strict field without a version
  bump + a regression test pinning the older shape. See Known deviations
  (Slice 11 M1).
- **Favicon variants are published but not in the decoded contract.**
  `operations.md` describes a `favicons: {76, 128, 152}` pre-sized-variant
  object in `stations.json`; the decode contract here ignores it (clients fall
  back to `favicon` + on-device downsampling). Whether `favicons` becomes a
  first-class contract field across platforms is an open product decision.
- **`metadata` vs `metadataUrl` overlap.** Both exist; `metadata` is a
  registry key and `metadataUrl` an endpoint/slug. Whether a single field can
  subsume both across platforms is unresolved.
- **`status` is an untyped string.** No platform validates it against the
  three known values; an unknown status decodes as an opaque string. Promoting
  it to a closed enum (with a defined "unknown ⇒ treat as stream-only"
  fallback) is an open decision.

## Reference

- **Related contracts:** [metadata-fetchers](metadata-fetchers.md) (routes off
  `metadata`/`metadataUrl`/`status`/`broadcaster`/`favicon`/`hasScheduleData`),
  [search](search.md) (owns the bundled FTS index + divergence guard; restates
  the RB-row→Station decode rules), [playback-state-machine](playback-state-machine.md)
  (consumes `availableIn` for geo-restriction), [sync-merge](sync-merge.md)
  (shares the per-record decode-failure → data-loss cascade).

iOS source read for this contract:

- `Shared/Station.swift` — `Station` struct, `CodingKeys`, `init(from:)`,
  `CatalogResponse`, `currentSchemaVersion`, id-prefix reservation,
  country-code normalization, lossy string / optional-URL decoders,
  `shortName` decode (trim-empty-to-absent) + `StationGridLabel` runtime strip
  (the fallback when `shortName` is absent; the catalog-side derivation in
  `tools/lib/station-short-name.mjs` is a verbatim port of it).
- `rrradio/Models/Catalog.swift` — `Catalog` loader, `CatalogResponse` decode,
  load-order ladder (cache → bundled `stations.json.lzfse` → network),
  `decompressLZFSE`, `orderForBrowse` (featured-first), search-index
  validation scheduling, canonical/base/cache URLs.
- `rrradio/Search/SearchIndex.swift` — bundled `stations.fts5.db` schema
  (`stations_fts`, `stations_meta`), `SearchIndexCatalogValidation`
  (10% divergence threshold).
- `rrradio/Views/StationKit.swift` — `stationHasProgramInfo` (the
  `hasScheduleData` gate + transitional fallback).
- `rrradio/Models/StreamQuality.swift` — `streamQualityLevel` /
  `streamQualityMeter` (the derived 1–4 quality meter) plus
  `StreamQualityBucket` / `streamQualityBucket(forLevel:)` (the coarse
  low/medium/high bucket that drives the Browse quality filter).
- `rrradio/Views/FeedPages/BrowseFiltersSheet.swift` — the Browse quality
  filter UI consuming `StreamQualityBucket`.
- Resources: `rrradio/Resources/stations.json.lzfse` (bundled snapshot, ~24,300
  stations at this commit), `rrradio/Resources/stations.fts5.db` (bundled FTS
  index).

## Known deviations

Shipped iOS code that diverges from the intent above is tracked in
`rrradio-ios/internal/audit/`:

- **Slice 11 M1** — `Station` has no published `schemaVersion` discriminator
  and decodes atomically; a future required-field change cascades through the
  CloudKit/UserDefaults decode paths (Slice 10 C1, Slice 9 L1) to a silent
  data wipe. The recommended `schemaVersion: Int = 1` field has since been
  added to the decoder, but the version-switch branch, per-record skip-on-error
  decode, and the CI guard remain open.
  (`internal/audit/2026-05-25-ios-code-review-slice11.md`)
- **Slice 11 M2** — `availableIn` normalization is fail-open: a corrupted
  geo-restriction payload (all-invalid codes) collapses to "no restriction"
  with no diagnostic, silently exposing a geo-gated stream in denied regions.
  (`internal/audit/2026-05-25-ios-code-review-slice11.md`)
- **Slice 11 L1** — `decodeLossyString` coerces String/Int/Double for `name`
  but not Bool, an asymmetry against the lossy-decode intent.
  (`internal/audit/2026-05-25-ios-code-review-slice11.md`)
- **Slice 11 L2** — `decodeOptionalURL` swallows a malformed `homepage`/
  `favicon` into none with no diagnostic identifying the offending station id
  or field. (`internal/audit/2026-05-25-ios-code-review-slice11.md`)
```
