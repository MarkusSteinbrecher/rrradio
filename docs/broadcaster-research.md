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

## npo — Nederlandse Publieke Omroep (NL)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | Channel slug | Has tracks? |
|---|---|---|---|
| NPO Radio 1 | `stream-only` | `npo-radio-1` | yes (news/talk — tracks still present) |
| NPO Radio 2 | `stream-only` | `npo-radio-2` | yes |
| NPO 3FM | `stream-only` | `npo-3fm` | yes |
| NPO Radio 4 | `stream-only` | `npo-radio-4` | yes (classical — tracks present) |
| NPO Radio 5 | `stream-only` | `npo-radio-5` | yes |
| NPO Radio 2 Soul & Jazz | `stream-only` | `npo-radio-2-soul-jazz` | yes |
| NPO FunX | `stream-only` | `npo-funx` | yes |

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing + recent tracks + programme + upcoming | `https://www.nporadio2.nl/api/miniplayer/info?channel=<slug>` | none | reflects Origin (open) | `data/metadata-discovery/npo-miniplayer-radio2.json` |
| Now-playing (NPO Radio 1 — broadcast-heavy) | `https://www.nporadio2.nl/api/miniplayer/info?channel=npo-radio-1` | none | reflects Origin (open) | `data/metadata-discovery/npo-miniplayer-radio1.json` |
| Now-playing + recent (NPO 3FM) | `https://www.nporadio2.nl/api/miniplayer/info?channel=npo-3fm` | none | reflects Origin (open) | `data/metadata-discovery/npo-miniplayer-3fm.json` |
| Now-playing + recent (NPO FunX) | `https://www.nporadio2.nl/api/miniplayer/info?channel=npo-funx` | none | reflects Origin (open) | `data/metadata-discovery/npo-miniplayer-funx.json` |
| Cover art (artist DB CDN) | `https://npo-artistdb.b-cdn.net/images/<id>__<slug>.jpg?aspect_ratio=501%3A500&width=500&height=500` | none | — | embedded in now-playing response |
| Cover art (Spotify CDN, when available) | `https://i.scdn.co/image/<id>` | none | — | embedded in 3FM response |
| Programme photo | `https://radioimages.npox.nl/s3-nporadio2/<id>.jpg?width=600` | none | — | embedded in now-playing response |

**Important:** All seven channels share one API endpoint on `www.nporadio2.nl`. The `channel=` parameter is the slug.
The per-channel subdomains (`npo3fm.nl`, `nporadio1.nl`, etc.) each serve the same Next.js app and also respond to the same `/api/miniplayer/info` path, but `www.nporadio2.nl` is the stable canonical host.

**CORS:** The server echoes back whatever `Origin` header is sent (`access-control-allow-origin: <origin>`), which means any origin is allowed. Equivalent to `*` for practical purposes. No proxy needed.

**Channel slug mapping (all confirmed 200):**

| Station | Slug |
|---|---|
| NPO Radio 1 | `npo-radio-1` |
| NPO Radio 2 | `npo-radio-2` |
| NPO 3FM | `npo-3fm` |
| NPO Radio 4 | `npo-radio-4` |
| NPO Radio 5 | `npo-radio-5` |
| NPO Radio 2 Soul & Jazz | `npo-radio-2-soul-jazz` |
| NPO FunX | `npo-funx` |

### Response shape

```json
{
  "data": {
    "radioTrackPlays": {
      "data": [
        {
          "id": "019e0b83-aa79-70e5-9651-65838686d839",
          "artist": "Mark Ambor",
          "song": "Good To Be",
          "from": "2026-05-09 08:53:54",
          "until": "2026-05-09 08:56:20",
          "radioTracks": {
            "id": "73e57472-336c-4a94-bfe2-32e33aca3fca",
            "slug": "good-to-be",
            "artist": "Mark Ambor",
            "name": "Good To Be",
            "coverUrl": "https://npo-artistdb.b-cdn.net/images/...jpg",
            "isAvailable": true
          },
          "cmsChartEditionPositions": null
        }
      ]
    },
    "radioBroadcasts": {
      "data": [
        {
          "name": "De T van Tannaz",
          "from": "2026-05-09 06:00:00",
          "until": "2026-05-09 09:00:00",
          "slug": "de-t-van-tannaz",
          "coreBroadcasters": [{ "name": "MAX", "alias": "omroep-max" }],
          "radioPresenters": [{ "name": "Tannaz Hajeby" }],
          "radioPhotoAssets": {
            "url360": "https://radioimages.npox.nl/s3-nporadio2/...jpg?width=360",
            "url600": "...",
            "url1200": "..."
          }
        }
      ]
    },
    "upcomingBroadcasts": {
      "data": [ { ... } ]
    }
  },
  "loading": false,
  "networkStatus": 7
}
```

