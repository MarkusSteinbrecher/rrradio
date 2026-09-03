# health-data

Bot-only orphan branch. **Do not merge this into `main`.**

It holds the catalog quality loop's measurements, kept out of the
source tree because they are large (~31k observation rows a week)
and churn daily — see
[ADR 002](https://github.com/MarkusSteinbrecher/rrradio/blob/main/design/decisions/002-catalog-quality-loop.md).

| Path | What it is |
|---|---|
| `observations/YYYY-MM-DD.ndjson` | append-only probe rows, one file per UTC day |
| `station-health.json` | the derived per-station health record (schema v1) |
| `streaks.json` | consecutive identical verdicts per station and facet |
| `metrics.json` | latest run metrics |
| `metrics-history.ndjson` | one metrics row per derive run |
| `plan.json` | the most recent probe plan |

Written by `.github/workflows/station-probe.yml`. Observations older
than 90 days are pruned by `tools/derive-health.mjs` once the streaks
that depend on them are persisted. `deploy.yml` copies
`station-health.json` from here into `dist/` so the station tracker
reads a fresh record.
