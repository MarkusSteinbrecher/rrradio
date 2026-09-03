# Station health record

`station-health.json` is the single per-station quality record for the
catalog. Every automated check writes its verdict into this one artifact
through `tools/lib/health-record.mjs`; the station tracker's Health tab and
any future tooling read it from one place instead of stitching together five
scattered report files.

Since ADR 002 the *live* copy lives on the orphan `health-data` branch, not in
the source tree — see "Where the data lives" below. `public/station-health.json`
stays committed as the bootstrap copy and as the local working file.

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

### Churn control (this file is committed — daily, on `health-data`)

The repo already suffers from large committed artifacts churning every build
(see the `git gc` note in CLAUDE.md). Moving the record to `health-data`
takes that churn out of `main`, but the branch still accumulates a commit a
day, so the design still matters — the daily refresh produces a *small* diff:

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

In CI it runs from a plan instead of scanning the catalog itself:

```
npm run health -- --plan plan.json --shard 0 --observations obs-0.ndjson --no-record
```

- `--plan` + `--shard i` take the targets from the plan's shard `i`.
- `--observations <path>` appends one row per probed station.
- `--no-record` skips `public/station-health.json` and
  `public/station-status.json` — `derive-health` writes the record instead.
- `--strict` stays for local use; the workflow never passes it.

Classification (`classifyStream`, `classifyIcy`, hard/soft `failureClass`)
lives in `tools/lib/probe-classify.mjs` so it is testable and shared.

`npm run validate-catalog` and `npm run analyze` remain as aliases for
`npm run health` so docs, muscle memory and old issues keep working.

## The rest of the loop

### `tools/plan-probe.mjs` — who gets probed today

```
npm run plan-probe -- --out plan.json [--shards 6] [--day YYYY-MM-DD] [--offline] [--full]
```

Reads `public/stations.json`, `data/stations.yaml` (status, featured),
`data/highlights.yaml`, and the stats Worker's top-stations. The Worker call
failing is logged, not fatal (`--offline` skips it). Emits the day's `hot`
set, `plays`, `rotation`, per-station `tiers` and the balanced `targets`
arrays — one per shard.

Tiering, because probing 31k streams daily is neither necessary nor kind:

- **Curated tier** — status `working` or `icy-only`, `featured: true`, or
  referenced from `data/highlights.yaml`. Probed daily, never changed
  without review.
- **Long tail** — everything else (bulk `stream-only` imports). Rotates
  through 7 daily shards: `fnv1a32(id) % 7 === daysSinceEpochUTC(day) % 7`.
- **Hot set** — curated tier ∪ every published station with plays in the
  last 30 days. Probed daily. Play telemetry is concentrated: ~50 stations
  carry almost all plays, so this is small and worth being strict about.

`--full` targets every published station (manual full sweeps).

### `tools/derive-health.mjs` — observations → record

```
npm run derive-health -- --data health-data/ [--catalog public/stations.json] [--record public/station-health.json] [--now ISO]
```

Reads every `observations/*.ndjson`. Per station and facet the latest row is
the verdict, applied through `applyFacet` (tool `derive-health`, scope
`rolling`, `checked` = stations observed in the last 7 days), so the `since`
transition semantics are preserved. Also writes `streaks.json` (consecutive
run of identical `(o, c)`, counting distinct UTC days only), `metrics.json`
and `metrics-history.ndjson`. Prunes stations that left the catalog and
observation files older than 90 days.

`availability` in the metrics is play-weighted: Σ plays of stations whose
latest stream verdict is `ok` ÷ Σ plays. With no plays it is `null`, not 1.

### `tools/health-digest.mjs` — the weekly read

```
npm run health-digest -- --data health-data/ --out body.md [--days 7]
```

Decision-shaped markdown, in this order: the three metrics with
week-over-week deltas; **newly failing** stations grouped curated /
long-tail (hard streak ≥ 3 or soft streak ≥ 5, first day inside the window);
**recovered** (ok streak ≥ 2 after a bad streak); **hot-set stations failing
right now**; top failure details; per-facet freshness. No raw logs — the old
tracking issue was a 21 KB log dump nobody read. Exits 0 always.

