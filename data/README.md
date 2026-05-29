# How the rrradio catalog is built

> Where every station comes from — and how we keep it trustworthy.

rrradio's catalog is **data, not code**. This folder is the source of truth;
everything the apps load (`public/stations.json`) is built from here. The
pipeline is designed to be **transparent** (every upstream snapshot is
committed — `git log` is the audit trail), **reproducible** (one script chain,
offline-capable), and **conservative** (a stream is only published once we've
verified it plays).

```
Radio Browser (~55k stations, 237 countries)         manual / broadcaster sources
       │  fetch-rb-raw  (polite; committed snapshots = git audit trail)
       ▼
 data/sources/radio-browser/by-country/*.json
       │  dedupe-raw   (union-find: stream-url + name+homepage; curator overrides)
       ▼
 dedupe.json  ──►  analyze-rb   (playability: fetch / byte / real-browser probe)
       │
       ▼
 CURATION → data/stations.yaml   ◄── bound to RB via stationuuid + changeuuid
       │     • field precedence: local YAML › broadcaster › RB baseline
       │     • enrichment: now-playing metadata, schedules, geo, capabilities
       │     • logos: scrape › wiki › broadcaster-api › RB — quality + license
       ▼
 build-catalog  →  public/stations.json (+ favicons, capabilities, FTS, sources)
       │     gates: check-catalog · check-duplicates · check-drift  (CI-enforced)
       ▼
 GitHub Pages  →  web app · iOS app · (Android)
```

### 1 · Where stations come from
Two sources, registered in [`sources.yaml`](./sources.yaml):
- **[Radio Browser](https://www.radio-browser.info/)** — a community-maintained,
  public-domain directory of ~55k stations across ~237 countries.
  `npm run fetch-rb-raw` mirrors it into
  [`sources/radio-browser/by-country/`](./sources/radio-browser/) as committed
  JSON snapshots, so `git log -p` shows every change upstream has made. 🙏
- **manual** — hand-added stations not (yet) in any upstream catalog.

A station binds to its Radio Browser record via `stationuuid` + `changeuuid`
(the drift signal) + `reviewedAt`.

### 2 · Deduplication
The ~55k raw rows collapse to far fewer real stations.
[`dedupe-raw`](../tools/dedupe-raw.mjs) links duplicates across countries with
union-find over two signals: **stream-url** (same normalized endpoint —
protocol-insensitive, tracking query stripped) and **name + homepage** (same
country + name signature + homepage host, which catches one station spread
across different CDNs, ports, or codecs). Name signatures are Unicode-aware so
non-Latin channels of one broadcaster stay distinct. The canonical row is
chosen by votes → clicks → earliest record; curators settle edge cases in
[`overrides.yaml`](./sources/radio-browser/overrides.yaml), and clusters larger than 50 are
flagged for manual review.

### 3 · Verifying streams
Before a station can publish, its stream has to actually play.
[`analyze-rb`](../tools/analyze-rb.mjs) probes each URL three ways — a fast
`fetch` check, a byte-signature probe, and a real-browser `<audio>` probe — and
records a verdict.

### 4 · Enrichment
Curated entries in [`stations.yaml`](./stations.yaml) stay small: per field,
**local YAML wins → broadcaster fallback → Radio Browser baseline**, so stream
URL, codec, bitrate, tags, and geo come from upstream unless we deliberately
override. On top we wire now-playing metadata (broadcaster APIs, ICY stream
titles, on-air schedules), a network-free **capabilities** manifest telling
mobile clients which stations are worth background metadata work, and **drift
detection** that flags when a bound record changes upstream. Details:
[docs/operations.md](../docs/operations.md).

### 5 · Logos & artwork
Logos are sourced — in order of preference — from the broadcaster's own site,
Wikipedia (CC), broadcaster metadata APIs, then Radio Browser; each candidate
is quality-probed and recorded with its **provenance and license**. Remote SVGs
are rasterized for native clients, and every catalog favicon is pre-sized into
**76 / 128 / 152 px WebP variants** so apps never downsample full-size art on
device. Playbook: [docs/logo-extraction.md](../docs/logo-extraction.md).

### 6 · What publishes
Every station carries a status; only three publish into the bundled catalog:

| Status | Meaning |
|---|---|
| `working` | stream + metadata + logo all flowing |
| `icy-only` | stream plays, ICY supplies the track title |
| `stream-only` | plays, no metadata source available |

`fetcher-todo`, `investigate`, `not-public`, and `broken` stay out.

### 7 · Build, gates & publish
`npm run catalog` regenerates `public/stations.json` plus favicon variants, the
capabilities manifest, per-source roll-ups, an FTS search index, and SEO pages.
Three deterministic gates run in CI before anything deploys — **check-catalog**
(YAML ↔ JSON in sync, HTTPS-only, variants present), **check-duplicates** (no
uuid / stream / name collisions), and **check-drift**. The committed
`stations.json` is what GitHub Pages serves, so a build hiccup never takes the
catalog down.

## Reproduce it
```bash
npm run fetch-rb-raw       # mirror Radio Browser (polite; ~2 min for all countries)
npm run dedupe-raw         # rebuild the dedupe DB
npm run analyze-rb -- DE   # probe playability for one country
npm run catalog            # rebuild the published catalog (RRRADIO_OFFLINE=1 = cache-only)
```
Full operations reference: [docs/operations.md](../docs/operations.md) ·
File map: [docs/architecture.md](../docs/architecture.md) ·
Add a station: [docs/adding-stations.md](../docs/adding-stations.md).

## Attribution
Station data originates from **[Radio Browser](https://www.radio-browser.info/)**,
dedicated to the public domain by its maintainers and contributors — thank you 🙏.
Logos remain the property of their broadcasters; bundled assets and their terms
are tracked in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Lyrics come
from [LRCLIB](https://lrclib.net/) and [Lyrics.ovh](https://lyrics.ovh/).
