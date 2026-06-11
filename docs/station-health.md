# Station health record

`public/station-health.json` is the single, committed, per-station quality
record for the catalog. Every automated check writes its verdict into this one
artifact through `tools/lib/health-record.mjs`; the station tracker's Health
tab and any future tooling read it from one place instead of stitching
together five scattered report files.

## Why it exists

Before this record (June 2026) check results were scattered:

| Result | Where it lived | Freshness reality |
|---|---|---|
| stream + metadata probes | `public/station-status.json` (analyze) | frozen 2026-05-04, 771 of 24k stations |
| stream verdicts (2nd impl) | `validate-catalog` stdout only | discarded after each run |
| RB drift | `public/station-drift.json` | manual runs only — no workflow ran it |
| duplicates | `public/station-duplicates.json` | per-commit CI |
| logo state | `public/station-logo-status.json` | manual runs only |
| homepage liveness | `.cache/homepage-status.json` (gitignored) | manual runs only, local-only |

Nothing recorded *when a verdict changed*, nothing exposed *how stale each
check was*, and the two stream probes (`validate-catalog.mjs`, `analyze.mjs`)
duplicated each other sequentially — at 24k stations the weekly catalog-watch
job ran 4–5.5 h and then failed for five straight weeks (first on probe
volume, then on a Node 22 / npm-11 lockfile mismatch).

## Schema (version 1)

```jsonc
{
  "version": 1,
  "runs": {
    // One entry per facet — when it last ran, with what scope and tool.
    // Staleness badges in the tracker come from here, NOT from per-station
    // timestamps (see "churn control" below).
    "stream": {
      "lastRun": "2026-06-15T07:12:03Z",
      "tool": "health-probe",
      "scope": "full",            // "full" | "cc:DE" | "partial"
      "checked": 24320,
      "tally": { "ok": 23100, "warn": 600, "bad": 620, "na": 0 }
    }
  },
  "stations": {
    "de-dlf": {
      "stream":    { "v": "ok",   "since": "2026-06-01", "d": "audio/mpeg" },
      "https":     { "v": "ok",   "since": "2026-06-01" },
      "icy":       { "v": "ok",   "since": "2026-06-01" },
      "metadata":  { "v": "ok",   "since": "2026-06-01" },
      "fetcher":   { "v": "ok",   "since": "2026-06-01", "d": "dlf" },
      "program":   { "v": "ok",   "since": "2026-06-01" },
      "logo":      { "v": "ok",   "since": "2026-06-01", "d": "local asset" },
      "homepage":  { "v": "bad",  "since": "2026-05-12", "d": "HTTP 404" },
      "drift":     { "v": "warn", "since": "2026-06-02", "d": "changeuuid-mismatch" },
      "duplicate": { "v": "ok",   "since": "2026-06-09" }
    }
  }
}
```

- **Verdicts** are always one of `ok | warn | bad | na`.
- **`since`** is the date the verdict (or detail) last *changed* — a
  transition timestamp, not a last-checked timestamp. "Last checked" lives in
  `runs.<facet>.lastRun`.
- **`d`** (detail) is a short, *stable* string. Writers must not store
  volatile values (e.g. the currently playing track title) — a detail that
  changes every run would defeat churn control.

### Facets and their owners

| Facet | Writer | Verdict semantics |
|---|---|---|
| `stream` | `tools/health-probe.mjs` | ok = 2xx + audio-like content-type · warn = unexpected content-type · bad = HTTP ≥ 400 / network failure |
| `https` | `health-probe` | ok = https stream URL · bad = http (mixed content) |
| `icy` | `health-probe` | ok = StreamTitle seen · warn = metaint advertised, no title in 64 KB · bad = none · na = HLS |
| `metadata` | `health-probe` | metadataUrl / built-in fetcher reachability (analyze.mjs semantics) |
| `fetcher` | `health-probe` | ok = known key · bad = unknown key · na = generic |
| `program` | `health-probe` | ok = program-capable fetcher · warn = fetcher without program info · na = no fetcher |
| `logo` | `tools/logo-status.mjs` | state from URL heuristics + real-pixel probe merge (logo-quality semantics) |
| `homepage` | `tools/check-homepages.mjs` | ok · warn = blocked (401/403/429) · bad = dead / server-error / network error · na = no homepage |
| `drift` | `tools/check-drift.mjs` | ok = changeuuid matches · warn = upstream changed / no baseline · bad = record gone upstream · na = not RB-bound |
| `duplicate` | `tools/check-duplicates.mjs` | ok = clean · warn = review-tier group · bad = blocking collision |

