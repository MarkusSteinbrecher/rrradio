# Broken-Station Reports Contract

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: —   # server-side first; no client ships this yet
```

## Purpose

Pins the cross-platform protocol for reporting a broken station and learning
what happened to the report. A user reports a station with a **category** and
optional **comment**, receives an anonymous **receipt id**, and is later
informed — via app polling — when the report is resolved. No account, no
reporter identity: the receipt token, held only by the reporting device, is
the entire relationship.

Who must honor it: every platform that ships the report sheet or receipt
polling, the `stats.rrradio.org` Worker (`worker/src/reports.ts`), and the
triage automation (issue-close Action, P2 prober/upserter). Defined by
[#507](https://github.com/MarkusSteinbrecher/rrradio/issues/507); the iOS
report-sheet UX lives in the companion `rrradio-ios` issue.

## Definition

### Report lifecycle (state machine)

```
received ──(probe fail | report threshold)──▶ confirmed
received ─────────(issue closed / admin)──────▶ resolved
confirmed ────────(issue closed / admin)──────▶ resolved
```

- `received → confirmed` is driven by the P2 triage cron (see Triage
  automation); `→ resolved` by the issue-close Action or a manual admin call.
- The P3 fix agent (see Fix automation) turns a confirmed `broken-station`
  issue into the catalog-fix PR whose merge closes the issue → resolution.
- `resolved` is terminal and carries exactly one `resolution`:
  `fixed | removed | not-reproducible`.
- Nothing un-resolves a report. A still-broken station is a *new* report.

### `POST /api/public/report-broken` (extended, backward-compatible)

Request body (JSON, ≤4096 bytes; pre-#507 fields unchanged):

- `stationId` (required), `stationName`, `streamHost`, `platform`,
  `appVersion`, `reason`, `source` — as before.
- `category` — one of `no-audio | interruptions | wrong-station | wrong-logo |
  wrong-info | other`. Absent or unrecognized → stored as `unspecified`, so
  old clients keep working unchanged.
- `comment` — optional plain text, ≤500 chars. Control characters (except
  newline) are stripped on ingest; rendering surfaces escape at the output
  edge. Never forwarded to analytics.

Response: `202` with `{ "ok": true, "reportId": "<token>" }`. The token is a
crypto-random UUID minted by the Worker. Clients built before receipts MUST
tolerate the extra field; clients built after MUST tolerate a missing
`reportId` (degraded mode — report recorded, no receipt).

### `GET /api/public/report-status?ids=a,b,c`

- `ids`: comma-separated receipt tokens, ≤50 per call; malformed ids are
  ignored.
- Response `200`: `{ "reports": [{ "id", "status", "resolution"?,
  "resolvedAt"? }] }` — `resolution`/`resolvedAt` only when resolved.
- Unknown ids are **omitted**; the client treats an omitted id as expired and
  drops the receipt locally.

### `POST /api/admin/resolve-reports` (Bearer `ADMIN_TOKEN`)

Body: `{ "resolution": "fixed|removed|not-reproducible" }` plus at least one
selector — `reportIds` (≤100), `stationId` (optionally scoped by `category`),
`githubIssue`. Selectors OR-combine; already-resolved rows are never touched.
Response: `{ "ok": true, "resolved": <n> }`.

### `POST /api/admin/triage-reports` (Bearer `ADMIN_TOKEN`)

Applies one station's automated-triage outcome. Body:
`{ "stationId", "confirmCategories"?: [...], "githubIssue"?: <int> }` — at least
one of `confirmCategories` / `githubIssue` required. `confirmCategories` flips
that station's matching `received` rows to `confirmed`; `githubIssue` stamps the
issue number on all the station's non-resolved rows. Idempotent (confirm only
touches `received`). Response: `{ "ok": true, "confirmed": <n>, "linked": <n> }`.

### Triage automation

- **Confirmation (P2 cron, daily — `.github/workflows/triage-reports.yml` →
  `tools/triage-reports.mjs`):** reads non-resolved reports, aggregates by
  `(station, category)`, and probes the catalog stream (`no-audio`,
  `interruptions`) or favicon (`wrong-logo`). A category is confirmed when the
  probe **fails** (stream unreachable / non-audio / favicon 404 or timeout) **or**
  the independent-report count reaches the threshold (default 3). Non-probe-able
  categories (`wrong-station`, `wrong-info`, `other`, `unspecified`) are
  threshold-only.
- **Issue upsert:** confirmed categories upsert **one** `broken-station` issue
  per station (matched by the body marker `<!-- rrradio:station-id=<id> -->`),
  labeled `broken-station` + each confirmed category, body carrying per-category
  counts, probe evidence, and reporter comments verbatim. User comment text is
  neutralized so it cannot forge the marker. The issue number is written back via
  `triage-reports`.
- **Resolution:** closing a `broken-station` issue triggers
  `.github/workflows/resolve-reports.yml`, which calls `resolve-reports`.
  Resolution = `resolved:fixed | resolved:removed | resolved:not-reproducible`
  label when present, else GitHub's close reason (completed → `fixed`,
  not planned → `not-reproducible`). The station id comes from the body marker.

### Fix automation (P3)

- **Fix agent (P3 cron, daily — `.github/workflows/propose-fixes.yml` →
  `tools/propose-station-fix.mjs`, an hour after the P2 cron):** reads the open
  `broken-station` issues (the confirmed work queue), parses the station-id
  marker + category labels, and turns each into a **catalog-fix PR**:
  - `no-audio` / `interruptions` → re-probe the stream; if dead, find a working
    **https** replacement (http→https upgrade, then Radio Browser by
    `stationuuid`, then exact name) and swap `streamUrl` (+ codec/bitrate); if
    none plays, propose `status: broken` (drops it from the published catalog).
  - `wrong-logo` → probe the favicon; if 404/error, clear it so the app falls
    back to a monogram.
  - `wrong-station` / `wrong-info` → when Radio Browser disagrees on the
    country, correct it.
- **Confidence gate:** anything it can't fix confidently — stream recovered,
  favicon still loads, ambiguous name/tags, free-form `other` — becomes a
  one-time research comment on the issue (marked `<!-- rrradio:fix-bot -->`)
  rather than a guessed PR.
- **Surgical patch:** both `data/stations.yaml` (source) and
  `public/stations.json` (the artifact deploys serve as-is, audit #65) are
  edited in place for a minimal diff — no full `npm run catalog` rebuild.
  `check-catalog` runs before each PR is pushed.
- **Control point + resolution:** the PR is normal (ready to merge), labeled
  `broken-station-fix`, its body carries `Closes #<issue>`, and it is deduped
  one-per-station by the `bot/broken-fix/<id>` branch. A human reviews and
  merges; merging closes the issue → `resolve-reports.yml` resolves the linked
  reports. P3 needs no Worker secret — it acts off the GitHub issues, not D1.