## Bootstrap / import

`tools/health-import.mjs` seeds the record from whatever committed reports
already exist (`station-status.json`, `station-drift.json`,
`station-duplicates.json`, `station-logo-status.json`, plus the local
`.cache/homepage-status.json` if present), carrying over each source's own
`generatedAt` as that facet's `lastRun`. Honest staleness from day one: a
facet imported from a month-old report *shows* as a month old in the tracker.

## Observations: the append-only measurement log

The probe no longer writes verdicts directly. It appends one NDJSON row per
station probed, and the record is *derived* from those rows. History is what
makes an automatic status flip defensible: a station that has been `hard`-bad
for five consecutive days is a different thing from one that timed out once.

```jsonc
{"id":"de-dlf","at":"2026-09-04T05:12:03Z","v":"gha","f":"stream",
 "o":"bad","c":"soft","s":null,"ct":null,"ms":8004,"d":"timeout","icy":"na","r":true}
```

| key | meaning |
|---|---|
| `id` | station id |
| `at` | ISO-8601 UTC, second precision |
| `v` | vantage: `gha` (GitHub Actions runner). Reserved: `edge`, `client` |
| `f` | facet: `stream` (phase 1). Reserved: `logo` |
| `o` | outcome `ok` \| `warn` \| `bad` |
| `c` | class `hard` \| `soft` \| `null` (only set when `o` is `bad`) |
| `s` | HTTP status or `null` |
| `ct` | lower-cased content-type or `null` |
| `ms` | wall time of the (final) attempt |
| `d` | stable detail string — identical vocabulary to the record's `d` |
| `icy` | `ok` \| `warn` \| `bad` \| `na` (stream rows only) |
| `r` | `true` when the row is the result of the soft-failure retry |

Keys are short on purpose: ~31k rows a week. Rows are append-only — a run
never rewrites another run's rows.

### Failure classes

`timeout` was the top "bad" reason under the old single-fetch probe, and the
sponsor repeatedly caught it calling working stations broken. So a bad stream
verdict carries a class, and only the unambiguous ones count as hard:

| class | details |
|---|---|
| `hard` | `HTTP 404`, `HTTP 410`, `dns`, `refused`, `no-url` |
| `soft` | everything else that is bad: `timeout`, `HTTP 401/403/429`, `HTTP 5xx`, `reset`, `tls`, `network`, other 4xx |

A `soft` failure is retried once in the same run with double the timeout
(retries run after the first pass). `warn` (non-audio content-type) has no
class.

## Where the data lives

The record and its observations live on **`health-data`**, an orphan,
bot-only, unprotected branch:

```
README.md                       what this branch is, who writes it
observations/YYYY-MM-DD.ndjson  one file per UTC day; runs append
station-health.json             the derived record — schema v1, unchanged
streaks.json                    {"<id>": {"o":"bad","c":"soft","n":3,"first":"…","last":"…"}}
metrics.json                    latest metrics
metrics-history.ndjson          one metrics row per derive run
plan.json                       the most recent probe plan
unpublished/<id>.json           snapshot of a bot-unpublished station's published row
actions/YYYY-MM-DD.json         audit trail of every decide run (phase 2)
```

**Why not `main`.** The old weekly sweep committed ~17 MB of regenerated
report artifacts into a protected branch. A direct push is rejected with
GH006 before any check can run, so the sweep had to open a PR — and that PR
was a 135k-line generated diff nobody merged. The record froze at 2026-06-15
on every facet, and `propose-fixes` (which reads it to demote dead streams)
froze with it. Health data is high-churn machine output; it does not belong
behind a review gate that exists to protect hand-written code.

**How it reaches the app.** The `web` job in `deploy.yml` overlays it:

```
git fetch --depth 1 origin health-data
git show origin/health-data:station-health.json > dist/station-health.json
```

`actions/checkout` does a shallow single-ref checkout, so the explicit fetch
is required. The step is never fatal — before the branch exists, or if the
fetch fails, the committed `public/station-health.json` is served instead.
The tracker's URL is unchanged either way.

Observations older than 90 days are deleted by `derive-health` once the
streaks that depend on them are persisted.