**Key field mappings:**
- Artist → `data.radioTrackPlays.data[0].artist`
- Track title → `data.radioTrackPlays.data[0].song`
- Cover art URL → `data.radioTrackPlays.data[0].radioTracks.coverUrl`
  (can be `npo-artistdb.b-cdn.net` or `i.scdn.co` depending on availability)
- Track history → `data.radioTrackPlays.data` — array of 3 most-recent plays, descending
- Track start → `data.radioTrackPlays.data[0].from` (local time string `YYYY-MM-DD HH:MM:SS`)
- Track end → `data.radioTrackPlays.data[0].until`
- Programme name → `data.radioBroadcasts.data[0].name`
- Programme presenter → `data.radioBroadcasts.data[0].radioPresenters[0].name`
- Programme photo → `data.radioBroadcasts.data[0].radioPhotoAssets.url600`
- Programme window → `data.radioBroadcasts.data[0].from` / `.until`

The "current" track is `radioTrackPlays.data[0]` (most recent). It can be verified as "now"
by checking `from <= now <= until`, but in practice `data[0]` is always the current track
when the array is non-empty. When `radioTrackPlays.data` is empty (very rare), fall back to
`radioBroadcasts` for programme-only display.

NPO Radio 1 (news/talk) still populates `radioTrackPlays` — it plays music between news
blocks. NPO Radio 4 (classical) similarly returns track plays from the response. Both are
wirable using the same fetcher.

### Wirable today?

✅ **wire-now** for all 7 channels. HTTPS-only, CORS open (Origin-reflect), no auth,
structured JSON, covers included. A single fetcher handles the full channel set.

Track-level metadata: available for all 7 channels.
Programme/schedule info: available (current + upcoming broadcasts in the same response).
Cover art: available (CDN-hosted, either NPO artist DB or Spotify CDN).

### Suggested fetcher

New `fetchNpoMetadata` in `src/builtins.ts`. Each station stores its channel slug in
`metadataUrl` (just the slug, e.g. `npo-radio-2`), matching the FFH / Laut.FM mountpoint
pattern — keeps YAML small and the fetcher constructs the full URL.

Pattern (closest analogue: `fetchFfhMetadata` for the slug-as-metadataUrl pattern,
`fetchSwrMetadata` for the programme+track combination):

1. `station.metadataUrl` = channel slug (e.g. `"npo-radio-2"`).
2. Build URL: `https://www.nporadio2.nl/api/miniplayer/info?channel=${slug}`.
3. Fetch with `cache: 'no-store'`; no proxy needed.
4. Parse `data.radioTrackPlays.data[0]` → artist + song + coverUrl.
5. Parse `data.radioBroadcasts.data[0]` → programme name + presenter.
6. Return `{ artist, track: song, coverUrl, program: { name, subtitle: presenter } }`.
7. If `radioTrackPlays.data` is empty, return programme-only result.

Register as `npo` in `FETCHERS_BY_KEY`. A schedule fetcher is optional but could be built
from `upcomingBroadcasts` (next programme only, not a multi-day schedule).

### Notes

- The endpoint is a Next.js API route backed by a GraphQL query (`__typename` fields are
  visible in the response — the response shape reflects the Apollo/GraphQL result format).
  The URL has been stable; the build ID (`rW6EvHx1frhkb2BOIwhhK`) is **not** required —
  the `/api/` routes are independent of the Next.js static build.
- `cache-control: public, s-maxage=30, max-age=5` — the CDN updates the response every
  30 s. Polling every 30 s is appropriate and respects the broadcaster's own cadence.