The probe deliberately does **not** write the `logo` facet — `logo-status`
owns it (it merges the real-pixel probe report and provenance fields that the
stream probe knows nothing about).

### Churn control (this file is committed)

The repo already suffers from large committed artifacts churning every build
(see the `git gc` note in CLAUDE.md). The health record is designed so the
weekly refresh produces a *small* diff:

1. Per-station rows change **only on verdict/detail transitions**. Re-probing
   24k stations that are all still `ok` touches zero station lines.
2. Run timestamps live only in the `runs` header (a handful of lines).
3. The file is serialised **one station per line**, sorted by id, so git
   diffs are per-station, not whole-file.
4. Partial runs (`--cc DE`, `--only`, resumed runs) merge — they never clear
   facets of stations outside their scope. Stations are pruned only when they
   leave the published catalog.

## The canonical probe: `tools/health-probe.mjs`

Replaces both `validate-catalog.mjs` and `analyze.mjs` (which probed the same
24k streams sequentially with two different verdict vocabularies).

```
npm run health                      # full sweep, concurrency 16
npm run health -- --cc DE           # one country
npm run health -- --only de-dlf     # specific stations
npm run health -- --limit 50        # smoke run
npm run health -- --strict          # exit 2 if any station is bad (CI)
npm run health -- --concurrency 24 --timeout 5000
```

- Reads `public/stations.json` (the merged artifact — RB-bound entries get
  their resolved streamUrl, fixing the audit-#68 class of false BROKEN).
- Probes stream + metadataUrl with a bounded worker pool (default 16).
  At ~24k stations and 8 s worst-case timeouts this bounds the full sweep to
  well under 2 h; the old sequential probes could not finish inside a CI job.
- Writes the `stream/https/icy/metadata/fetcher/program` facets into the
  health record.
- Still emits `public/station-status.json` for the admin dashboard, same
  per-station shape as analyze.mjs produced, but **problems-only** (stations
  with at least one `bad` facet, capped at 1000) plus a `totals` block — the
  dashboard grid was never going to render 24k rows.
- Prints a summary tally plus the bad stations, not 24k table rows.

`npm run validate-catalog` and `npm run analyze` remain as aliases for
`npm run health` so docs, muscle memory and old issues keep working.

## Bootstrap / import

`tools/health-import.mjs` seeds the record from whatever committed reports
already exist (`station-status.json`, `station-drift.json`,
`station-duplicates.json`, `station-logo-status.json`, plus the local
`.cache/homepage-status.json` if present), carrying over each source's own
`generatedAt` as that facet's `lastRun`. Honest staleness from day one: a
facet imported from a month-old report *shows* as a month old in the tracker.

## CI wiring

`catalog-watch.yml` (weekly, Monday 07:00 UTC):

- Node 24 (the Node 22 pin broke `npm ci` after the lockfile moved to npm 11
  — that was the five-weeks-of-20-second-failures bug).
- `health-probe --strict` replaces the separate validate + analyze steps;
  commits `public/station-health.json` + `public/station-status.json`.
- `check-drift` joins the weekly run (it previously ran in no workflow at
  all), writing the `drift` facet.
- `logo-status` joins the weekly run (network-free) so the `logo` facet and
  the tracker's logo matrix stay fresh without manual runs.
- duplicates / candidates / backlog / auto-curate steps unchanged.

`check-homepages` stays manual/curator-paced for now (18.5k URLs, real
network cost) — but when it runs, it now leaves its verdicts in the record
instead of only in a gitignored cache.

## Reading it

- **Station tracker → Health tab** (`/station-tracker.html`): per-facet
  freshness strip (fresh < 8 days, stale < 30, dead ≥ 30 / never), summary
  verdict counts, filterable per-station facet-pill table, worst-first sort.
- **Admin dashboard** keeps reading `station-status.json` (problems-only).
- Anything else (scripts, agents) should read `station-health.json` rather
  than re-deriving health from the individual report files.

## Invariants

- Only `tools/lib/health-record.mjs` writes the file. No other code touches
  it directly — that's what keeps the transition semantics and line-per-station
  serialisation consistent.
- A facet writer reports a verdict for every station *in its scope*, `na`
  included; it never deletes facets outside its scope.
- Details must be stable strings (no track titles, no timestamps, no counts
  that wobble per probe).
- Verdict vocabulary is closed: `ok | warn | bad | na`. New quality
  dimensions are new facets, not new verdicts.
