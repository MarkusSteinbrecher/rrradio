# ADR 002 — Catalog quality loop (measure → decide → act → report)

```yaml
status: proposed
date: 2026-09-03
supersedes: the weekly catalog-watch sweep as the health mechanism (docs/station-health.md "CI wiring")
```

## Context

Three rounds of "automate the catalog check" stalled for the same reason:
the probing worked, the plumbing failed.

- `catalog-watch.yml` failed 12 of its last 15 runs (Jun 22 → Aug 31 2026):
  rejected pushes to protected `main`, Radio Browser mirror 502s inside the
  `npm run catalog` step, then "stale info" push rejections on the reused
  PR branch.
- The one success (Aug 12) took 3 h — 1 h 57 m RB refresh (77 min of it
  favicon-variant regeneration), 64 min probe — and its output (2,775 bad
  streams) sits in an unmerged 135k-line PR (#668). `station-health.json`
  on `main` is dated 2026-06-15 on every facet.
- Nothing consumes the record: no tool turns `stream: bad` into an
  unpublished station. One station in the YAML has ever been `broken`.
- One fetch, one runner, one 8 s timeout. `timeout` is the top "bad"
  reason; the sponsor has caught the probe calling working stations broken.
- `--strict` fails the job on dead streams, so red means "internet rot"
  and "tooling broke" alike. The tracking issue is a 21 KB log dump.
- Play telemetry is concentrated: ~50 stations carry almost all plays.

## Decision

Replace the monolithic weekly sweep with four small, idempotent stages.
Health data leaves the source tree. The YAML stays the source of truth.

| Stage | Cadence | Writes |
|---|---|---|
| **Measure** — sharded probe, hot set daily + 1/7 of the long tail | daily | append-only observations on the `health-data` branch |
| **Decide** — deterministic policy with hysteresis (phase 2) | after measure | an actions list |
| **Act** — small `stations.yaml` status flips; auto-merge long tail, review curated tier (phase 2) | after decide | one PR, tens of lines |
| **Report** — digest issue + play-weighted metrics | weekly | issue body, tracker |

Bad stations are data, never a job failure. A red run means the tooling broke.

### Tiers

- **Curated tier**: status `working` or `icy-only`, `featured: true`, or
  referenced from `data/highlights.yaml`. Always probed daily. Never
  changed without review.
- **Long tail**: everything else (bulk `stream-only` imports). Rotates
  through 7 daily shards. Eligible for automatic unpublish/republish (phase 2).
- **Hot set** = curated tier ∪ every published station whose name matches
  a `play:` label in the stats Worker's top-stations (last 30 days). Probed daily.

### Failure classes

`stream` outcome `bad` is split for hysteresis:

| class | details |
|---|---|
| `hard` | `HTTP 404`, `HTTP 410`, `dns`, `refused`, `no-url` |
| `soft` | everything else that is bad: `timeout`, `HTTP 401/403/429`, `HTTP 5xx`, `reset`, `tls`, `network`, other 4xx |

A `soft` failure is retried once in the same run with double the timeout
(retries run after the first pass). `warn` (non-audio content-type) has no class.

## Contracts (phase 1)

Every tool below is a small Node ESM script under `tools/`, pure logic in
`tools/lib/*.mjs` with a co-located `*.test.mjs` (vitest picks up
`tools/**/*.test.mjs`). No network in tests.

### Observation row (NDJSON, one per probe)

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
| `d` | stable detail string — identical vocabulary to the health record's `d` |
| `icy` | `ok` \| `warn` \| `bad` \| `na` (stream rows only) |
| `r` | `true` when the row is the result of the soft-failure retry |

Rows are append-only. Keys are short on purpose: ~31k rows/week.

### `health-data` branch (orphan, bot-only, no protection)

```
README.md                      what this branch is, who writes it
observations/YYYY-MM-DD.ndjson one file per UTC day; runs append
station-health.json            derived record — existing schema v1, unchanged
streaks.json                   {"<id>": {"o":"bad","c":"soft","n":3,"first":"…","last":"…"}}
metrics.json                   latest metrics (below)
metrics-history.ndjson         one metrics row per derive run
plan.json                      the most recent probe plan
```

Observations older than 90 days are rolled up (deleted) by `derive-health`
after the streaks that depend on them are persisted.

The deploy job copies `station-health.json` from `origin/health-data` into
`dist/` so the tracker keeps reading `/station-health.json`. If the branch
does not exist yet, the committed copy is served (bootstrap).

### `tools/plan-probe.mjs`

```
plan-probe --out plan.json [--shards 6] [--day YYYY-MM-DD] [--offline] [--full]
```

Reads `public/stations.json`, `data/stations.yaml` (status, featured),
`data/highlights.yaml`, and `GET https://stats.rrradio.org/api/public/top-stations?days=30&limit=50`.
The Worker call failing is logged, not fatal (`--offline` skips it).
Rotation shard for a day: `fnv1a32(id) % 7 === daysSinceEpochUTC(day) % 7`.
`--full` targets every published station (manual full sweeps).

```jsonc
{ "day":"2026-09-04", "generatedAt":"…", "shards":6,
  "hot":["builtin-grrif", …], "plays":{"builtin-grrif":49, …},
  "rotation":{"slot":4,"of":7,"count":4457},
  "tiers":{"builtin-grrif":"curated", "de-xyz":"long-tail", …},
  "targets":[[…ids shard 0…],[…shard 1…], …] }
```

Targets are split round-robin after a stable sort so shards are balanced.

### `tools/health-probe.mjs` (extended, existing flags unchanged)

```
health-probe --plan plan.json --shard 0 --observations obs-0.ndjson --no-record
```

- `--plan` + `--shard i` select targets from the plan.
- `--observations <path>` appends one row per probed station.
- `--no-record` skips writing `public/station-health.json` and
  `public/station-status.json` (the merge job derives the record instead).
- Classification (`classifyStream`, `classifyIcy`, hard/soft `failureClass`)
  moves to `tools/lib/probe-classify.mjs` so it is testable and shared.
- `--strict` stays for local use; the workflow never passes it.

### `tools/derive-health.mjs`

```
derive-health --data health-data/ [--catalog public/stations.json] [--record public/station-health.json] [--now ISO]
```

- Reads every `observations/*.ndjson`. For each station and facet, the
  latest row is the verdict; applied through `applyFacet` (tool
  `derive-health`, scope `rolling`, `checked` = stations observed in the
  last 7 days). Existing `since` transition semantics are preserved.
- Writes `streaks.json`: consecutive run of identical `(o, c)` per station
  per facet, counting rows on distinct UTC days only.
- Writes `metrics.json` and appends to `metrics-history.ndjson`:

```jsonc
{ "at":"…", "published":31197, "observed7d":31197, "freshness":1.0,
  "plays7d":463, "playsObserved":460, "playsUnobserved":3, "playsOnOk":455, "availability":0.989,
  "stream":{"ok":…, "warn":…, "bad":…, "hard":…, "soft":…},
  "hotSet":{"size":212,"bad":3} }
```

`availability` = Σ plays of stations whose latest stream verdict is `ok` ÷ Σ plays
of stations that have *any* stream observation (plays come from `plan.json`).
A played station with no observation yet is unknown, not broken — it is
reported as `playsUnobserved` rather than dragging the ratio down. When no
played station has been observed the value is `null`, not 1.

- Prunes stations no longer in the catalog; deletes observation files
  older than 90 days.
- Reads/writes the record through `tools/lib/health-record.mjs` only.

### `tools/health-digest.mjs`

```
health-digest --data health-data/ --out body.md [--days 7]
```

Markdown, decision-shaped, in this order: the three metrics with
week-over-week deltas (from `metrics-history.ndjson`); **newly failing**
stations grouped curated / long-tail (hard streak ≥ 3 or soft streak ≥ 5,
first day inside the window); **recovered** (ok streak ≥ 2 after a bad
streak); **hot-set stations failing right now**; top failure details;
per-facet freshness. No raw logs. Exit 0 always.

### `.github/workflows/station-probe.yml`

```
plan  → probe (matrix over shards, 25 min timeout each, continue-on-error)
      → merge (always(): append observations, run logo-status /
               check-duplicates / check-drift non-fatally, derive-health,
               commit + push health-data with a rebase-retry)
      → digest (Mondays and on dispatch: upsert one issue labelled
                catalog-quality; close the legacy catalog-watch issue)
```

Daily 05:00 UTC + `workflow_dispatch` (inputs: `shards`, `full`).
Scheduled-run failures upsert a `workflow-failure` issue (existing pattern).
`catalog-watch.yml` loses its schedule and its probe/commit steps; it
becomes the manual RB refresh + auto-curate entry point.

## Phase 2 (not in this ADR's first implementation)

Policy tool over `streaks.json` → actions; Worker edge second opinion;
status-flip PR generator that filters `stations.json` instead of re-merging
RB; auto-merge for long tail (needs an App/PAT token: PRs from the default
`GITHUB_TOKEN` never receive checks); automatic republish after two `ok`
observations ≥ 3 days apart.

## Consequences

- `public/station-health.json` stops being refreshed on `main`; the deployed
  copy comes from `health-data`. The tracker is unchanged.
- Probe wall time drops from ~64 min (one runner) to ~10 min (six shards);
  the daily job has a hard 25 min per-shard budget.
- The RB refresh no longer sits in front of the probe; its failures are its own.
- Verdicts carry history (streaks), which is what makes automatic action
  defensible in phase 2.

## Contracts (phase 2 — decide + act)

Phase 1 is live (PR #679): daily observations on `health-data`, derived
record, digest. Phase 2 closes the loop. Same rules: small ESM tools,
pure logic in `tools/lib/*.mjs` with co-located tests, no network in tests.

### Station lifecycle fields (YAML only — never published)

A bot unpublish sets, on the station's block in `data/stations.yaml`:

```yaml
  status: broken
  brokenSince: 2026-09-06          # day of the action
  brokenFrom: stream-only          # status to restore on recovery
  brokenBy: station-probe          # marks the row as bot-managed
  brokenReason: "HTTP 404 ×3 · 2026-09-04→2026-09-06 · edge agrees"
```

A republish restores `status: <brokenFrom>` and removes the four
`broken*` fields. Rows without `brokenBy: station-probe` (curator-set
`broken`) are never touched by the bot.

### Snapshots — `health-data/unpublished/<id>.json`

The station's row from `public/stations.json` at unpublish time. 31,427 of
31,461 publishable rows are RB-bound, so a republish cannot rebuild the row
without Radio Browser; it re-inserts this snapshot instead. Deleted on
republish. Written and read only by `apply-actions`.

### Keep observing what we unpublished — `plan.json.extra`

`plan-probe` adds `"extra": [{ "id", "name", "streamUrl", "codec", "tier": "unpublished" }]`
for every YAML row with `brokenBy: station-probe` (streamUrl from the
snapshot when present, else YAML). They are probed daily. `health-probe`
resolves plan targets against the published catalog **∪** `plan.extra`.
`derive-health` no longer prunes ids that appear in `plan.extra`.

### Edge second opinion — Worker `GET /api/admin/probe?url=<https-url>`

Bearer `ADMIN_TOKEN` (same guard as the other admin GETs). Fetches the URL
with an 8 s `AbortSignal.timeout`, `Icy-MetaData: 1`, reads at most one
body chunk, cancels, and answers with the probe vocabulary:

```jsonc
{ "url": "…", "s": 200, "ct": "audio/mpeg", "o": "ok", "c": null, "d": "audio/mpeg", "ms": 412 }
```

`o/c/d` follow `tools/lib/probe-classify.mjs` exactly (status ≥ 400 → bad
`HTTP n`; fetch error → bad with `timeout | dns | refused | reset | tls | network`;
non-audio content-type → warn). Only `http(s)` URLs; anything else → 400.
Client: `tools/lib/edge-probe.mjs` `edgeProbe(url, { base, token, timeoutMs })`,
`base` default `https://stats.rrradio.org`, token from `STATS_ADMIN_TOKEN`.
Every edge answer is appended to today's observation file as a row with
`v: "edge"`, so the second opinion is history, not a side channel.

### `tools/decide-actions.mjs`

```
decide-actions --data health-data/ [--catalog public/stations.json] [--yaml data/stations.yaml]
               [--out actions.json] [--now ISO] [--no-edge] [--no-rb] [--max-edge 300] [--max-rb 100]
```

Pure core `decide({ streaks, tiers, yamlById, publishedIds, foldCanonicals, highlightIds, edge, metrics, now, caps })`
in `tools/lib/health-policy.mjs`. Rules, in this order:

| # | Condition | Long tail | Curated tier |
|---|---|---|---|
| 1 | **Circuit breaker**: `metrics.stream.bad ÷ (ok+warn+bad) > 0.15`, or candidates > 2 % of published | no auto actions this run; every candidate → `skipped: circuit-breaker` | same |
| 2 | stream streak `bad`, `hard`, `n ≥ 3` | `unpublish`, auto | `review` (proposed unpublish) |
| 3 | stream streak `bad`, `soft`, `n ≥ 5` | ask edge; edge `bad` → `unpublish` auto; edge `ok`/`warn` → `skipped: edge-disagrees`; no answer → `skipped: no-edge-opinion` | `review`, with the edge answer attached when available |
| 4 | row is a fold canonical (`dedup-report.json` group with folded members) | `skipped: fold-canonical` — no status flip can pass `check-catalog` while variants fold into the row; the digest names it, a curator re-points the fold first | same |
| 4b | row referenced by `highlights.yaml` | → `review` instead of auto (check-highlights) | — |
| 5 | `brokenBy: station-probe` and stream streak `ok`, `n ≥ 3` | `republish`, auto | `republish`, auto |
| 6 | any `unpublish`/`review` candidate that is RB-bound: RB `url_resolved` differs, is https, and probes `ok` via `lenientProbe` | `swap-url` auto (replaces the unpublish) | `swap-url` as `review` |
| 7 | cap: at most `caps.auto` (default 200) auto actions per run, worst-first (hard before soft, older `first` first) | overflow → `skipped: cap` | — |

Tier comes from `plan.json.tiers`; a bot-unpublished row has tier `unpublished`.
Edge questions are bounded (`--max-edge`, concurrency 4) and RB lookups
bounded (`--max-rb`), both non-fatal: a Worker or RB outage degrades to
`no-edge-opinion` / no swaps, never to a crash.

`actions.json`:

```jsonc
{ "generatedAt": "…", "day": "2026-09-06", "circuitBreaker": false,
  "actions": [
    { "id": "de-xyz", "action": "unpublish", "auto": true, "tier": "long-tail", "from": "stream-only",
      "streak": { "o": "bad", "c": "hard", "n": 3, "first": "2026-09-04", "last": "2026-09-06", "d": "HTTP 404" },
      "edge": null, "reason": "HTTP 404 ×3 · 2026-09-04→2026-09-06" },
    { "id": "…", "action": "republish", "auto": true, "tier": "unpublished", "to": "stream-only", "streak": {…}, "reason": "ok ×3 · …" },
    { "id": "…", "action": "swap-url", "auto": true, "tier": "long-tail", "newUrl": "https://…", "newCodec": "MP3", "streak": {…}, "reason": "…" },
    { "id": "…", "action": "review", "auto": false, "tier": "curated", "proposed": "unpublish", "streak": {…}, "edge": {…}, "reason": "…" }
  ],
  "skipped": [ { "id": "…", "why": "edge-disagrees" | "no-edge-opinion" | "fold-canonical" | "cap" | "circuit-breaker" } ] }
```

The file is also written to `health-data/actions/YYYY-MM-DD.json` (audit trail).

### `tools/apply-actions.mjs`

```
apply-actions --actions actions.json --data health-data/ --mode auto|review [--dry-run] [--summary-out body.md]
```

Pure core in `tools/lib/catalog-actions.mjs`. `--mode auto` applies
`auto: true` actions; `--mode review` applies `auto: false` ones (the PR is
the review surface, so the proposal is materialised as a diff). Per action:

- **unpublish**: YAML via `tools/lib/yaml-station-edit.mjs` (`setStationScalar`
  for `status` + the four `broken*` fields); `public/stations.json` via
  `catalog-json-patch.removeStation`; snapshot written.
- **republish**: YAML `status ← brokenFrom`, `broken*` removed (add
  `removeStationScalar(yamlText, id, field)` to `yaml-station-edit.mjs`);
  JSON row re-inserted from the snapshot right after the nearest preceding
  YAML neighbour present in the JSON (the JSON follows YAML order modulo the
  collapse); snapshot deleted.
- **swap-url**: YAML `streamUrl` (+ `codec` when known); JSON via `patchStationFields`.
- Re-stringify the JSON exactly as build-catalog does (`JSON.stringify(payload, null, 2) + '\n'`).
- `--summary-out`: a Markdown PR body — counts, then one line per action
  with id, name, reason; review PRs add "what to check" per proposal.
- Finishes by running `node tools/check-catalog.mjs` and exits non-zero if
  it fails (the PR must be green by construction).

### `.github/workflows/catalog-actions.yml`

Daily `0 6 * * *` (an hour after the probe) + `workflow_dispatch`
(`dry_run` boolean). One job, 30 min:

1. Mint a token with `actions/create-github-app-token@v2`
   (`app-id: ${{ secrets.RRRADIO_BOT_APP_ID }}`, `private-key: ${{ secrets.RRRADIO_BOT_PRIVATE_KEY }}`).
   PRs opened with it receive `pull_request` checks; the default
   `GITHUB_TOKEN` never does (#656).
2. Checkout `main` with that token; checkout `health-data` into `health-data/`; `npm ci`.
3. `decide-actions` (env `STATS_ADMIN_TOKEN`). Commit + push the audit file
   and the edge observation rows to `health-data` (same retry loop as
   station-probe).
4. `apply-actions --mode auto` → if the tree changed: branch
   `bot/catalog-actions-<YYYYMMDD>`, commit, push, `gh pr create` labelled
   `catalog-actions`, then `gh pr merge --auto --squash`. Required checks
   run; branch protection is not strict, so no update-branch dance.
5. `git checkout -f main`, `apply-actions --mode review` → if the tree
   changed and no PR labelled `catalog-review` is open: branch
   `bot/catalog-review-<YYYYMMDD>`, PR labelled `catalog-review`, **no**
   auto-merge, body from `--summary-out`.
6. `dry_run`: run 3 and both applies with `--dry-run`, open nothing, print
   the would-be PR bodies to the job summary.
7. `workflow-failure` upsert on scheduled failure, close on success
   (`GH_REPO` set — the pattern from station-probe's report job).

`health-digest` gains a section **Actions this week** (unpublished /
republished / swapped / awaiting review, from `health-data/actions/*.json`).
