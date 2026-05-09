# Broadcaster API Research

Per-broadcaster findings from the API discovery skill. Each entry documents the
now-playing / schedule endpoints found, CORS status, response shape, and whether
the station is wirable today.

See issue #193 for the backlog of broadcasters to investigate.

---

## ndr — Norddeutscher Rundfunk (DE)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | Playlist slug | Has playlist? |
|---|---|---|---|
| NDR 2 | `icy-only` | `ndr2` | yes |
| NDR 90,3 | `icy-only` | `ndr903` | yes |
| NDR Kultur | `icy-only` | `ndrkultur` | yes |
| NDR 1 Niedersachsen | `icy-only` | `ndr1niedersachsen` | yes |
| NDR 1 Welle Nord | `icy-only` | `ndr1wellenord` | yes |
| N-JOY | `icy-only` | `njoy` | yes |
| NDR Schlager | `icy-only` | `ndrschlager` | yes |
| NDR Blue | `icy-only` | `ndrblue` | yes |
| NDR 1 Radio MV | `icy-only` | `ndr1radiomv` | yes |
| NDR Info | `icy-only` | — | no (news/talk) |

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing + track history + cover | `https://www.ndr.de/public/radioplaylists/<slug>.json` | none | `*` | `data/metadata-discovery/ndr-playlist-ndr2.json` |
| Cover art image | `https://www.ndr.de/public/radioplaylists/coverimages/<uuid>_300x300.jpg` | none | `*` | (URL embedded in now-playing response) |
| NDR Kultur `persons` (composer, conductor, etc.) | embedded in now-playing response `persons` array | none | `*` | `data/metadata-discovery/ndr-playlist-ndrkultur.json` |

**Slug mapping** (derived by probing `https://www.ndr.de/public/radioplaylists/<slug>.json`):

| Station | Slug |
|---|---|
| NDR 2 | `ndr2` |
| NDR 90,3 | `ndr903` |
| NDR Kultur | `ndrkultur` |
| NDR 1 Niedersachsen | `ndr1niedersachsen` |
| NDR 1 Welle Nord | `ndr1wellenord` |
| N-JOY | `njoy` |
| NDR Schlager | `ndrschlager` |
| NDR Blue | `ndrblue` |
| NDR 1 Radio MV | `ndr1radiomv` |

All return HTTP 200 with `access-control-allow-origin: *`. NDR Info has no music playlist endpoint (tried: `ndrinfo`, `info`, `ndrinfo2`, `ndrinfospezial` — all 404).

### Response shape

```json
{
  "action": "radioPlaylist",
  "timeStamp": 1778307145,
  "nextVisitIn": "10",
  "song_now":          "Udo Lindenberg & Apache 207 - Komet",
  "song_now_interpret":"Udo Lindenberg & Apache 207",
  "song_now_title":    "Komet",
  "song_now_cover":    "b38672de-4680-409b-a5eb-79fc6b344e1c",
  "song_now_album":    "Komet",
  "song_now_ean":      "5054197494963",
  "song_previous":     "Taylor Swift - Anti-Hero",
  "song_previous_interpret": "Taylor Swift",
  "song_previous_title":     "Anti-Hero",
  "song_previous_cover":     "6bb4dc29-...",
  "song_next":         "Philip Bailey & Phil Collins - Easy Lover",
  "song_next_interpret":"Philip Bailey & Phil Collins",
  "song_next_title":   "Easy Lover",
  "song_next_cover":   "ec1717f4-...",
  "more_songs": [
    {
      "song":           "Duck Sauce - Barbra Streisand",
      "song_interpret": "Duck Sauce",
      "song_title":     "Barbra Streisand",
      "song_cover":     "374bf480-...",
      "song_album":     "Barbra Streisand",
      "song_order_number": "1",
      "song_ean":       "9705003370174"
    }
  ]
}
```

**Key field mappings:**
- Artist → `song_now_interpret`
- Track title → `song_now_title`
- Cover UUID → `song_now_cover`; build URL as `https://www.ndr.de/public/radioplaylists/coverimages/<uuid>_300x300.jpg`
- `nextVisitIn` → polling interval hint (seconds, typically `"10"`)
- `more_songs` → track history list (6 recent tracks)
- `song_previous` / `song_next` → previous and upcoming track (with cover UUIDs)