## Detail

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `category` | enum (6 values) | yes | user's classification of the breakage | `unspecified` |
| `comment` | string ≤500 | yes | user-authored free text, plain text only | `''` |
| `reportId` | UUID string | server-minted | anonymous receipt; sole link between device and report | — |
| `status` | `received \| confirmed \| resolved` | no | lifecycle state | `received` |
| `resolution` | `fixed \| removed \| not-reproducible` | only when resolved | what closed it | — |
| `resolvedAt` | ISO 8601 UTC | only when resolved | resolution timestamp | — |
| `github_issue` | int (server-side) | yes | linked triage issue | unset |
| Report threshold | int (server-side env) | no | independent reports to confirm a non-probe-failed category | 3 (`REPORT_THRESHOLD`) |
| Receipt store (client) | local list of `{ id, stationId, createdAt }` | yes | what the device polls with | empty |
| Ingest rate limit | 20 reports / IP / UTC day | no | enforced via daily-salted IP hash, purged next day | — |

## Examples

Request (new client):

```json
{
  "stationId": "builtin-fm4",
  "stationName": "FM4",
  "streamHost": "orffm4shoutcast.sf.apa.at",
  "platform": "ios",
  "appVersion": "1.2 (57)",
  "reason": "stream failed: HTTP 403",
  "source": "manual",
  "category": "no-audio",
  "comment": "Plays a second of audio, then silence."
}
```

Response: `{ "ok": true, "reportId": "7f0c2b9e-4a1d-4e7b-9c3a-2d8f5e6a1b0c" }`

Status poll `…/report-status?ids=7f0c2b9e-…,11111111-1111-4111-8111-111111111111`:

```json
{
  "reports": [
    {
      "id": "7f0c2b9e-4a1d-4e7b-9c3a-2d8f5e6a1b0c",
      "status": "resolved",
      "resolution": "fixed",
      "resolvedAt": "2026-06-14T09:12:33.000Z"
    }
  ]
}
```

(The second id is unknown → omitted → client expires that receipt.)

## Versioning & evolution

- `category` values are append-only; servers map unknown values to
  `unspecified`, so clients may ship new categories before the Worker knows
  them (they degrade to `unspecified`, never error).
