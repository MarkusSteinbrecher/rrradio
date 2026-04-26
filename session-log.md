# Session log

A dated, append-only summary of significant sessions. PMO reads these
across projects. Keep entries terse — what changed, what was decided,
what's next.

## 2026-04-26 — Curation pipeline + program tabs

Long session. Catalog grew from 4 stations → 50 publishable; program
tabs work for 10 of them. Net work split into three threads.

### Catalog growth

- `tools/import-ard.mjs` — canonical-channel-driven bulk import from
  Radio Browser. Brought in 38 ARD channels (BR/WDR/NDR/MDR/SWR/HR/
  RBB/SR/RB/DLF) at status:stream-only.
- Curated **Frisky** (4 channels: main, classics, chill, deep) at
  status:icy-only with a 212×222 logo from their S3 favicon. ICY
  metadata flows; no public API found beyond that.
- Auto-curate workflow merged its first PR (BBC World Service from
  GoatCounter top-played).

### Per-station diagnostic + analysis tooling

- `tools/analyze.mjs` — diagnostic per station (stream / https / icy /
  meta API / fetcher / program / logo). Writes
  `public/station-status.json` for the admin dashboard.
- `tools/backlog.mjs` — analyzed view of every played station with
  RB lookup + verdict. Wired into the weekly catalog-watch workflow.
- `tools/wire-metadata.mjs` — auto-derives per-station metadataUrl
  for broadcasters with known patterns (br/orf/bbc/hr).
- `tools/backfill-geo.mjs` — populated `geo: [lat, lon]` on all 47
  stations (RB lookup → broadcaster-HQ-centroid fallback).
- `docs/curation-checklist.md` — per-activity playbook documenting
  the wire-metadata-first workflow.

### Program-view coverage

Now Playing got a tabbed pane (▶ now / ▤ program) with day-selector
pills. Coverage:

- **ORF** (FM4, Ö1) — 8-day schedule via audioapi.orf.at
- **BR** (Bayern 1 + 4 auto-imports — Bayern 2, BR Heimat, BR Schlager,
  BR24) — single-day schedule via radioplayer.json
- **BBC** (World Service) — multi-day schedule via worker proxy of
  rms.api.bbc.co.uk (gates by Origin: bbc.co.uk; CORS-passes preflight
  but 403s real GETs from non-bbc origins)
- **HR** (hr1, hr2, hr3, hr4) — radioplayer.json via generic worker
  proxy with allowlist; combines program from API with ICY tracks

Total: **10 stations** with full live program tabs.

### UX touches

- Filter row redesigned end-to-end: `[♫] [★] [📰] | [🎵] [🌍] [📍]`.
  Three modes (mutually exclusive radio set, all deselectable),
  two narrow-by dropdowns, one map-toggle (disabled outside home).
- Globe view (Wikimedia world-map SVG, equirectangular pins) replaces
  the list section when 📍 is on. Stations within ~11km cluster.
- Station rows + featured tiles get a small accent star for curated
  entries.
- Logo redesign: new "soundline" SVG wordmark in yellow + white type;
  README leads with light/dark variants.
- Accent color: amber `#e9b66b` → pure yellow `#ffff00`.
- Plus a dozen smaller polish items (load-more pagination, news
  toggle / mode interaction, country filter, etc.).

### Decisions / dead-ends

- **ARD Audiothek** investigated as a unified path for all ARD
  broadcasters — REJECTED. 184/198 livestreams have empty `current`
  field; 14 are stuck on a 2022 broadcast. The API targets on-demand
  archive content, not live program tracking. Per-broadcaster API
  research stays necessary.
- **Grrif program API** — confirmed there is no public endpoint;
  `wp-json` is gated, `/grille/` is JS-rendered with no decodable
  data. Track-only via `covers.json` stays.

### Open backlog

Remaining ~25 stations across **WDR, NDR, MDR, SWR, RBB, Radio
Bremen, DLF** still at `status: stream-only` with no program info.
Each broadcaster needs ~30-60 min of network-tab API research; some
likely need worker-proxy access. Pattern is templated — extend
`tools/wire-metadata.mjs` + `src/builtins.ts` per broadcaster, plus
the worker allowlist if CORS-blocked.