**NDR Kultur special case** — the `persons` array carries classical music metadata:
```json
"persons": [
  { "name": "Helena Munktell (1852-1919)", "role": "COMPOSER", "sort": "1" },
  { "name": "Gävle Symphony Orchestra",   "role": "ORCHESTRA",  "sort": "1" },
  { "name": "Tobias Ringborg",             "role": "CONDUCTOR",  "sort": "1" }
]
```
Roles present: `COMPOSER`, `ORCHESTRA`, `CONDUCTOR`, `PERFORMER`. The `song_now_interpret`
field on Kultur often contains the composer name (since classical tracks list composer as
"artist"). The `persons` array can augment with ensemble/conductor info in the subtitle.

### Wirable today?

✅ **wire-now** for 9 of 10 channels. HTTPS-only, `CORS: *`, no auth, structured JSON.
`nextVisitIn: "10"` is the broadcaster's own 10-second polling cadence hint.

NDR Info: ❌ no playlist endpoint exists (news/talk station; expected).

### Suggested fetcher

New `fetchNdrMetadata` in `src/builtins.ts`. Closest analogues are `fetchSwrMetadata`
(single endpoint per channel, structured JSON, cover URL embedded) and `fetchMdrMetadata`
(German ARD family, per-channel `metadataUrl`).

Pattern:
1. `station.metadataUrl` stores the full playlist URL:
   `https://www.ndr.de/public/radioplaylists/<slug>.json`
2. Fetch with `cache: 'no-store'`; no proxy needed (CORS open).
3. Read `song_now_interpret` → artist, `song_now_title` → track.
4. Build cover URL from `song_now_cover` UUID:
   `https://www.ndr.de/public/radioplaylists/coverimages/${uuid}_300x300.jpg`
5. For NDR Kultur: optionally extract `persons` composer/conductor for a programme subtitle.
6. No programme/schedule API was found for NDR beyond the track playlist — no equivalent
   to SWR's `show.title` field. Programme info is not available via this endpoint.

Register as `ndr` in the `METADATA_FETCHERS` / `SCHEDULE_FETCHERS` maps.

### Notes

- `nextVisitIn` is always `"10"` (string) in all captured responses — treat as the
  broadcaster-suggested poll interval in seconds.
- The `more_songs` array is ordered most-recent-first and typically contains 6 items.
  No pagination — the full recent playlist is in a single response.
- NDR Kultur's `song_now_interpret` field sometimes holds the composer name rather than
  the performer. The `persons` array is the better source for role-specific metadata on
  that channel; other channels don't populate `persons`.