- `status`/`resolution` values are append-only; clients MUST render unknown
  values as a neutral "in review" state rather than failing.
- Receipt ids carry no version; treat them as opaque tokens.
- P2 adds server-side transitions to `confirmed` (stream/favicon prober) and
  the issue upsert — no client-visible protocol change.

## Failure & fallback

| Condition | Behavior |
|---|---|
| POST non-2xx / network failure | Same as today: client surfaces failure once; iOS offers the `mailto:feedback@rrradio.org` fallback. |
| 429 (rate limited) | Client shows the generic failure path; no retry-storm. |
| D1 down, analytics up | `202 { ok: true }` without `reportId` — report counted, no receipt. Client skips storing a receipt. |
| D1 and analytics both down | `502`; client failure path. |
| Status poll fails / non-200 | Keep receipts, retry next poll window. Never block UI on the poll. |
| Receipt unknown (omitted from response) | Treat as expired; drop the receipt silently. |
| Issue closed without station marker or linked rows | Action still calls the endpoint; `resolved: 0` — harmless. |

## Platform obligations

**All platforms**

- Send `category` from an explicit user choice; never auto-classify.
- The comment field is optional, plainly labeled as going to the maintainer,
  and capped at 500 chars client-side.
- Store receipts locally only ([privacy contract](privacy-data-boundaries.md)
  rows 4 and 15); never attach them to any other request.
- Poll opportunistically (app foreground / stats-sheet open), not on a timer;
  batch all outstanding ids into one call.
- On `resolved`, inform the user once (e.g. badge/toast "Your FM4 report:
  fixed"), then drop the receipt.

**Web** — same endpoint; receipts in `localStorage`. Currently sends the
pre-#507 payload (no category sheet yet); that remains valid.

**iOS** — report sheet + receipts + polling specced in the companion
`rrradio-ios` issue; `Diagnostics.swift`'s `BrokenStationReporter` is the
integration point.

**Android** — same protocol when the port lands; nothing platform-specific.

## Open questions

1. Retention: when (if ever) are resolved/stale `broken_reports` rows purged?
   Receipts of deleted rows read as expired, so purging is client-safe — pick
   a window (e.g. 180d) in a follow-up.
2. Should `confirmed` be user-visible ("we reproduced it") or collapsed into
   "in review" until resolution? Spec currently allows either rendering.
3. The prober stops at stream connect + content-type (the fast, decisive
   signal); it does not yet read several seconds of audio bytes. Intermittent
   `interruptions` therefore confirm mostly by threshold. Revisit if byte-level
   probing proves necessary.

## Reference

- Worker: `worker/src/reports.ts`, schema `worker/migrations/0001_broken_reports.sql`,
  routes wired in `worker/src/index.ts`, tests `worker/src/reports.test.ts`.
- Triage cron (P2): `tools/triage-reports.mjs` (+ `tools/triage-reports.test.mjs`),
  `.github/workflows/triage-reports.yml`; reuses `tools/playable-check.mjs`'s
  `lenientProbe` for the stream probe.
- Fix agent (P3): `tools/propose-station-fix.mjs` (+ `tools/propose-station-fix.test.mjs`),
  `.github/workflows/propose-fixes.yml`; surgical-edit helpers
  `tools/lib/yaml-station-edit.mjs` + `tools/lib/catalog-json-patch.mjs`
  (each with a `.test.mjs`); reuses `lenientProbe`, `tools/rb-client.mjs`, and
  `tools/triage-reports.mjs`'s shared probe helpers.
- Resolution Action: `.github/workflows/resolve-reports.yml`.
- Privacy rows: [privacy-data-boundaries.md](privacy-data-boundaries.md) rows 4, 15.
- Pipeline definition: [#507](https://github.com/MarkusSteinbrecher/rrradio/issues/507).

## Known deviations

- No client implements categories/receipts/polling yet, so the user-facing half
  of the loop (the report sheet, the "resolved" notification) is unverified
  end-to-end. Server pipeline (ingest → confirm → issue → resolve) is live.
- **P3 metadata fixes are narrow:** only a `country` disagreement with Radio
  Browser is auto-corrected. Name/tags corrections, and re-sourcing a *new*
  logo (vs. clearing a dead one), are left to a research comment + the
  `curate-stations`/`curate-logos` skills — they lack a confident automated
  signal. `wrong-station`/`wrong-info` that manifest as a dead stream are fixed
  via the stream path.
- **P3 patches the artifact surgically, not by rebuild:** a `name` change would
  leave the derived `shortName` in `stations.json` stale until the next
  catalog-watch rebuild — which is why P3 does not auto-edit `name`.