- Track timestamps (`from`, `until`) are **local Amsterdam time** (`CET`/`CEST`), not UTC.
  The fetcher can use `data[0]` directly without time-window comparison.
- Cover URLs from `npo-artistdb.b-cdn.net` are reliable. Some 3FM and FunX tracks use
  Spotify CDN covers (`i.scdn.co`). Both are HTTPS and load without CORS issues in `<img>`.
- `radioTracks.isAvailable` indicates whether the track is available for on-demand replay
  in the NPO catalogue — not relevant for the now-playing fetcher, ignore it.
- The `npo-funx` slug returned a track title with `**FF FunX New Week 47 Waist`-style
  internal label prefixes — the fetcher should not filter these but they are worth noting
  as potential display noise. The `song` field is the broadcast-level title; track details
  come from `radioTracks.name` which was cleaner in all other captured responses.
- `funx` (without `npo-` prefix) returns HTTP 500. Use `npo-funx` only.
- No rate-limit headers observed on any endpoint.
- ToS: NPO is the Dutch national public broadcaster. No explicit API ToS for this endpoint;
  it is served publicly without authentication and is called by every visitor to the
  nporadio websites. Reasonable polling cadence (30–60 s) is appropriate.

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

---

## rai — RAI (Radio Audizioni Italiane) (IT)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | Channel name in onAir.json |
|---|---|---|
| RAI Radio 1 | `stream-only` | `Rai Radio 1` |
| RAI Radio 2 | `stream-only` | `Rai Radio 2` |
| RAI Radio 3 | `stream-only` | `Rai Radio 3` |
| RAI Radio Classica | `stream-only` | `Rai Radio 3 Classica` |
| RAI Isoradio | not in catalog | `Rai Isoradio` |
| RAI GR Parlamento | not in catalog | `Rai Radio GR Parlamento` |
| RAI Radio Tutta Italiana | not in catalog | `Rai Radio Tutta Italiana` |

Additional channels in the onAir feed (not yet in catalog):
`Rai Radio 1 Sport`, `Rai Radio Kids`, `Rai Radio Live Napoli`,
`Rai Radio Südtirol`, `Rai Radio Techete`, `Rai Radio Trst A`,
`No Name Radio`, `Radio San Marino`.

### Discovery method

raiplaysound.it is a SPA with a Web Worker architecture. The worker file
(`/assets/js/workers/sound.worker.js`) was fetched and grepped for the
onAir.json URL, revealing the two primary endpoints below.
The channel-schedule URL template was also found in the worker script
(`$e` function). WebFetch was blocked for this domain; all discovery
was done via direct `curl`.

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing — all channels | `https://www.raiplaysound.it/palinsesto/onAir.json` | none | `*` | `data/metadata-discovery/rai-onair.json` |
| Channel / dirette listing | `https://www.raiplaysound.it/dirette.json` | none | `*` | `data/metadata-discovery/rai-dirette.json` |
| Programme schedule (days available) | `https://www.raiplaysound.it/palinsesto/app/<palinsesto_url>/giorni.json` | none | `*` | `data/metadata-discovery/rai-schedule-giorni.json` |
| Programme schedule (day detail) | `https://www.raiplaysound.it/palinsesto/app/lite/<palinsesto_url>/<date>.json` | none | `*` | (not captured — days-available response needed first) |
| Per-programme cover art | Embedded in `currentItem.image` (path relative to `https://www.raiplaysound.it`) | none | `*` | (URL embedded in onAir response) |
| Per-channel logo (SVG) | `https://www.raiplaysound.it<currentItem.channel.logo_svg>` | none | `*` | (URL embedded in onAir response) |

All endpoints return `access-control-allow-origin: *` with no auth requirement.

**`palinsesto_url` mapping** (from `dirette.json`):

