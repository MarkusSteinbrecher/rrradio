# Broadcaster API Research

Per-broadcaster findings from the API discovery skill. Each entry documents the
now-playing / schedule endpoints found, CORS status, response shape, and whether
the station is wirable today.

See issue #193 for the backlog of broadcasters to investigate.

---

## rbb — Rundfunk Berlin-Brandenburg (DE)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | Fetcher key |
|---|---|---|
| Radio Eins | `working` | `rbb-radioeins` (already wired) |
| Fritz | `icy-only` | not wired |
| Antenne Brandenburg | `icy-only` | not wired |
| radioBerlin 88,8 | `icy-only` | not wired |
| radio3 (Kulturradio) | `icy-only` | not wired |
| Inforadio | `icy-only` | not wired |

### Background

All RBB channels share the same CMS platform (Adobe CQ / AEM on `rbb-online.de`).
Each channel lives on its own subdomain with its own **slug** (2–3 letters):

| Channel | Domain | Slug |
|---|---|---|
| Radio Eins | `radioeins.de` | `rad` |
| Fritz | `fritz.de` | `frz` |
| Antenne Brandenburg | `antennebrandenburg.de` | `ant` |
| radioBerlin 88,8 | `rbb888.de` | `ach` |
| radio3 (Kulturradio) | `radiodrei.de` | `kul` |
| Inforadio | `inforadio.de` | `inf` |

### Endpoints

#### Now-playing (track-level HTML fragment)

Two HTML shapes exist across the six channels.

**Shape A — Radio Eins + Fritz** (`<p class="artist">` / `<p class="songtitle">`):

```
https://www.radioeins.de/include/rad/nowonair/now_on_air.html
https://www.fritz.de/include/frz/nowonair/now_on_air.html
```

URL template: `https://www.<domain>/include/<slug>/nowonair/now_on_air.html`

Sample body:
```html
<p class="artist">Katy Perry</p><p class="songtitle">California Gurls</p>
```

Fields: `p.artist` → artist, `p.songtitle` → track title.

**Shape B — Antenne Brandenburg, radioBerlin 88,8, radio3** (`<h3 class="interpret">` / `<p class="title">`):

```
https://www.antennebrandenburg.de/include/ant/nowonair/now_on_air.html
https://www.rbb888.de/include/ach/nowonair/now_on_air.html
https://www.radiodrei.de/include/kul/nowonair/now_on_air.html
```

Sample body:
```html
<em class="now_running">Es läuft:</em>
<h3 class="interpret">Ed Sheeran</h3>
<p class="title">Perfect</p>
```

Fields: `h3.interpret` → artist, `p.title` → track title.
Body is **empty** (whitespace only) when no music is playing (news, speech segments, between tracks).

**Inforadio**: No now-playing widget. Pure news/talk — no track-level data expected; the station has no `jsb_NowOnAir` component on its player page.

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing (Shape A) | `https://www.<domain>/include/<slug>/nowonair/now_on_air.html` | none | `*` | `data/metadata-discovery/rbb-fritz-nowonair.json` |
| Now-playing (Shape A) | radioeins: `/include/rad/nowonair/now_on_air.html` | none | `*` | `data/metadata-discovery/rbb-eins.json` |
| Now-playing (Shape B) | antenne: `/include/ant/nowonair/now_on_air.html` | none | `*` | `data/metadata-discovery/rbb-antenne-nowonair.json` |
| Now-playing (Shape B) | rbb888: `/include/ach/nowonair/now_on_air.html` | none | `*` | `data/metadata-discovery/rbb-rbb888-nowonair.json` |
| Now-playing (Shape B) | radio3: `/include/kul/nowonair/now_on_air.html` | none | `*` | `data/metadata-discovery/rbb-radio3-nowonair.json` |

#### Programme schedule (EPG — programme-level, no track titles)

URL template: `https://www.<domain>/programm/vorlagen/hilfuebersicht-epg-<slug>-json.jsn/from=<DD-MM-YYYY>_05-00/sitelabel=<slug>/to=<DD-MM-YYYY+1>_05-00.jsn`

Date window starts at 05:00 (local) and runs 24 h. Use today/tomorrow dates. Keys are `YYYYMMDDHHSS` strings.

| Channel | Domain | Slug | CORS | Sample |
|---|---|---|---|---|
| Radio Eins | `radioeins.de` | `rad` | `*` | (empty `{}` today — may be CMS latency) |
| Antenne Brandenburg | `antennebrandenburg.de` | `ant` | `*` | `data/metadata-discovery/rbb-antenne-epg.json` |
| radioBerlin 88,8 | `rbb888.de` | `ach` | none | (needs worker proxy) |
| radio3 | `radiodrei.de` | `kul` | `*` | `data/metadata-discovery/rbb-radio3-epg.json` |
| Inforadio | `inforadio.de` | `inf` | `*` | `data/metadata-discovery/rbb-inforadio-epg.json` |
| Fritz | `fritz.de` | `frz` | — | 404 (no EPG in this path pattern) |

EPG response shape:
```json
{
  "202605090600": {
    "pg_title": "Guten Morgen Brandenburg",
    "pg_time":  "06:00",
    "pg_begin": 1778299200000,
    "pg_end":   1778313600000,
    "flyout": {
      "roofline": "Sa 09.05.2026 | 06:00 - 10:00",
      "img": "https://www.antennebrandenburg.de/...jpg",
      "shorttext": "<p>...</p>"
    }
  }
}
```

