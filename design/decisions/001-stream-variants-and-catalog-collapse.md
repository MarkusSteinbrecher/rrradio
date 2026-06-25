# ADR 001 — Stream variants + build-time catalog collapse

```yaml
status: accepted
date: 2026-06-20
supersedes: (the "one streamUrl, no variants" stance in catalog-schema.md)
```

## Context

Searching the catalog returned visible duplicates — e.g. two **FM4** rows. They
are not junk: they are the *same broadcast at two qualities* (`fm4-q2a` 192k and
`fm4-q1a` 128k). The root cause was structural, not a tuning miss:

- The dedup engine (`tools/dedupe-raw.mjs`) only deduped the raw Radio Browser
  pool, never the curated/imported YAML that ships. `build-catalog.mjs` had no
  collapse step.
- `check-duplicates.mjs` only *reported* (FM4 landed in a non-blocking tier).
- The runtime guard matched exact stream URLs, so bitrate variants slipped past.

The sponsor's framing: a low-bandwidth listener genuinely wants the 128k feed,
so the answer is **not** "delete the loser" — quality variants are a feature.
And, repeatedly stressed: a fix must **never hide a distinct station**.

## Decision

**1. Additive wire schema.** Keep `streamUrl` **required** (= the best/default
variant) and add an **optional** ordered `streams: StreamVariant[]`
(`{url, bitrate?, codec?, tier?}`, best→worst, `streams[0].url === streamUrl`,
emitted only when ≥ 2 variants). v1 clients and the bundled iOS snapshot ignore
it and keep playing `streamUrl`, so the duplicate disappears immediately with no
client change and no `schemaVersion` bump. Schema in
`docs/spec/contracts/catalog-schema.md`.

**2. Build-time collapse, conservative.** `tools/lib/catalog-dedupe.mjs` groups
the merged catalog rows by union-find and folds each group into one canonical
published station with a ranked `streams[]`. Grouping uses only **high-precision,
country-scoped structural signals**: exact normalized stream URL, and a stream
**fingerprint** (host+path with bitrate/codec/`q<N>a` tokens stripped, with the
channel-number guard so `Bayern 1` ≠ `Bayern 2`). Canonical selection is a total
deterministic comparator (status → has metadataUrl → local favicon → featured →
quality → lexical id).

**3. Curator overrides + audit.** `data/sources/catalog-dedupe-overrides.yaml`
(catalog-id keyed) provides `force-merge` (opt into a cluster the signals miss)
and `not-duplicate` (pin apart). Every group is written to
`public/dedup-report.json`. `check-catalog` and `check-duplicates` gate the
invariants (folded ids accounted for; every `streams[].url` HTTPS; no
same-station pair leaks into the published catalog).

**4. Listener selection is deferred to clients.** The catalog ships the
variants; a persisted best/data preference + per-station fallback is specified
in `playback-state-machine.md` but the web player/UI and iOS parity are Planned
(separate phases), so the schema can land and ship the dedup win on its own.

## Alternatives considered

- **Trust `dedupe.json` grouping as a signal.** Rejected: it tolerates noisy
  cross-country / shared-CDN merges (its scope is the 55k raw pool) — in testing
  it hid Radio Gong behind Spanish Kiss FM and fused Radio Minor's distinct
  genre channels. Precision matters more than recall for a *published* catalog.
- **Add a "same brand name + same homepage" signal.** Rejected as an *automatic*
  signal: it correctly merges format-feed clusters (GBH 89.7, SWR3) but also
  over-merges sub-channels that share a generic brand name (Radio Minor) — i.e.
  it can hide a real station. Demoted to an opt-in `force-merge`.
- **Delete the non-canonical row (no variants).** Rejected: throws away the
  data-saver feed the sponsor explicitly values.
- **Per-tier separate stations / runtime dedup.** Rejected: fragments one
  station into many rows / pushes catalog-shape work onto every client.

## Consequences

- The published catalog (`public/stations.json`) is the deduped artifact; FM4 is
  one row, ~265 rows fold into ~234 logical stations (conservative mode).
- Format-feed clusters that don't share a stream path stay as separate rows until
  a curator adds a `force-merge` — a deliberate, reviewable backlog in
  `dedup-report.json`, never silent hiding.
- The `streamFingerprint` change is in a **shared** normalizer, so `dedupe.json`
  was regenerated. Catalog artifacts re-churn `.git`; run `git gc` periodically.
- iOS parity (decode `streams[]`, variant selection) is a tracked follow-up in
  `rrradio-ios`; until then the bundled snapshot plays the best `streamUrl`.