| Channel name (onAir) | `palinsesto_url` | Notes |
|---|---|---|
| `Rai Radio 1` | `rai-radio-1` | |
| `Rai Radio 2` | `rai-radio-2` | |
| `Rai Radio 3` | `rai-radio-3` | |
| `Rai Radio 3 Classica` | `rai-radio-3-classica` | catalog: RAI Radio Classica |
| `Rai Isoradio` | `rai-isoradio` | |
| `Rai Radio GR Parlamento` | `rai-radio-gr-parlamento` | name mismatch vs dirette (accent/case) — normalise |
| `Rai Radio Tutta Italiana` | `rai-radio-tutta-italiana` | |
| `Rai Radio Techete` | `rai-radio-techete` | name mismatch (accent on `è`) — normalise |

### Response shape — `onAir.json`

```json
{
  "on_air": [
    {
      "channel": "Rai Radio 1",
      "currentItem": {
        "id": "ContentItem-51d05333-...",
        "name": "INVIATO SPECIALE",
        "episode_title": "",
        "description": "A cura di Carmen Santoro.",
        "channel": {
          "name": "Rai Radio 1",
          "logo": "/dl/components/img/sound/loghi/logo-rairadio1-transparent.png",
          "logo_svg": "/assets/img/canali/logo-rairadio1-transparent.svg"
        },
        "date": "09/05/2026",
        "hour": "08:30",
        "duration": "01:00:00",
        "image": "/dl/img/2025/06/05/1749110373725_Inviato%20Speciale%20-%202048x2048.jpg",
        "images": {
          "square": "/dl/img/2025/06/05/1749110373725_Inviato%20Speciale%20-%202048x2048.jpg",
          "landscape": "/dl/img/2021/11/23/1637626693141_2048x1152.jpg"
        },
        "program": {
          "name": "Inviato Speciale",
          "path_id": "/programmi/inviatospeciale.json",
          "weblink": "/programmi/inviatospeciale"
        },
        "start_date": "2026-05-09T06:30:00+0000",
        "end_date":   "2026-05-09T07:30:00+0000",
        "time_interval": "08:30 - 09:30"
      },
      "nextItem": {
        "name": "GR 1",
        "hour": "10:30",
        ...
      }
    }
  ]
}
```

**Key field mappings:**
- Channel lookup → `on_air[i].channel` (string, matches `dirette.json` `channel.name` with
  Unicode normalisation — two channels have accent/capitalisation differences)
- Programme name → `currentItem.name` (all-caps in feed; apply `titleCase` before display)
- Programme subtitle → `currentItem.description` (presenter/editor credits)
- Programme art (per-show cover) → `https://www.raiplaysound.it` + `currentItem.image`
  or `currentItem.images.square` — 2048×2048 JPEGs served with `CORS: *`
- Programme start/end → `currentItem.start_date` / `currentItem.end_date` — ISO 8601 UTC
  (`+0000`); these are the timestamps to use for "is this still current?" logic
- Per-channel logo SVG → `https://www.raiplaysound.it` + `currentItem.channel.logo_svg`
  (e.g. `/assets/img/canali/logo-rairadio1-transparent.svg`)
- Next programme → `on_air[i].nextItem` (same shape as `currentItem`)

**No track-level (artist/title) data.** All RAI radio channels are primarily
talk / news / programme-based. The `onAir.json` endpoint is a programme schedule
snapshot, not a music playlist endpoint. There is no per-track artist/title or album
art in the response.

### Response shape — `dirette.json`

Contains 15 live channel cards with rich metadata including `audio.url`
(a relinker URL resolving to the actual HLS/MP3 stream), per-channel logos,
and the `palinsesto_url` needed to build schedule endpoint URLs. This endpoint
is useful for initial setup (building the `palinsesto_url` map) but is not needed
at poll time once the mapping is embedded in `metadataUrl`.

### Wirable today?

⚠️ **partial — programme-level only.** No track-level artist/title data is available
from any RAI endpoint (RAI channels broadcast primarily news, talk, and curated
programming without a public "now playing track" feed). The `onAir.json` endpoint
is wirable for programme name + cover art + next-programme info. This is similar to
the `fetchSrMetadata` (SR, programme-level only) and `fetchRadioBremenMetadata`
(Radio Bremen, programme-level only) patterns.

CORS is open on all endpoints — no proxy needed.