Fields: `pg_title` → programme name, `pg_begin` / `pg_end` → Unix ms timestamps (no TZ
conversion needed — they are already UTC-based ms). `flyout.img` → programme art
(resizable: change `size=320x180` suffix). No track titles in EPG.

### Response shape — now-playing

The now-playing HTML bodies are tiny (60–150 bytes) and need DOMParser or regex.

**Shape A** (radioeins, fritz): regex `/<p\s+class="artist">([^<]*)<\/p>\s*<p\s+class="songtitle">([^<]*)<\/p>/i`
→ `[1]` = artist, `[2]` = title. Already implemented in `src/builtins.ts` as `fetchRadioEinsMetadata`.

**Shape B** (antenne, rbb888, radio3): regex `/<h3\s+class="interpret">([^<]*)<\/h3>\s*<p\s+class="title">([^<]*)<\/p>/i`
→ `[1]` = artist (HTML-entity-encoded), `[2]` = title. Entities (`&auml;` etc.) must be decoded.

Both shapes return empty body (no match) when no music is on-air — the fetcher should
return `null` in that case so the ICY fallback can still run.

### Cover art

None of the now-playing endpoints carry cover URLs. No per-track cover art available.
Programme artwork is available via `flyout.img` in the EPG endpoint (per show, not per track).

### Wirable today?

| Channel | Track | Programme | Verdict |
|---|---|---|---|
| Radio Eins | ✅ (already wired as `rbb-radioeins`) | ⚠️ (EPG returned empty today) | Done |
| Fritz | ✅ wire-now — CORS open, Shape A | ❌ no EPG endpoint found | wire-now for track |
| Antenne Brandenburg | ✅ wire-now — CORS open, Shape B | ✅ wire-now — CORS open, EPG works | wire-now for both |
| radioBerlin 88,8 | ✅ wire-now — CORS open, Shape B | ⚠️ via-worker — EPG lacks CORS | track direct; EPG via proxy |
| radio3 | ✅ wire-now — CORS open, Shape B | ✅ wire-now — CORS open, EPG works | wire-now for both |
| Inforadio | ❌ news station — no track data | ✅ wire-now — CORS open, EPG works | EPG only |

### Suggested fetcher

**Track fetcher (Shape A — fritz):** Extend the existing `fetchRadioEinsMetadata` to also
handle fritz. That fetcher already implements the exact regex and URL pattern needed.
The simplest approach: rename to `fetchRbbHtmlMetadata`, accept the URL from
`station.metadataUrl`, keep the same regex. Radio Eins can be migrated to the same
function with its URL stored in `metadataUrl`.

**Track fetcher (Shape B — antenne, rbb888, radio3):** New `fetchRbbHtmlBMetadata` (or
same function with a regex variant selected by metadataUrl host, or a single function
with both patterns tried in order). Closest analogue: `fetchRadioEinsMetadata`.

**EPG / programme fetcher:** New `fetchRbbEpgSchedule`. URL template:
```
https://www.<host>/programm/vorlagen/hilfuebersicht-epg-<slug>-json.jsn/from=<DD-MM-YYYY>_05-00/sitelabel=<slug>/to=<DD+1-MM-YYYY>_05-00.jsn
```
Store the base host + slug in `metadataUrl` (e.g.
`https://www.antennebrandenburg.de#ant`). Find the current programme by matching
`pg_begin <= Date.now() < pg_end`. Closest analogue: `fetchHrSchedule`
(also programme-only, no track, uses worker for CORS — except most RBB EPG endpoints
are CORS-open so no proxy needed except rbb888).

### Notes

- The now-playing HTML endpoint uses a **cache-killer** in the original JS
  (`cacheKiller=<timestamp>`) — the fetcher should append `?_=<Date.now()>` to prevent
  stale cache responses.
- Bodies are HTML-entity-encoded (`&auml;` = ä, `&ouml;` = ö, `&uuml;` = ü, `&szlig;` = ß).
  The fetcher should decode these before returning. A small helper function or
  `document.createElement('textarea').innerHTML = …` trick works in the browser.
- `radioBerlin 88,8` redirects `radioberlin.de → rbb888.de`. Use `rbb888.de` as canonical.
- `radio3` redirects `kulturradio.de → radiodrei.de`. Use `radiodrei.de` as canonical.
- Fritz has no EPG endpoint in the standard `.jsn` path. Programme info for Fritz
  is not available via a machine-readable API (the livestream page shows programme via
  a full-page SSI reload, not a parseable JSON feed).
- Inforadio is a 24/7 news station. The EPG is dense (entries every few minutes) and
  useful for showing which programme is on. Status should remain `icy-only` or
  be set to `stream-only` (no ICY from the rndfnk.com stream) — the EPG gives
  programme-level only. Recommend keeping as `icy-only` unless the EPG fetcher
  is wired (which would give programme info but no track).
- No rate-limit headers observed on any endpoint. These are lightly-polled HTML
  fragments that the public web player polls every 20–60 s.
- ToS: RBB is a German public broadcaster (ARD). No explicit API ToS; the endpoints
  are served publicly from their CMS without authentication. Reasonable polling cadence
  (30–60 s) is appropriate.