## The loop closes: decide + act (phase 2)

Measurement alone changes nothing users see. Phase 2 turns the streaks into
catalog changes, once a day at 06:00 UTC (`catalog-actions.yml`), an hour
after the probe.

### Lifecycle fields (YAML only)

A bot unpublish rewrites the station's block in `data/stations.yaml`:

```yaml
  status: broken
  brokenSince: 2026-09-06          # day of the action
  brokenFrom: stream-only          # status restored on recovery
  brokenBy: station-probe          # marks the row as bot-managed
  brokenReason: "HTTP 404 ×3 · 2026-09-04→2026-09-06"
```

None of these reach `stations.json` (`broken` rows are not published). A
republish restores `status: <brokenFrom>` and removes the four fields. The
bot only ever touches rows carrying `brokenBy: station-probe` — a curator
who sets `status: broken` by hand, or removes `brokenBy`, owns that row.

### Snapshots

31,427 of 31,461 publishable rows are Radio Browser-bound, so a republish
cannot rebuild the row without RB. `apply-actions` therefore saves the
published JSON row to `health-data/unpublished/<id>.json` when it
unpublishes, and re-inserts exactly that row when it republishes. Bot-
unpublished stations stay in the daily plan (`plan.json.extra`) so recovery
is observed, not assumed.

### Policy (`tools/lib/health-policy.mjs`)

| # | Evidence | Long tail | Curated tier |
|---|---|---|---|
| 1 | **Circuit breaker**: bad share of today's stream verdicts > 15 %, or candidates > 2 % of published | no auto actions this run | same |
| 2 | `bad` · `hard` · ≥ 3 distinct days | unpublish, automatic | proposal for review |
| 3 | `bad` · `soft` · ≥ 5 distinct days | ask the Worker edge (`/api/admin/probe`); edge `bad` → unpublish; edge `ok` → skipped | proposal for review, edge answer attached |
| 4 | fold canonical (variants collapse into the row) | skipped and named in the digest — no status flip passes `check-catalog`; re-point the fold first | same |
| 4b | `highlights.yaml` entry | routed to review | — |
| 5 | `brokenBy: station-probe` and `ok` · ≥ 3 days | republish, automatic | republish, automatic |
| 6 | RB has a different https URL that probes `ok` | swap URL instead of unpublishing | proposal for review |
| 7 | cap: 200 automatic actions per run, worst first | overflow waits | — |

Curated tier = `working` / `icy-only` / `featured: true` / referenced from
`data/highlights.yaml`. Every edge answer is appended to the observation log
as a `v: "edge"` row, so second opinions are history too.

### Two PRs, two labels

- **`catalog-actions`** — long-tail actions. Opened by the `rrradio-bot`
  GitHub App (PRs from the default `GITHUB_TOKEN` never receive checks) and
  merged automatically once `web` / `worker` / `catalog` / `e2e` pass.
  `apply-actions` runs `check-catalog` before the PR exists, so it is green
  by construction.
- **`catalog-review`** — curated-tier proposals, materialised as a diff so
  the review is a normal PR review. Never auto-merged; not opened while one
  is already open. What to do with one: open the stream in the app, read the
  edge answer and the RB record in the body, then merge (accept), edit the
  YAML on the branch (e.g. a hand-found replacement URL), or close (keep as
  is — the proposal returns only if the evidence persists).

### Dry run and override

`gh workflow run catalog-actions.yml -f dry_run=true` decides and plans
without opening or pushing anything; both would-be PR bodies land in the
job summary. Locally: `npm run decide-actions -- --data <health-data checkout> --no-edge --no-rb`
then `npm run apply-actions -- --actions actions.json --data <dir> --mode auto --dry-run`.

## CI wiring

`station-probe.yml` — daily 05:00 UTC, plus `workflow_dispatch` with `shards`
and `full` inputs. Four jobs, `concurrency: station-probe` (serial, never
cancelled — the merge job appends to a branch):