Cover art: ✅ per-programme artwork available (2048×2048 JPEGs, relative paths,
`CORS: *`). This is a significant improvement over the current generic favicon
(`raiplaysound.it/assets/img/icons/apple/apple-touch-icon.png`) used by all
RAI stations in `data/stations.yaml`.

Per-channel logos: ✅ per-channel SVG logos available via
`/assets/img/canali/logo-rai<channel>-transparent.svg`. These are real
channel-specific logos (Radio 1, Radio 2, etc.), replacing the generic apple-touch-icon.

### Suggested fetcher

New `fetchRaiMetadata` in `src/builtins.ts`. Closest analogues:
`fetchSrMetadata` (programme-only, no tracks) and `fetchRadioBremenMetadata`
(programme-only, cover art from response).

Pattern:
1. Single fetch to `https://www.raiplaysound.it/palinsesto/onAir.json` (no proxy — CORS open).
2. `station.metadataUrl` stores the channel display name as it appears in `on_air[].channel`
   (e.g. `"Rai Radio 1"`). Use Unicode-normalised comparison (`.normalize('NFC').toLowerCase()`)
   to handle the two mismatched channel names (GR Parlamento, Techete).
3. Find the matching `on_air` entry. If `currentItem` is absent or stale (`end_date < now`),
   return `null`.
4. Extract `currentItem.name` → `titleCase(name)` as programme title.
   `currentItem.description` → programme subtitle (presenter/credit line).
5. Build cover URL: `"https://www.raiplaysound.it" + currentItem.images.square` (or `.image`).
   The images are 2048×2048 — pass the URL through as-is; the UI already handles large covers.
6. Return `{ track: undefined, raw: '', program: { name, subtitle }, coverUrl }`.

Since the single endpoint covers all 15 channels, a single fetch per poll cycle returns
data for all RAI stations simultaneously — consider caching the response for 30 s and
sharing across fetcher invocations (same pattern opportunity as FFH's single-endpoint design).

Register as `rai` in `FETCHERS_BY_KEY`. A schedule fetcher could also be built using the
`/palinsesto/app/<palinsesto_url>/giorni.json` endpoint for multi-day EPG data.

### Notes

- The `onAir.json` response covers **all 15 channels** in one ~50 KB payload. Fetching
  it once and sharing the result across all RAI station poll cycles is strongly recommended
  to avoid multiplying requests.
- Programme names arrive in ALL-CAPS (e.g. `"INVIATO SPECIALE"`). Apply `titleCase` before
  display (matching `fetchMdrMetadata`, `fetchCroMetadata` etc.).
- Two channels have naming mismatches between `onAir.json` and `dirette.json`:
  `"Rai Radio GR Parlamento"` vs `"Rai Gr Parlamento"`, and `"Rai Radio Techete"` vs
  `"Rai Radio Techetè"`. The fetcher should use `currentItem.channel.name` (embedded
  in the response) or Unicode-normalised channel string matching.
- `start_date` / `end_date` are ISO 8601 UTC with `+0000` offset — no timezone conversion
  needed. `Date.parse()` handles this format directly.
- The `hour` field in the response is Italian local time (CET/CEST) — use `start_date` for
  all time comparisons.
- Per-channel SVG logos (`/assets/img/canali/logo-rai<channel>-transparent.svg`) are
  accessible with CORS and could be used as `favicon` overrides in `stations.yaml`,
  replacing the current generic apple-touch-icon. E.g. Radio 1:
  `https://www.raiplaysound.it/assets/img/canali/logo-rairadio1-transparent.svg`
- `dirette.json` also exposes `audio.url` relinker URLs
  (`https://mediapolis.rai.it/relinker/relinkerServlet.htm?cont=<id>`) — not needed
  for the metadata fetcher but could be used to verify/update stream URLs if the
  direct `icestreaming.rai.it` endpoints ever move.
- No rate-limit headers observed. The worker polls `onAir.json` on a 3-minute timer
  (`Wt(18e4)` = 180,000 ms). A 60–90 s poll cadence is fine given this is
  programme-level data (show lengths are typically 30–90 minutes).
- ToS: RAI is Italy's national public broadcaster. No explicit API ToS; endpoints are
  publicly served without authentication and are called by every raiplaysound.it visitor.
  Reasonable polling cadence is appropriate.