- Cover images are served with `CORS: *` as well — safe to use directly in `<img>` or
  CSS `background-image`. The 300×300 size is the only documented variant (UUID-based
  URLs don't expose size parameters publicly).
- NDR Info has no playlist endpoint — keep at `stream-only` / `icy-only`. The station's
  live page (`/nachrichten/info/live`) uses `data-brand="ndrinfo"` but no music is played.
- No rate-limit headers observed on any endpoint. 10-second polling is the broadcaster's
  own cadence hint.
- ToS: NDR is a German public broadcaster (ARD). No explicit API ToS; the endpoints are
  served publicly without authentication. The 10-second poll cadence from `nextVisitIn`
  is a safe default.

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

---

## dlf — Deutschlandradio (DE)

Investigated: 2026-05-09.

### Channels in catalog

| Channel | Site | Status before | Wirable? |
|---|---|---|---|
| Deutschlandfunk | `deutschlandfunk.de` | `icy-only` (no fetcher) | ❌ no JSON API found |
| Deutschlandfunk Kultur | `deutschlandfunkkultur.de` | `icy-only` (no fetcher) | ❌ no JSON API found |
| Deutschlandfunk Nova | `deutschlandfunknova.de` | `icy-only` (no fetcher) | ⚠️ via-worker |

### Background

Deutschlandradio operates three channels under one corporate umbrella but on entirely
separate technical platforms:

- **Deutschlandfunk (DLF)** and **Deutschlandfunk Kultur** share the Sophora CMS
  (`deutschlandradio.de` umbrella), served as fully SSR-rendered pages. No client-side
  JSON API for now-playing or programme data was found. Both are primarily news/talk/feature
  stations; music is incidental and not the main content type.
- **Deutschlandfunk Nova** runs a separate Node.js application on its own domain
  (`deutschlandfunknova.de`) with a static CDN at `static.deutschlandfunknova.de`.
  This is a music-focused digital-only station with a proper JSON onair endpoint.

The `broadcasters.yaml` note "share an API" does not hold: only Nova has a usable
now-playing API. DLF and DLF Kultur have no machine-readable equivalent.

### Endpoints

#### Deutschlandfunk Nova — now-playing

| What | URL | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing | `https://static.deutschlandfunknova.de/actions/dradio/playlist/onair` | none | **none** (needs proxy) | `data/metadata-discovery/dlfnova.json` |

The endpoint is an S3 object served via CloudFront. `cache-control: max-age=15` (15 s).
No `Access-Control-Allow-Origin` header is returned even with an `Origin` request header —
direct browser fetch will be blocked. Requires the rrradio-stats Worker proxy.

There is also a `onair_test` path (`/actions/dradio/playlist/onair_test`) referenced in
the DLF Nova JS bundle, but it is not a stable production endpoint.

#### Deutschlandfunk (main) and Deutschlandfunk Kultur

No JSON now-playing or programme API found. Both sites use the Sophora CMS
(`player.dist.js` is an identical 581 KB file on both), which renders programme data
server-side. The `/musikliste` page on both sites shows past tracks but is SSR-only —
no AJAX or JSON endpoint backs it.

Alternatives investigated and ruled out:
- `api.deutschlandradio.de` — DNS does not resolve.
- ARD Audiothek GraphQL (`api.ardaudiothek.de`) — user-facing; no live now-playing query.
- ARD Sounds (`ardsounds.de/api/programmes/dlf/current`) — 404.
- Sophora REST/JSP patterns — no JSON endpoints found.
- `programm.deutschlandradio.de` — DNS does not resolve.

### Response shape — Deutschlandfunk Nova `/onair`

```json
{
  "playlistItem": {
    "title":     "Goodbye Mr A",           // track title
    "artist":    "The Hoosiers",           // track artist
    "type":      "Music",                  // "Music" | other (skip non-Music)
    "length":    266928,                   // duration ms
    "starttime": 1778307374,               // Unix seconds (NOT ms)
    "stoptime":  1778307641,               // Unix seconds (NOT ms)
    "cover":     "",                       // always empty string — no cover art
    "services": {
      "spotify": "", "lastfm": "", "itunes": "",
      "soundcloud": "", "amazon": "", "deezer": "", "podcast": ""
    }                                      // all empty in production
  },
  "presenter": {
    "displayname": "Anke van de Weyer",
    "url":    "https://www.deutschlandfunknova.de/profil/...",
    "avatar": "https://static.deutschlandfunknova.de/transformations/profil/..."
    // avatar is a presenter headshot, not a per-track cover
  },
  "show": {
    "starttime": "1778306400",             // Unix seconds as string
    "title":     "Deutschlandfunk Nova",   // show/programme name
    "cover":     ""                        // always empty
  }
}
```

Field mapping:
- `playlistItem.artist` → artist
- `playlistItem.title` → track
- `playlistItem.type` — skip if not `"Music"` (speech/podcast segments appear here)
- `playlistItem.starttime` / `stoptime` — Unix **seconds**, not milliseconds. The endpoint
  always returns the current track directly; no time-window lookup needed.
- `playlistItem.cover` — always `""` in production; no usable cover art from this API.
- `show.title` → programme name (always `"Deutschlandfunk Nova"` for the live stream).

No cover art source found. `services.spotify` / `services.lastfm` etc. are always empty.

### Wirable today?

| Channel | Track | Programme | Verdict |
|---|---|---|---|
| Deutschlandfunk Nova | ⚠️ **via-worker** — endpoint live, no CORS headers | ⚠️ show name only | Wire via proxy; no cover art |
| Deutschlandfunk | ❌ no API found | ❌ no API found | Stays `icy-only` |
| Deutschlandfunk Kultur | ❌ no API found | ❌ no API found | Stays `icy-only` |

### Suggested fetcher

**DLF Nova:** New `fetchDlfNovaMetadata` in `src/builtins.ts`. Shape is simpler than most:
single fetch, flat JSON object, `type === "Music"` guard, no schedule endpoint, proxy required.

Closest existing analogue: `fetchGrrifMetadata` or `fetchStreamabcMetadata`
(both: single-fetch, flat JSON response, no schedule).

The worker proxy allowlist in `worker/src/index.ts` needs an entry for:
```
^https://static\.deutschlandfunknova\.de/actions/dradio/playlist/onair$
```

Stations YAML updates needed (Nova only):
```yaml
metadata: dlf-nova
metadataUrl: https://static.deutschlandfunknova.de/actions/dradio/playlist/onair
```

### Notes

- `playlistItem.starttime` / `stoptime` are **Unix seconds**, not milliseconds — different
  from every other broadcaster in the catalog. The fetcher does not need a time-window
  comparison; the endpoint always returns the current track directly.
- No track history endpoint. S3 returns 403 on all paths except `/onair` and `/onair_test`.
- No cover art available from this API. `playlistItem.cover` and `show.cover` are always
  `""` in production. The presenter `avatar` is a headshot CDN URL, not a per-track image.
- CloudFront serves with `cache-control: max-age=15`. Poll every 20–30 s.
- ToS: Deutschlandradio is a German federal public broadcaster (not ARD). No explicit
  API ToS for this endpoint. The URL is called by every `deutschlandfunknova.de/playlist`
  page visitor. Reasonable polling cadence is appropriate.
- DLF (main) is primarily news/talk; even if a now-playing API existed, music occupies
  perhaps 15–20% of airtime. ICY metadata from the stream is the practical fallback.
- DLF Kultur similarly mixes speech/feature/classical — the absence of a track API is
  not a significant gap; programme info (show title) would be more useful for that
  channel anyway.
- The `broadcasters.yaml` note "share an API" is **incorrect for wiring purposes**:
  only Nova has a machine-readable now-playing API. DLF and DLF Kultur should not
  receive a `metadata:` key until a real API is found.

---

## mdr — Mitteldeutscher Rundfunk (DE)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | metadataUrl / endpoint pattern | Wired? |
|---|---|---|---|
| MDR Sachsen | `working` | `xmlresp-index.do?idwelle=4` | yes |
| MDR Sachsen-Anhalt | `icy-only` | none | no — idwelle=5 now confirmed |
| MDR Thüringen | `working` | `xmlresp-index.do?idwelle=6` | yes |
| MDR Aktuell | `working` | `xmlresp-index.do?idwelle=2` | yes (news captions, not tracks) |
| MDR Klassik | `working` | `xmlresp-index.do?idwelle=7` | yes |
| MDR Jump | `working` | `XML/titellisten/jump_onair.json` | yes |
| MDR Sputnik | `working` | `XML/titellisten/sputnik_onair.json` | yes |
| MDR Schlagerwelt | `icy-only` | none | no — idwelle=22 now confirmed |
| MDR Tweens | `icy-only` | none | no — idwelle=23 now confirmed |
| MDR Kultur | not in catalog | none | no — idwelle=8 newly found |

### Background — existing fetcher

`fetchMdrMetadata` already exists in `src/builtins.ts` and handles two URL patterns
that share the same `Songs` JSON shape:

- **Pattern A (onair):** `https://www.mdr.de/XML/titellisten/<slug>_onair.json`
  — Used by Jump and Sputnik. Returns a small history list; the entry with
  `status:"now"` is the current track. `artist_image_id.imageVariant` carries
  per-artist images including a 960×960 `variantBig1x1`.

- **Pattern B (xmlresp):** `https://www.mdr.de/scripts4/titellisten/xmlresp-index.do?output=json&idwelle=<id>&amount=<N>`
  — Used by all other channels. **Requires `&startdate=YYYYMMDD`** (auto-appended
  by the fetcher today). Without `startdate`, the endpoint returns an empty `Songs`
  object for most channels. Returns a day's playlist in descending order; [0] is most
  recent. The fetcher takes `songs.find(s => s.status === 'now') ?? songs[0]`.

The `idwelle` is the channel identifier embedded in the URL. The fetcher already
handles both patterns — the `metadataUrl` stored per-station in `stations.yaml`
determines which pattern is used.

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing (onair, Jump) | `https://www.mdr.de/XML/titellisten/jump_onair.json` | none | `*` | `data/metadata-discovery/mdr-onair-jump.json` |
| Now-playing (onair, Sputnik) | `https://www.mdr.de/XML/titellisten/sputnik_onair.json` | none | `*` | `data/metadata-discovery/mdr-onair-sputnik.json` |
| Now-playing + history (xmlresp, Klassik) | `https://www.mdr.de/scripts4/titellisten/xmlresp-index.do?output=json&idwelle=7&amount=2&startdate=YYYYMMDD` | none | `*` | `data/metadata-discovery/mdr-xmlresp-klassik.json` |
| Now-playing + history (xmlresp, Sachsen) | `…?idwelle=4…` | none | `*` | `data/metadata-discovery/mdr-xmlresp-sachsen.json` |
| Now-playing + history (xmlresp, Thüringen) | `…?idwelle=6…` | none | `*` | `data/metadata-discovery/mdr-xmlresp-thueringen.json` |
| Now-playing + history (xmlresp, Aktuell) | `…?idwelle=2…` | none | `*` | `data/metadata-discovery/mdr-xmlresp-aktuell.json` |
| Now-playing + history (xmlresp, Sachsen-Anhalt) | `…?idwelle=5…` | none | `*` | `data/metadata-discovery/mdr-xmlresp-sachsen-anhalt.json` |
| Now-playing + history (xmlresp, Schlagerwelt) | `…?idwelle=22…` | none | `*` | `data/metadata-discovery/mdr-xmlresp-schlagerwelt.json` |
| Now-playing + history (xmlresp, Tweens) | `…?idwelle=23…` | none | `*` | `data/metadata-discovery/mdr-xmlresp-tweens.json` |
| Now-playing + history (xmlresp, MDR Kultur) | `…?idwelle=8…` | none | `*` | `data/metadata-discovery/mdr-xmlresp-kultur.json` |
| Cover art | Embedded in `artist_image_id.imageVariant` array (onair only; absent on xmlresp channels) | none | `*` | (URL embedded in now-playing response) |

**Full xmlresp base URL:**
`https://www.mdr.de/scripts4/titellisten/xmlresp-index.do?output=json&idwelle=<N>&amount=2&startdate=YYYYMMDD`

CORS headers on all endpoints: `access-control-allow-origin: *`, `access-control-allow-methods: GET,POST`,
`access-control-max-age: 86400`. No auth, no rate-limit headers observed.

### idwelle mapping (complete, confirmed via `avCustom` XML + track-content verification)

| idwelle | Channel | Status in catalog | Has cover art in response? |
|---|---|---|---|
| 1 | MDR Jump (also available as `jump_onair.json`) | `working` | yes (onair pattern) |
| 2 | MDR Aktuell | `working` | no (news captions) |
| 3 | MDR Sputnik (also available as `sputnik_onair.json`) | `working` | yes (onair pattern) |
| 4 | MDR Sachsen | `working` | no |
| 5 | MDR Sachsen-Anhalt | `icy-only` — **wireable** | no |
| 6 | MDR Thüringen | `working` | no |
| 7 | MDR Klassik | `working` | no (art absent for classical pieces) |
| 8 | MDR Kultur | not in catalog | no |
| 22 | MDR Schlagerwelt | `icy-only` — **wireable** | no |
| 23 | MDR Tweens | `icy-only` — **wireable** | no |

idwelles 9–21 and 24+ return HTTP 200 but empty `Songs` objects — inactive or
internal channels. idwelle=10 returns programme-level text entries (no `interpret`
field) — likely MDR Fernsehen (TV audio) or an internal broadcast feed.

Discovery method: `https://www.mdr.de/static/radiolivestreams/config/mdr_<channel>.json`
→ `streams[0].url` → `avCustom.xml` → `dynamicDataUrl` contains
`xml-index.do?idwelle=<N>`. The XML and JSON endpoints share the same idwelle namespace.

### Response shape

**Pattern A (onair endpoints — Jump, Sputnik):**
```json
{
  "Resulttype": "OK",
  "Songs": {
    "0": {
      "status": "now",
      "id_titel": "A393BD81",
      "title": "End of the World",
      "interpret": "Miley Cyrus",
      "starttime": "2026-05-09 08:12:30",
      "duration": "00:03:49",
      "artist_image_id": {
        "imageVariant": [
          { "@attributes": { "name": "variantBig1x1", "width": "960", "height": "960",
              "mimeType": "image/jpeg",
              "url": "https://www.mdrjump.de/musik/interpret/miley-cyrus-122-resimage_v-variantBig1x1_w-960.jpg?version=50199" } },
          { "@attributes": { "name": "variantSmall1x1", "width": "512", "height": "512", ... } }
        ]
      },
      "komponist": "Shawn Everett",
      "label": "SMI/ RCA",
      "tontraeger": "End of the World"
    },
    "1": { "status": "old", ... }
  }
}
```

**Pattern B (xmlresp endpoints, music channels — Sachsen, Thüringen, Klassik, etc.):**
Same `Songs` shape but `imageVariant` is typically absent (`{"@root":"root"}`) —
no cover art. `status` is `"old"` for all entries (no `"now"` tag); the fetcher uses
`songs[0]` as the most recent track. Available bonus fields: `komponist` (composer),
`label`, `tontraeger` (album/release). Not currently surfaced in the UI.

**Pattern B (xmlresp, news/talk — MDR Aktuell, idwelle=2):**
`interpret` holds the reporter's name or is absent; `title` holds the news headline.
The fetcher still returns a result (the headline appears as the "now playing" title).

**Key field mappings:**
- Artist → `interpret` (trim + title-case in fetcher)
- Track title → `title`
- Cover URL → `artist_image_id.imageVariant[name="variantBig1x1"]["@attributes"].url`
  (present on Jump/Sputnik onair; absent on xmlresp channels)
- Most-recent track → `songs.find(s => s.status === 'now') ?? songs[0]`

### Wirable today?

✅ **wire-now (no code changes)** for three unwired channels with confirmed idwelles —
the existing `fetchMdrMetadata` handles them directly:

- **MDR Sachsen-Anhalt** (`idwelle=5`): add `metadata: mdr` + `metadataUrl` in `stations.yaml`, flip to `working`.
- **MDR Schlagerwelt** (`idwelle=22`): same. No cover art in responses, but track titles present.
- **MDR Tweens** (`idwelle=23`): same.

⚠️ **partial / new station entry needed** for MDR Kultur:

- **MDR Kultur** (`idwelle=8`): Track data confirmed (soft adult-contemporary / indie folk:
  Steely Dan, Kate Bush, Joe Bel). Fetcher works. But MDR Kultur is **not currently in
  `data/stations.yaml`** — a new station entry is needed before wiring. No cover art.

No proxy needed for any MDR channel — all endpoints have `CORS: *`.

### Suggested fetcher

The existing `fetchMdrMetadata` in `src/builtins.ts` is **fully wirable as-is** for
all three unwired channels. No code changes needed.

Required work (station-file only — handled via `wire-metadata` / curate-stations):

1. **`data/stations.yaml`** — add `metadata: mdr` and
   `metadataUrl: https://www.mdr.de/scripts4/titellisten/xmlresp-index.do?output=json&idwelle=<N>&amount=2`
   to MDR Sachsen-Anhalt (idwelle=5), MDR Schlagerwelt (idwelle=22), MDR Tweens (idwelle=23),
   and flip `status` from `icy-only` to `working`.
2. **`data/broadcasters.yaml`** — update the `mdr` notes block to record the newly confirmed
   idwelles (5, 22, 23, 8) and remove the "unconfirmed" caveat on Sachsen-Anhalt.
3. Optionally: add a new station entry for **MDR Kultur** (`idwelle=8`).

### Notes

- The `startdate=YYYYMMDD` query parameter is **required** on `xmlresp-index.do`
  for music channels. Without it the endpoint returns `"Songs": {}`. The fetcher
  already auto-appends today's date when `xmlresp-index.do` appears in the URL —
  confirmed working.
- The `onair.json` pattern (Jump, Sputnik) does not require `startdate`. It returns
  a short history including the `status:"now"` current track.
- Cover art (`artist_image_id.imageVariant`) is only populated on the onair-pattern
  endpoints (Jump and Sputnik). The xmlresp endpoints return `{"@root":"root"}` for
  `artist_image_id` — no image URL. Fetching per-artist cover would require a
  separate undiscovered endpoint.
- MDR Klassik (`idwelle=7`): art absent in responses. Classical pieces show
  `artist_image_id: {"@root":"root"}`. The `komponist` field carries the composer name;
  `interpret` holds the performer; `tontraeger` is the album/release. For richer
  classical display, `komponist` and `tontraeger` could supplement the subtitle —
  not currently done by the fetcher.
- MDR Aktuell (`idwelle=2`) is a news station. The fetcher returns news headline
  strings — this is arguably a misuse of the "now playing" field. Consider changing
  MDR Aktuell's status to `stream-only` or suppressing the fetcher for that channel.
- idwelle=1 (Jump) and idwelle=3 (Sputnik) are redundant with the `_onair.json`
  pattern. The onair pattern is preferred for those two channels since it returns
  `status:"now"` explicitly and includes artist images.
- No rate-limit headers observed on any endpoint. MDR's own player polls every ~30 s.
- ToS: MDR is a German public broadcaster (ARD). No explicit API ToS; endpoints
  are served publicly without authentication. Reasonable polling cadence (30–60 s).