| Job | Budget | What it does |
|---|---|---|
| `plan` | 10 min | `plan-probe --out plan.json --shards N [--full]`; uploads `plan.json`; emits the `[0…N-1]` matrix |
| `probe` | 25 min per shard | matrix, `fail-fast: false`, `continue-on-error`; `health-probe --plan plan.json --shard i --observations obs-i.ndjson --no-record --concurrency 24 --quiet`; uploads its rows with `if: always()` |
| `merge` | 20 min | `if: always()`; appends every `obs-*.ndjson` into `health-data/observations/<day>.ndjson`, runs `logo-status` / `check-duplicates` (and `check-drift` on Mondays) non-fatally, runs `derive-health`, commits + pushes `health-data` with a rebase-retry |
| `digest` | 15 min | Mondays and on dispatch: `health-digest --data health-data --out body.md`, upserts one issue labelled `catalog-quality`, closes the legacy `catalog-watch` issue |

Notes on the shape, because each part is load-bearing:

- **Bad stations are data, never a job failure.** The workflow never passes
  `--strict`. Only `plan` failing (couldn't decide what to probe) or `merge`
  failing (couldn't persist what we measured) means the tooling broke, and
  only that upserts the `workflow-failure` issue. `probe` is
  `continue-on-error` so a slow or crashed shard is not a red run — and its
  upload is `if: always()` so half a shard of rows still lands.
- **The merge job seeds `public/station-health.json` from `health-data`
  before running the cheap facet writers**, so `logo-status` and
  `check-duplicates` merge into the current record rather than writing one
  that holds only their own facet.
- **The merge job never commits to `main`'s tree.** It checks `main` out for
  the tooling and `health-data` into `health-data/`, and every write goes to
  the latter. On the very first run the branch doesn't exist yet, so the job
  bootstraps it as an orphan with a README.
- **Node comes from `.nvmrc`** in every job (the hardcoded Node 22 pin broke
  `npm ci` for five weeks after the lockfile moved to npm 11).

`catalog-watch.yml` is now "Catalog refresh (manual)": dispatch-only, RB
refresh + duplicates + candidates + backlog + auto-curate. It no longer
probes, checks drift, refreshes logo status, or commits any health artifact.

`check-homepages` stays manual/curator-paced for now (18.5k URLs, real
network cost) — but when it runs, it leaves its verdicts in the record
instead of only in a gitignored cache.

`catalog-actions.yml` (daily 06:00 UTC + dispatch with `dry_run`) is the
act half: App token → `decide-actions` → `apply-actions --mode auto` → PR
labelled `catalog-actions` with auto-merge → `apply-actions --mode review` →
PR labelled `catalog-review`. Snapshots and the actions audit trail go to
`health-data` in one commit at the end. Scheduled failures upsert the same
`workflow-failure` issue pattern.

## Reading it

- **Station tracker → Health tab** (`/station-tracker.html`): per-facet
  freshness strip (fresh < 8 days, stale < 30, dead ≥ 30 / never), summary
  verdict counts, filterable per-station facet-pill table, worst-first sort.
  It reads `/station-health.json` — which the deploy job overlays from
  `health-data`, so the tab is at most a day stale without the tracker
  knowing anything about the branch.
- **The weekly digest issue** (label `catalog-quality`): what changed and
  what is worth acting on, rather than the full record.
- **Admin dashboard** keeps reading `station-status.json` (problems-only).
- Anything else (scripts, agents) should read `station-health.json` rather
  than re-deriving health from the individual report files.

## Invariants

- Only `tools/lib/health-record.mjs` writes the file. No other code touches
  it directly — that's what keeps the transition semantics and line-per-station
  serialisation consistent. `derive-health` is no exception: it turns
  observation rows into facet verdicts and then goes through `applyFacet`
  like every other writer.
- Observation rows are append-only. A run adds rows; it never edits or
  deletes another run's (only the 90-day rollup deletes, and only whole
  files whose streaks are already persisted).
- A facet writer reports a verdict for every station *in its scope*, `na`
  included; it never deletes facets outside its scope.
- Details must be stable strings (no track titles, no timestamps, no counts
  that wobble per probe).
- Verdict vocabulary is closed: `ok | warn | bad | na`. New quality
  dimensions are new facets, not new verdicts.
