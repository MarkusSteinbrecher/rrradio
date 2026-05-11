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

---

## radio-france — Radio France (FR)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | Channel ID | Recommended format |
|---|---|---|---|
| France Inter | `fetcher-todo` | `1` | `inter_player` |
| France Info | `fetcher-todo` | `2` | `info_player` |
| France Musique | `fetcher-todo` | `4` | `musique_player` |
| France Culture | `fetcher-todo` | `5` | `culture_player` |
| Mouv' | `fetcher-todo` | `6` | `mouv_player` |
| FIP (main) | `fetcher-todo` | `7` | `fip_extended` |
| FIP Rock | `fetcher-todo` | `64` | `fip_extended` |
| FIP Jazz | `fetcher-todo` | `65` | `fip_extended` |
| FIP Groove | `fetcher-todo` | `66` | `fip_extended` |
| FIP Monde | `fetcher-todo` | `69` | `fip_extended` |
| FIP Nouveautés | `fetcher-todo` | `70` | `fip_extended` |
| FIP Reggae | `fetcher-todo` | `71` | `fip_extended` |
| FIP Electro | `fetcher-todo` | `74` | `fip_extended` |
| FIP Pop | `fetcher-todo` | `78` | `fip_extended` |
| FIP Metal | `fetcher-todo` | `77` | `fip_extended` |

Note: IDs 11–50 are France Bleu regional stations (not in rrradio catalog). IDs 75 (`Mouv' 100% Mix`)
and 77/78 (`FIP Metal`/`FIP Pop`) are bonus sub-channels. `fip_extended` is the richest format for
music channels; talk stations (`inter_player`, `culture_player`, `info_player`, `mouv_player`) use
their own format but any format works — the `musique_player` format additionally includes presenter
credits in `firstLine`.

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing (music — FIP family) | `https://api.radiofrance.fr/livemeta/live/{id}/fip_extended` | none | `*` | `data/metadata-discovery/radio-france-fip-now-playing.json` |
| Now-playing (programme — France Inter) | `https://api.radiofrance.fr/livemeta/live/{id}/inter_player` | none | `*` | `data/metadata-discovery/radio-france-inter-now-playing.json` |
| Now-playing (programme — France Musique) | `https://api.radiofrance.fr/livemeta/live/{id}/musique_player` | none | `*` | `data/metadata-discovery/radio-france-musique-now-playing.json` |
| Now-playing (programme — France Info) | `https://api.radiofrance.fr/livemeta/live/{id}/info_player` | none | `*` | `data/metadata-discovery/radio-france-info-now-playing.json` |
| Now-playing (programme — FIP sub-channels, compact) | `https://api.radiofrance.fr/livemeta/live/{id}/fip_player` | none | `*` | `data/metadata-discovery/radio-france-fip-rock-now-playing.json` |
| Cover art image | `https://www.radiofrance.fr/pikapi/images/{uuid}/{size}` | none | none (img-only) | (UUID embedded in now-playing response) |
| GraphQL API (Open API) | `https://openapi.radiofrance.fr/v1/graphql` | `x-token` required | `*` | ❌ blocked (401 without token) |

**CORS:** `api.radiofrance.fr` returns `access-control-allow-origin: *` — directly callable
from the browser, no worker proxy needed.

**pikapi images:** No CORS headers on `www.radiofrance.fr/pikapi/images/…`. Safe for `<img>` src
use, but not for `fetch()`. Use URL directly in `coverUrl` — the rrradio UI renders covers as `<img>`.
Image sizes available: `200x200`, `400x400`, `132x132`, `300x169`, `2048` (original). Recommended: `400x400`.

**delayToRefresh:** The `fip_extended` response includes a `delayToRefresh` field in milliseconds
(values observed: 30 000–180 000 ms). This is the broadcaster's own polling cadence hint.

### Channel ID discovery

The channel numeric ID and format string together identify the endpoint. The format string can
be any valid value from the allowlist — the channel ID is the primary discriminant. Both are
embedded in the URL: `…/livemeta/live/{id}/{format}`. The wrong format for a station returns
either `errCode: e400` (Bad Request) or valid data with a different programme context.

Channel IDs were confirmed by matching `firstLinePath` in responses against known station paths
(e.g. `franceinter/podcasts/…`, `franceinfo/podcasts/…`, `franceculture/podcasts/…`).

### Response shapes

#### `fip_extended` — FIP family (music stations)

```json
{
  "prev": [
    {
      "title": "Le direct",
      "interpreters": null,
      "album": null,
      "label": null,
      "cover": null,
      "musicalKind": null,
      "startTime": null,
      "endTime": null
    }
  ],
  "now": {
    "title": "Emotion",
    "interpreters": "Destiny's Child & Beyonce",
    "album": "Survivor",
    "label": "COLUMBIA",
    "cover": "58823f41-f06a-44be-aee7-fcf7374116bc",
    "musicalKind": "Soul / RnB ",
    "startTime": 1778310418,
    "endTime": 1778310653
  },
  "next": [
    {
      "title": "Love t.k.o.",
      "interpreters": "Teddy Pendergrass",
      "album": "Greatest hits",
      "label": "PHILADELPHIA INTERNATIONAL RECORDS",
      "cover": "27ef8330-8c98-480a-bf7d-9b96f693b815",
      "musicalKind": "Soul / RnB ",
      "startTime": 1778310652,
      "endTime": 1778310871
    }
  ],
  "delayToRefresh": 180000
}
```

**Key field mappings (music channels):**
- Track title → `now.title`
- Artist → `now.interpreters` (single string, may contain `&` for multi-artist)
- Album → `now.album`
- Record label → `now.label`
- Genre → `now.musicalKind` (e.g. `"Soul / RnB "` — note trailing space; trim before use)
- Cover UUID → `now.cover`; build URL as `https://www.radiofrance.fr/pikapi/images/{uuid}/400x400`
- Start/end → `now.startTime` / `now.endTime` — **Unix seconds** (not milliseconds)
- Next track → `next[0]` (same shape as `now`, available for lookahead)
- Polling cadence hint → `delayToRefresh` (milliseconds)

When `now.title` is null or `now.interpreters` is null but `now.title` is not null, the station
is in a programme segment (jingle, live set, programme). When `now.cover` is null, skip cover art.

#### `inter_player` / `culture_player` / `info_player` / `mouv_player` — talk/news stations

```json
{
  "prev": [{ "firstLine": "Le direct", "secondLine": "Le direct", "cover": "...", "startTime": null, "endTime": null, "contact": null }],
  "now": {
    "firstLine": "Le 6/9",
    "firstLinePath": "franceinter/podcasts/le-6-9",
    "firstLineUuid": "c3c143f7-f54c-403a-b206-554091e6c66a",
    "firstLineConceptUuid": "c3c143f7-f54c-403a-b206-554091e6c66a",
    "secondLine": "Le journal de 9h - Le journal de 09h00 du samedi 09 mai 2026",
    "secondLinePath": "franceinter/podcasts/le-journal-de-9h",
    "secondLineUuid": "4ebdaf30-16bb-11e1-a6ab-842b2b72cd1d",
    "cover": "369c09d6-3bae-4e2f-ad31-c838a0dfa945",
    "startTime": 1778299200,
    "endTime": 1778310804,
    "contact": [{ "type": "mail", "url": "6-9duweekend@radiofrance.com", "title": null }]
  },
  "next": [{ ... same shape ... }],
  "delayToRefresh": 230000
}
```

**Key field mappings (talk/programme stations):**
- Programme name → `now.firstLine` (show title)
- Programme subtitle → `now.secondLine` (episode title or bulletin name)
- Programme cover → `now.cover` UUID → `https://www.radiofrance.fr/pikapi/images/{uuid}/400x400`
- Programme start/end → `now.startTime` / `now.endTime` — **Unix seconds**
- Contact → `now.contact[0].url` (editorial email; not useful for UI)

The `musique_player` format adds presenter credit to `firstLine` as `"Programme par Présentateur"`.

#### `fip_player` — compact format for FIP sub-channels

```json
{
  "now": {
    "firstLine": "FIP Rock",
    "secondLine": "Te Quiero Igual",
    "secondLineSongUuid": "0cfe2bae-8233-42d4-99c6-7813fbd44f63",
    "thirdLine": "Novedades Carminha",
    "thirdLineSongUuid": "0cfe2bae-8233-42d4-99c6-7813fbd44f63",
    "cover": "26190730-8121-43a7-ab82-0189c8740b06",
    "startTime": 1778310356,
    "endTime": 1778310535
  }
}
```

Fields: `secondLine` = track title, `thirdLine` = artist, `cover` = UUID. Less rich than
`fip_extended` (no album, label, genre). **Use `fip_extended` for all FIP channels instead.**

### Track history

The livemeta API always returns exactly three items: `prev[0]` (most recently completed track),
`now` (current track), `next[0]` (upcoming track). `prev[0]` on first load is typically
`{"title": "Le direct", …}` (a placeholder), not a real previous track. There is **no multi-track
history endpoint** discoverable from the browser-side API. The FIP "Titres diffusés" page
renders client-side from the same livemeta API; it only shows current/next, not a scrollable
history. The GraphQL API (`openapi.radiofrance.fr/v1/graphql`) would support richer queries
but requires an `x-token` API key — not publicly accessible.

### Wirable today?

| Channel family | Track | Programme | Cover art | Verdict |
|---|---|---|---|---|
| FIP main + all sub-channels | ✅ wire-now — `fip_extended` gives title + artist + album + label + genre | ✅ via `fip_player` firstLine | ✅ pikapi UUID → `<img>` src | **Wire-now — richest of all European public broadcasters** |
| France Inter | ❌ no track API (talk radio) | ✅ wire-now — `inter_player` gives show + episode | ✅ pikapi cover | Wire programme-only |
| France Culture | ❌ no track API (talk radio) | ✅ wire-now — `culture_player` | ✅ pikapi cover | Wire programme-only |
| France Musique | ⚠️ partial — classical pieces do appear in `fip_extended` when using ID 4, but `musique_player` is programme-level | ✅ wire-now — `musique_player` | ✅ pikapi cover | Wire programme-only; revisit track wiring |
| France Info | ❌ no track API (24/7 news) | ✅ wire-now — `info_player` | ✅ pikapi cover | Wire programme-only |
| Mouv' | ⚠️ has music but `mouv_player` returns programme-level; `fip_extended` returns `null` for ID 6 | ✅ wire-now — `mouv_player` | ✅ pikapi cover | Wire programme-only; FIP-style track wiring possible if format confirmed |

**No proxy needed for any channel.** All `api.radiofrance.fr` endpoints have `CORS: *`.

### Suggested fetcher

New `fetchRadioFranceMetadata` in `src/builtins.ts`. The broadcaster has two distinct response
shapes gated by which format string is used:

**Shape A — music (FIP family):** `fip_extended` format, fields `now.title` / `now.interpreters` /
`now.album` / `now.cover`. Closest analogues: `fetchCroMetadata` (structured JSON, now/next shape)
and `fetchSwrMetadata` (track + programme + cover in one response).

**Shape B — programme (France Inter/Culture/Info/Mouv'):** `*_player` format, fields
`now.firstLine` / `now.secondLine` / `now.cover`. Closest analogues: `fetchSrMetadata` and
`fetchRadioBremenMetadata` (programme-only, no tracks).

Recommended implementation:
1. `station.metadataUrl` = `https://api.radiofrance.fr/livemeta/live/{id}/{format}` — the full
   endpoint URL including the numeric ID and format string. This keeps the fetcher generic and lets
   each station declare its own format.
2. Fetch with `cache: 'no-store'`; no proxy.
3. Branch on response shape: if `now.title` is defined → Shape A (music); else → Shape B (programme).
4. Shape A: return `{ artist: now.interpreters, track: now.title, album: now.album, coverUrl }`.
5. Shape B: return `{ track: undefined, raw: '', program: { name: now.firstLine, subtitle: now.secondLine } }`.
6. Cover URL: `https://www.radiofrance.fr/pikapi/images/${now.cover}/400x400` (when `now.cover` is a UUID string).
7. `delayToRefresh` (ms) can inform the polling interval — use `Math.max(delayToRefresh, 15_000)`.

`station.metadataUrl` examples:
```
FIP main:       https://api.radiofrance.fr/livemeta/live/7/fip_extended
FIP Rock:       https://api.radiofrance.fr/livemeta/live/64/fip_extended
France Inter:   https://api.radiofrance.fr/livemeta/live/1/inter_player
France Culture: https://api.radiofrance.fr/livemeta/live/5/culture_player
France Musique: https://api.radiofrance.fr/livemeta/live/4/musique_player
France Info:    https://api.radiofrance.fr/livemeta/live/2/info_player
Mouv':          https://api.radiofrance.fr/livemeta/live/6/mouv_player
```

Register as `radio-france` in `FETCHERS_BY_KEY`. A schedule fetcher is not needed since `next[0]`
(the upcoming track/programme) is already embedded in the livemeta response.

### Notes

- `now.startTime` / `now.endTime` are **Unix seconds** (not milliseconds). Multiply by 1000 for
  `Date.now()` comparisons.
- `delayToRefresh` is the broadcaster's explicit polling cadence hint in **milliseconds**. Observed
  values: 30 000 ms (FIP live, active track), 90 000–180 000 ms (FIP between tracks), 3 600 000 ms
  (France Musique, long programme). Use `Math.min(delayToRefresh, 30_000)` for music channels to
  stay responsive; for talk channels 60–90 s is fine.
- `now.interpreters` is a free-form string (may contain `&` or `,` for multi-artist). No separate
  array structure — treat as a single display string. It can be `null` during programme/jingle segments.
- `now.cover` is a UUID string (or `null`). The `pikapi` service at
  `https://www.radiofrance.fr/pikapi/images/{uuid}/{size}` serves it as WebP. No CORS on the image
  CDN — use only in `<img>` src, not in `fetch()`. Sizes: `200x200`, `400x400` confirmed working.
- The `fip_rds` format returns all-caps combined string `"TRACK - ARTIST (YEAR) - FIP"` in
  `now.firstLine`, plus raw `songId` and `stepId` UUIDs — designed for RDS display hardware, not
  useful for rrradio.
- The `openapi.radiofrance.fr/v1/graphql` endpoint would provide richer data (multi-track song
  history, podcast metadata, programme schedule depth). It requires an `x-token` API key obtained
  via `https://openapi.radiofrance.fr` developer registration. Not blocked — Radio France invites
  API consumers — but needs a registered token. The free livemeta API is sufficient for rrradio's
  needs.
- No rate-limit headers observed. France Bleu regional stations (IDs 11–50) also work with the
  same livemeta endpoint — those stations are not in the rrradio catalog but the fetcher supports
  them for free.
- ToS: Radio France is France's national public broadcaster. The livemeta API is served publicly,
  called by every radiofrance.fr visitor. No explicit API ToS for the livemeta endpoint. The
  `openapi.radiofrance.fr` developer API has a formal ToS via the portal. The livemeta endpoint
  is not the portal API.

---

## wdr — Westdeutscher Rundfunk (DE)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | Radiotext slug | Has track data? |
|---|---|---|---|
| 1Live | `icy-only` | `1live` | yes (music station) |
| 1Live Diggi | `icy-only` | `1live_diggi` | unreliable (often promo text) |
| WDR 2 | `icy-only` | `wdr2` | yes (music/talk, track when music plays) |
| WDR 3 | `icy-only` | `wdr3` | yes (classical, "Composer - Work" format) |
| WDR 4 | `icy-only` | `wdr4` | partial (track when music plays; programme otherwise) |
| WDR 5 | `icy-only` | `wdr5` | no (talk station; returns programme promo text) |
| WDR COSMO | `icy-only` | `fhe` | partial (track when music plays; presenter otherwise) |
| KiRaKa (Die Maus) | `icy-only` | `kiraka` | no (returns phone-in promo text) |

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing (track or programme text) | `https://www.wdr.de/radio/radiotext/streamtitle_<slug>.txt` | none | `*` | `data/metadata-discovery/wdr-radiotext-1live.txt` |
| WDR 2 radiotext | `https://www.wdr.de/radio/radiotext/streamtitle_wdr2.txt` | none | `*` | `data/metadata-discovery/wdr-radiotext-wdr2.txt` |
| WDR 3 radiotext | `https://www.wdr.de/radio/radiotext/streamtitle_wdr3.txt` | none | `*` | `data/metadata-discovery/wdr-radiotext-wdr3.txt` |
| COSMO (fhe) radiotext | `https://www.wdr.de/radio/radiotext/streamtitle_fhe.txt` | none | `*` | `data/metadata-discovery/wdr-radiotext-cosmo.txt` |
| WDR 5 radiotext | `https://www.wdr.de/radio/radiotext/streamtitle_wdr5.txt` | none | `*` | `data/metadata-discovery/wdr-radiotext-wdr5.txt` |
| 1Live Diggi radiotext | `https://www.wdr.de/radio/radiotext/streamtitle_1live_diggi.txt` | none | `*` | `data/metadata-discovery/wdr-radiotext-1live-diggi.txt` |
| Playlist HTML fragment (1Live) | `https://www1.wdr.de/radio/player/einslive-playlist100~radioplayerPlaylist.html` | none | **none** | (no capture — not usable) |
| Playlist HTML fragment (WDR 2) | `https://www1.wdr.de/radio/wdr2/musik/playlist/playlist-wdrzwei-100~radioplayerPlaylist.html` | none | **none** | (no capture — not usable) |

**NDR-style pattern check:** `https://www1.wdr.de/public/radioplaylists/<slug>.json` → HTTP 404 for all slugs tried. WDR does **not** share NDR's playlist endpoint pattern.

**ARD Audiothek GraphQL (`api.ardaudiothek.de/graphql`):** WDR channels are present as `permanentLivestreams` (1Live ID: 42620604, WDR 2: 42950274, WDR 3: 42748798, etc.) but the `current` and `next` fields are `null` for all WDR channels. The ARD Audiothek does not surface WDR's now-playing data.

**Slug mapping** (from `https://www.wdr.de/radio/radiotext/` directory):

| Station | Radiotext slug |
|---|---|
| 1Live | `1live` |
| 1Live Diggi | `1live_diggi` |
| WDR 2 | `wdr2` |
| WDR 3 | `wdr3` |
| WDR 4 | `wdr4` |
| WDR 5 | `wdr5` |
| WDR COSMO | `fhe` |
| KiRaKa / Die Maus | `diemaus` (also: `kiraka` returns 200) |
| WDR Event | `event` |

### Response shape

The radiotext endpoint returns a single UTF-8 (actually `iso-8859-1`) plain-text line with no JSON wrapper.

**When music is playing:**
```
Natasha Bedingfield - Unwritten
Shaboozey - A Bar Song (Tipsy)
Wolfgang Amadeus Mozart - Konzert Es-Dur, KV 271
```
Format is `<Artist> - <Track>`. The separator is always ` - ` (space-hyphen-space). The WDR 3 classical channel uses `<Composer> - <Work Title (key/opus info)>` which is the same format but the "artist" is the composer.

**When no music is playing (news, talk, promo):**
```
WDR 4 am Samstag mit Steffi Schmitz
WDR 5 Hotline: 0221-56789 555
Infos und Playlist auch im Netz: 1LIVEDIGGI.de
```
These don't contain ` - ` (the hyphen is only in music entries). The fetcher should use the presence of ` - ` as the guard: if the text contains no ` - `, treat as programme/promo and return `null` for track (let ICY fallback run).

**Cache-Control:** `max-age=10` (seconds). This is WDR's natural poll cadence hint — identical to NDR's `nextVisitIn: "10"`.

**Character encoding:** `Content-Type: text/plain; charset=iso-8859-1`. The content often contains `\xfc` (`ü`), `\xe4` (`ä`), `\xf6` (`ö`) in raw bytes — the fetcher must decode as `iso-8859-1` (or do `TextDecoder('iso-8859-1')` on the response bytes). Browsers' default `Response.text()` uses UTF-8 and will misread umlauts (they appear as `?` or `ü` garbled). Use `response.arrayBuffer()` + `new TextDecoder('iso-8859-1').decode(...)`.

**No cover art.** The radiotext endpoint carries only the text string. No image URL is embedded. No separate cover endpoint was found.

**No programme schedule.** The WDR EPG is served as Sophora CMS HTML fragments (`~radioplayerjetztimprogramm.html`) with no CORS — not usable from the browser without a proxy. The programme name sometimes appears in the radiotext when no music is playing.

### Wirable today?

| Channel | Track | Programme | Verdict |
|---|---|---|---|
| 1Live | ✅ wire-now — `?` test selects track vs promo | ❌ no structured EPG API | wire-now for track |
| WDR 2 | ✅ wire-now — same ` - ` guard | ❌ no structured EPG API | wire-now for track |
| WDR 3 | ✅ wire-now — classical `Composer - Work` | ❌ no structured EPG API | wire-now for classical track |
| WDR 4 | ✅ wire-now — ` - ` guard filters music vs talk | ❌ | wire-now for track |
| WDR COSMO | ✅ wire-now — ` - ` guard | ❌ | wire-now for track |
| 1Live Diggi | ⚠️ partial — promo text blocks most polls | ❌ | low value; same fetcher applies |
| WDR 5 | ❌ talk station — radiotext never contains ` - ` track | ❌ | stays `icy-only` |
| KiRaKa | ❌ kids station — radiotext is always phone promo | ❌ | stays `icy-only` |

Overall: ✅ **wire-now** for 5 of 8 channels. HTTPS-only, `CORS: *`, no auth, plain-text with a reliable ` - ` track guard. No cover art or programme schedule available via this endpoint.

### Suggested fetcher

New `fetchWdrMetadata` in `src/builtins.ts`. This is the **simplest possible fetcher** — simpler than NDR (no JSON parsing, no cover UUID) but requires `iso-8859-1` decoding.

Pattern:
1. `station.metadataUrl` stores the full radiotext URL:
   `https://www.wdr.de/radio/radiotext/streamtitle_<slug>.txt`
2. Fetch with `cache: 'no-store'`; no proxy needed (CORS open).
3. Decode response as `iso-8859-1`:
   ```ts
   const buf = await res.arrayBuffer();
   const text = new TextDecoder('iso-8859-1').decode(buf).trim();
   ```
4. Apply ` - ` guard:
   ```ts
   const sep = text.indexOf(' - ');
   if (sep === -1) return null;  // programme/promo text, not a track
   const artist = text.slice(0, sep).trim();
   const track = text.slice(sep + 3).trim();
   ```
5. No cover art. No programme info. Return `{ artist, track, raw: text }`.
6. No schedule fetcher needed (no EPG API found).

Register as `wdr` in `FETCHERS_BY_KEY`. Closest existing analogue: `fetchDlfNovaMetadata` (single-fetch, flat text, no cover, no schedule). However DLF Nova returns JSON; WDR is raw text — there's no precedent for a raw-text fetcher in the codebase. A new pattern must be added.

Note: the character encoding issue makes `fetchWdrMetadata` slightly more complex than other fetchers. The `TextDecoder('iso-8859-1')` approach is the correct fix. Alternatively, the fetcher can return the raw string without umlaut correction and rely on WDR updating to UTF-8 (which they have not done as of 2026-05-09).

### Notes

- **iso-8859-1 encoding**: All WDR radiotext files are served with `charset=iso-8859-1`. Umlauts (ä, ö, ü, ß) will be garbled if the fetcher uses the default `response.text()` (which assumes UTF-8). Use `response.arrayBuffer()` + `new TextDecoder('iso-8859-1').decode(...)`.
- **No JSON API found**: WDR's CMS (Sophora) renders all playlist/EPG data server-side. The only machine-readable now-playing signal is the radiotext `.txt` file. The Sophora HTML playlist fragments (`~radioplayerPlaylist.html`) are CORS-blocked and HTML-only.
- **NDR pattern (www.ndr.de/public/radioplaylists/<slug>.json) does not apply to WDR.** That path returns HTTP 404 on www1.wdr.de.
- **ARD Audiothek GraphQL** lists WDR channels but the `current`/`next` now-playing fields are all `null` for WDR — that API does not surface WDR metadata.
- **Playlist HTML fragments** at `~radioplayerPlaylist.html` are polled by the WDR web player via jQuery `$.ajax` but they return HTML (not JSON) and have no `Access-Control-Allow-Origin` header. They cannot be used from rrradio's browser context without a proxy.
- **WDR 4 is music-heavy** (Schlager, Oldies) and the radiotext reliably returns "Artist - Track" during music segments. Worth wiring.
- **COSMO slug is `fhe`** — not `cosmo`. The `fhe` slug (likely "Funkhaus Europa", the predecessor brand) is the official radiotext key for COSMO.
- **KiRaKa slug is `kiraka`** — confirmed 200 OK, but content is always the Maus phone-in promo, never a track. The `diemaus` slug also exists (returns identical content). No track data available.
- **`max-age=10`** matches NDR's 10-second poll cadence hint. The rrradio fetcher should respect this.
- **ToS**: WDR is a German public broadcaster (ARD). No explicit API ToS for the radiotext endpoint. It is served publicly from `www.wdr.de` without authentication, called by every wdr.de radio player visitor. Reasonable polling cadence (10–30 s) is appropriate.

---

## sveriges-radio — Sveriges Radio (SE)

Investigated: 2026-05-09.

### Channel-ID mapping

| Channel | ID | Notes |
|---|---|---|
| P1 | 132 | National talk/news |
| P2 (Språk och musik) | 163 | Classical + language |
| P2 Musik | 2562 | Classical music stream |
| P3 | 164 | Pop / youth |
| P4 Stockholm | 701 | Regional (most-listened P4 variant) |
| P4 Göteborg | 212 | Regional |
| P4 Malmöhus | 207 | Regional |
| P4 Norrbotten | 209 | Regional |
| P4 Plus | 4951 | Digital extra |
| P6 | 166 | International / minority languages |
| SR Sápmi | 224 | Sami-language service |
| Sveriges Radio Finska | 226 | Finnish-language service |
| P3 Din gata | 2576 | Digital pop sub-channel |
| Ekot sänder direkt | 4540 | News live |

Full channel list (54 entries including SR Extra01–15) available in `data/metadata-discovery/sveriges-radio-channels.json`.

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing (current + previous song) | `https://api.sr.se/api/v2/playlists/rightnow?channelid=<id>&format=json` | none | `*` | `data/metadata-discovery/sveriges-radio-playlist-rightnow-p3.json` |
| Now-playing P2 Musik (classical, richer) | `https://api.sr.se/api/v2/playlists/rightnow?channelid=2562&format=json` | none | `*` | `data/metadata-discovery/sveriges-radio-playlist-rightnow-p2musik.json` |
| Programme now/prev/next (schedule episode) | `https://api.sr.se/api/v2/scheduledepisodes/rightnow?channelid=<id>&format=json` | none | `*` | `data/metadata-discovery/sveriges-radio-scheduledepisodes-rightnow-p1.json` |
| Full-day schedule | `https://api.sr.se/api/v2/scheduledepisodes?channelid=<id>&format=json&date=YYYY-MM-DD` | none | `*` | `data/metadata-discovery/sveriges-radio-schedule-p3.json` |
| Channel list | `https://api.sr.se/api/v2/channels?format=json&pagination=false` | none | `*` | `data/metadata-discovery/sveriges-radio-channels.json` |
| Track history (`/playlists`) | `https://api.sr.se/api/v2/playlists?channelid=<id>&format=json` | none | `*` | 500 Server Error — requires `startdatetime` param; exact format unclear |

### Response shape

#### `/playlists/rightnow` (music channels)

```
playlist.song           — current track (absent on talk/news channels or between tracks)
  .title                → track title
  .artist               → artist name
  .composer             → composer (especially classical — P2/P2 Musik)
  .conductor            → conductor (P2 Musik, e.g. "Herbert von Karajan")
  .albumname            → album
  .recordlabel          → label
  .producer             → ensemble (P2 Musik, e.g. "Berlins filharmoniker")
  .starttimeutc         → "/Date(1778315850000)/" — Unix ms wrapped, needs stripping
  .stoptimeutc          → same format
playlist.previoussong   — same shape as .song, always present when a song just finished
playlist.channel.id     → numeric channel id
playlist.channel.name   → channel name string
```

Note: `playlist.song` is absent when nothing is currently playing (between tracks, news segments). P1/P3 often show only `previoussong` during talk segments. Timestamps use Microsoft `/Date(ms)/` format; parse with `parseInt(s.replace(/^\/Date\((\d+)\)\/$/, '$1'), 10)`.

#### `/scheduledepisodes/rightnow`

```
channel.currentscheduledepisode  — current programme slot
  .episodeid
  .title                → programme episode title
  .subtitle             → episode subtitle (e.g. "med Branne Pavlovic och Jens Falk")
  .description          → long description
  .starttimeutc         → "/Date(ms)/" format
  .endtimeutc           → same
  .program.id           → programme series id
  .program.name         → series name
  .socialimage          → square cover art URL (CDN: static-cdn.sr.se)
channel.previousscheduledepisode — same shape
channel.nextscheduledepisode     — same shape
```

#### `/scheduledepisodes` (full-day)

Array under `schedule[]`. Each episode: `episodeid`, `title`, `description`, `starttimeutc`, `endtimeutc`, `program.{id,name}`, `imageurl`, `imageurltemplate`, `channel.{id,name}`. The `imageurltemplate` is the base URL without preset; append `?preset=api-default-square` for a square crop.

### Wirable today?

✅ **Both endpoints are directly wirable** — HTTPS, CORS `*`, no auth, no proxy needed. This is among the most complete broadcaster APIs in the catalog: track + artist + album for music channels, programme cover art via the schedule endpoint, and unusually rich classical metadata (conductor, ensemble, label) on P2 Musik.

### Suggested fetcher

New shape — needs its own `fetchSverigesRadioMetadata` in `src/builtins.ts`.

**Strategy**: fetch both endpoints in parallel (`playlists/rightnow` + `scheduledepisodes/rightnow`). Merge:
- If `playlist.song` present → use `song.title` / `song.artist` as track + artist. For classical channels, fold `conductor` + `albumname` into a program subtitle.
- If `playlist.song` absent → track = undefined; surface `currentscheduledepisode.title` as programme name.
- Use `currentscheduledepisode.socialimage` as `coverUrl` when no per-track cover is available (playlist endpoint has no image URLs; only schedule endpoint returns images).
- Parse `/Date(ms)/` timestamps via `parseInt(s.replace(/^\/Date\((\d+)\)\/$/, '$1'), 10)`.
- `metadataUrl` on each station = bare channel ID (numeric string, e.g. `"132"`). The fetcher derives both endpoint URLs from it. Matches the BBC/FFH pattern.

Closest analogue: `fetchCroMetadata` (ČRo) — parallel now + schedule fetch, merge result.

### Notes

- **`cache-control: public,max-age=60`** on `playlists/rightnow` — poll no faster than 60 s.
- **`cache-control: public,max-age=10`** on `scheduledepisodes/rightnow` — updates faster, but playlist cache constrains effective cadence.
- **`previoussong` only**: when P3/P4 is between songs only `previoussong` appears. Do NOT surface it as "now playing" (it already ended) — return null for track and fall through to programme info.
- **P4 regional**: 22+ P4 regional variants, all unique IDs. Wire Stockholm (701), Göteborg (212), Malmöhus (207) to cover the catalog; others can use `stream-only` or ICY.
- **Talk channels (P1, P6, Ekot)**: `playlist.song` is almost never populated. Programme info from `scheduledepisodes/rightnow` is the only metadata available — still worthwhile.
- **ToS**: SR's public API is documented at `https://api.sr.se/` with an explicit note that it is free for use. No rate-limit headers observed beyond `max-age`. No API key required. Attribution ("Sveriges Radio") per their ToS.

---

## soma-fm — SomaFM (US)

Investigated: 2026-05-09.

### Channels in catalog

| Station | id (slug) | Status before |
|---|---|---|
| SomaFM Groove Salad | `groovesalad` | `stream-only` |
| SomaFM Secret Agent | `secretagent` | `stream-only` |
| SomaFM Underground 80s | `u80s` | `stream-only` |
| SomaFM Space Station Soma | `spacestation` | `stream-only` |
| SomaFM Indie Pop Rocks | `indiepop` | `stream-only` |
| SomaFM Drone Zone | `dronezone` | `stream-only` |

SomaFM publishes 46 channels total (`channels.json`). We carry 6; the slug mapping is 1:1 between the mount segment in our stream URLs and the API slug.

**Slug derivation**: the stream URL mount is `<slug>-<bitrate>-<codec>` (e.g. `groovesalad-128-mp3`). Strip everything from the first `-<digit>` suffix to obtain the API slug. All 6 catalog slugs confirmed present in `channels.json`.

### Endpoints

| What | URL template | Auth | CORS | Cache | Sample |
|---|---|---|---|---|---|
| Song history (per-channel) | `https://somafm.com/songs/<slug>.json` | none | `Access-Control-Allow-Origin: *` | `max-age=10` | `data/metadata-discovery/soma-fm-songs-groovesalad.json`, `soma-fm-songs-secretagent.json` |
| Channel list (all 46 channels) | `https://somafm.com/channels.json` | none | `Access-Control-Allow-Origin: *` | `max-age=20` | `data/metadata-discovery/soma-fm-channels.json` |

No separate "now-playing only" endpoint was found, but `songs[0]` in the per-channel feed is always the most recently started track (descending by `date` unix timestamp). The `channels.json` `lastPlaying` field is a convenience raw string (`"Artist - Title"`) and does not need to be parsed — `songs/<slug>.json` provides the structured data.

### Response shape

**`https://somafm.com/songs/<slug>.json`**

```json
{
  "id": "groovesalad",
  "songs": [
    {
      "title": "I'm the One",
      "artist": "Gold Lounge",
      "album": "Cool Off Chillout Vol. 4",
      "albumArt": "",
      "date": "1778315937"
    },
    ...
  ]
}
```

Field mapping:
- **artist** → `songs[0].artist`
- **track title** → `songs[0].title`
- **album** → `songs[0].album` (present but not surfaced by current `MetadataResult` type)
- **cover art** → `songs[0].albumArt` — **always empty string in observed responses**. No per-track cover art is available from this endpoint.
- **programme / show** → not provided (SomaFM runs automated playlists, no live show schedule)
- **channel art** → `channels.json` → channel entry → `xlimage` (`https://api.somafm.com/logos/512/<slug>512.png`) — channel-level image only, not track-level.
- **track history** → `songs[1..N]` (19 entries observed) — full recent history available in the same response.

The `date` field is a unix timestamp string (seconds, not ms). Current track = `songs[0]`; no time-bracketing logic needed.

**`https://somafm.com/channels.json`**

```json
{
  "channels": [
    {
      "id": "groovesalad",
      "title": "Groove Salad",
      "description": "...",
      "dj": "Rusty Hodge",
      "genre": "ambient|electronic",
      "image": "https://api.somafm.com/img/groovesalad120.png",
      "largeimage": "https://api.somafm.com/logos/256/groovesalad256.png",
      "xlimage": "https://api.somafm.com/logos/512/groovesalad512.png",
      "listeners": "1694",
      "lastPlaying": "Gold Lounge - I'm the One",
      "playlists": [...],
      ...
    }
  ]
}
```

The channel-list endpoint is useful for bootstrapping (channel art, genre, stream URLs) but is not needed for a per-poll now-playing fetcher. The `songs/<slug>.json` endpoint is the right target for polling.

### Wirable today?

✅ **wire-now** — HTTPS, `Access-Control-Allow-Origin: *`, no auth, structured `artist` + `title` + `album` fields, `songs[0]` is current track. No proxy required.

Partial: no per-track cover art (`albumArt` always empty). Channel-level `xlimage` from `channels.json` could be used as a static cover for each station (set once via `favicon` or a `coverUrl` override in YAML), but there is no dynamic per-song art from this API.

### Suggested fetcher

New shape; needs its own `fetchSomaFmMetadata` in `src/builtins.ts`. Closest analogue: `fetchGrrifMetadata` — both are single-channel JSON arrays of recent songs, no time-bracketing needed, `songs[0]` / last-in-array is current.

Sketch:
```ts
// station.metadataUrl = "groovesalad"  (just the slug, not the full URL)
const fetchSomaFmMetadata: MetadataFetcher = async (station, signal) => {
  const slug = station.metadataUrl;
  if (!slug) return null;
  try {
    const res = await fetch(`https://somafm.com/songs/${slug}.json?_=${Date.now()}`, {
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json() as { songs?: Array<{ artist?: string; title?: string; album?: string }> };
    const song = data.songs?.[0];
    if (!song?.title) return null;
    return {
      artist: song.artist || undefined,
      track: song.title,
      raw: `${song.artist ?? ''} - ${song.title}`.trim(),
    };
  } catch {
    return null;
  }
};
```

Set `station.metadataUrl` to the slug string (e.g. `groovesalad`). No full URL needed since the template is uniform. Register as `soma-fm` in `FETCHERS_BY_KEY`.

Once wired, set `metadata: soma-fm` on the broadcaster entry in `broadcasters.yaml`, which will apply to all 6 catalog stations automatically (each already has the correct slug derivable from its `streamUrl`).

### Notes

- **No per-track cover art** — `albumArt` field exists in the schema but is always `""` in current responses. SomaFM does not publish per-track artwork from this API. Channel art (`xlimage`) from `channels.json` is available as a static fallback.
- **`max-age=10`** — the songs endpoint is served with `Cache-Control: max-age=10`. A 15–30 second poll interval in the fetcher respects this cadence.
- **No rate-limit headers** — no `X-RateLimit-*` or `Retry-After` headers observed. SomaFM has published this API publicly for years (visible in `X-SomaVersion: 202110181757`). Standard respectful cadence applies.
- **No show / programme info** — SomaFM channels run algorithmic / DJ-curated playlists, not scheduled programmes. No EPG API exists or is needed.
- **ToS**: SomaFM is a listener-supported internet-only broadcaster that actively publishes this API for third-party integrations. No restrictive ToS found for the songs/channels endpoints. Appropriate to use with reasonable polling cadence.

---

## rte — Raidió Teilifís Éireann (IE)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | stationId (live_stations) | Schedule slug |
|---|---|---|---|
| RTÉ Radio 1 | `fetcher-todo` | 9 | `radio1` |
| RTÉ 2FM | `fetcher-todo` | 1 | `2fm` |
| RTÉ Lyric FM | `fetcher-todo` | 16 | `lyricfm` |
| RTÉ Raidió na Gaeltachta | `fetcher-todo` | 17 | `rnag` |
| RTÉ Gold | `fetcher-todo` | 22 | `gold` |
| RTÉ Pulse | `fetcher-todo` | — (not in live_stations) | `pulse` |
| RTÉ 2XM | `fetcher-todo` | — (not in live_stations) | `2xm` |
| RTÉ Junior | `fetcher-todo` | — (not in live_stations) | `junior` |

### Discovery method

RTÉ's radio pages load an Angular SPA bundle (`/djstatic/dotie/radio/js/angular/web-components-app/main.js`).
The bundle was fetched and grepped for API path strings. Two machine-readable endpoints were
found. The Icecast server at `icecast.rte.ie` was also probed directly via its standard
`/status-json.xsl` path. No track-level JSON API was found after exhaustive probing.

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Live stations (programme-level, 5 channels) | `https://www.rte.ie/radio/live_stations/json` | none | **none** | `data/metadata-discovery/rte-live-stations.json` |
| Programme schedule (per-channel, per-day) | `https://www.rte.ie/radio/<slug>/schedule/<YYYYMMDD>/` | none | **none** | `data/metadata-discovery/rte-schedule-radio1.json` |
| Icecast server status (all mounts) | `https://icecast.rte.ie/status-json.xsl` | none | n/a (server status page) | `data/metadata-discovery/rte-icecast-status.json` |

**No track-level now-playing API found.** Icecast `title` fields are empty strings for all
mounts. The Angular bundle contains no artist/track/cover fields — it is exclusively a
programme schedule widget.

**CORS:** Neither `live_stations/json` nor the schedule endpoint returns
`Access-Control-Allow-Origin`. Both would require the worker proxy for browser-side fetch.

**Channel mapping** from the Angular bundle logos object and `live_stations/json` response:

| Channel | `stationId` | Icecast mount | Schedule slug |
|---|---|---|---|
| RTÉ Radio 1 | 9 | `/radio1` | `radio1` |
| RTÉ 2FM | 1 | `/2fm` | `2fm` |
| RTÉ Lyric FM | 16 | `/lyric` | `lyricfm` |
| RTÉ Raidió na Gaeltachta | 17 | `/rnag` | `rnag` |
| RTÉ Gold | 22 | `/gold` | `gold` |
| RTÉ Pulse | — | — | `pulse` (schedule 200 OK, empty today) |
| RTÉ 2XM | — | — | `2xm` (schedule 200 OK, empty today) |
| RTÉ Junior | — | — | `junior` (schedule 200 OK, empty today) |

Pulse, 2XM, and Junior are absent from the `live_stations/json` response and have no Icecast
mount. Their schedule endpoints return empty arrays on the day investigated — they may be
primarily music-relay / digital-only channels with lighter EPG coverage.

### Response shape — `live_stations/json`

```json
{
  "stations": [
    {
      "id": 9,
      "slug": "radio1",
      "name": "RTÉ Radio 1",
      "url": "/radio/radio1/",
      "logoSvgUrl": "https://www.rte.ie/static/dotie/radio-logos/RTE-Radio1.svg",
      "accentColour": "#57a9d3",
      "liveListing": {
        "stationId": 9,
        "showName": "Playback",
        "showDate": "2026-05-09T09:00:00",
        "showEndDate": "2026-05-09T10:00:00",
        "showDescription": "Sinéad Mooney brings you the best of the week's wireless…",
        "showImage1x1": "https://www.rte.ie/images/0023f37a.jpg",
        "showImage16x9": "https://www.rte.ie/images/0023f381.jpg",
        "showUrl": "/radio/radio1/playback/",
        "genre": "FACTUAL"
      }
    }
  ]
}
```

**Field mappings (programme-level):**
- Programme name → `liveListing.showName`
- Programme description → `liveListing.showDescription`
- Programme art (1:1) → `liveListing.showImage1x1`
- Programme art (16:9) → `liveListing.showImage16x9`
- Programme start → `liveListing.showDate` (ISO 8601 local time, no TZ offset)
- Programme end → `liveListing.showEndDate`
- Channel logo (SVG) → `logoSvgUrl`

**No track-level (artist/title/album) data.** The `live_stations/json` payload is
programme-schedule information only.

### Response shape — schedule endpoint

URL: `https://www.rte.ie/radio/<slug>/schedule/<YYYYMMDD>/`

The Angular component builds this URL as:
`window.location.protocol + window.location.host + window.location.pathname + dates[index].url`
where `dates[index].url = "schedule/<YYYYMMDD>/"`.

The response is an array of time-block groups, each with a `data` array of programme entries:

```json
[
  {
    "active": "active active-bg",
    "data": [
      {
        "image": "https://www.rte.ie/images/0023f38b-100.jpg",
        "showName": "CountryWide",
        "showDate": "Saturday 09 May",
        "showTime": "08:00",
        "showEndDate": "2026-05-09 09:00:00",
        "is_last": true,
        "is_now": false,
        "is_next": false,
        "showUrl": "https://www.rte.ie/radio/radio1/countrywide/"
      }
    ]
  }
]
```

**Field mappings:**
- Programme name → `data[i].showName`
- Programme start → `data[i].showTime` (HH:MM, local)
- Programme end → `data[i].showEndDate` (datetime string, local)
- Programme art (thumbnail, ~100px) → `data[i].image`
- Current programme indicator → `data[i].is_now` (boolean)
- Previous programme → `data[i].is_last`
- Next programme → `data[i].is_next`

**No track-level data.** This is a flattened programme EPG widget response.

### Response shape — Icecast status (`/status-json.xsl`)

Lists 11 mounts: `/2fm`, `/2fm_proctest`, `/gold`, `/gold_proctest`, `/ie2fm`, `/ieradio1`,
`/lyric`, `/radio1`, `/radio1_proctest`, `/rnag`, `/test`. The `title` field is `""` (empty
string) for all mounts — RTÉ does not inject ICY track metadata into the stream. The Icecast
server is using a custom server ID `"RSAS"` (not the standard Icecast version string).

### Wirable today?

| Signal | Status | Verdict |
|---|---|---|
| Track artist + title | ❌ not found anywhere | No track API exists |
| Cover art (per-track) | ❌ not available | No track data → no track art |
| Programme name + art | ⚠️ **via-worker** | `live_stations/json` has it — no CORS, needs proxy |
| Programme schedule (EPG) | ⚠️ **via-worker** | Per-channel `/schedule/<YYYYMMDD>/` — no CORS, needs proxy |
| Channel logo SVG | ✅ | Embedded in `live_stations/json`, absolute URL, open |
| ICY metadata | ❌ | Icecast `title` always empty |

Overall: ⚠️ **partial, via-worker.** Programme-level wirable via proxy for 5 main channels.
Track-level not available from any RTÉ endpoint found. RTÉ Radio 1, RnaG, and Junior are
primarily talk/children's — no music metadata expected. 2FM, Lyric, Gold, Pulse, 2XM are
music channels where track metadata would be valuable but the broadcaster does not expose it.

### Suggested fetcher

**Programme-level only.** New `fetchRteMetadata` in `src/builtins.ts`. Closest analogues:
`fetchSrMetadata` (programme-only, no tracks) and `fetchRaiMetadata` (single endpoint
covers all channels, programme art embedded).

Since `live_stations/json` returns all 5 main channels in one response, cache it and
look up by `stationId` (same shared-fetch pattern as FFH and RAI):

1. Fetch `https://www.rte.ie/radio/live_stations/json` via worker proxy (no CORS).
2. `station.metadataUrl` stores the `stationId` as a string (e.g. `"9"` for Radio 1).
3. Find `stations.find(s => String(s.id) === station.metadataUrl)`.
4. Extract `liveListing.showName` → programme name.
5. Extract `liveListing.showDescription` → programme subtitle (optional).
6. Extract `liveListing.showImage1x1` → cover URL.
7. Extract `liveListing.showDate` / `showEndDate` → schedule window.
8. Return `{ track: undefined, raw: '', program: { name, subtitle }, coverUrl }`.

For Pulse, 2XM, and Junior (absent from `live_stations/json`), the schedule endpoint
`/radio/<slug>/schedule/<YYYYMMDD>/` returns programme data — but also needs a proxy.
A schedule fetcher could be built from this if those channels are ever upgraded.

Add to worker proxy allowlist in `worker/src/index.ts`:
```
^https://www\.rte\.ie/radio/live_stations/json$
```

Register as `rte` in `FETCHERS_BY_KEY` and `SCHEDULE_FETCHERS` maps.

### Notes

- **No track-level API.** After exhaustive investigation (Angular bundle grep, Icecast status,
  `live_stations/json` inspection, schedule endpoint inspection, multiple API URL probes),
  no JSON endpoint exposing artist/title/cover for currently playing music was found.
  RTÉ's web player relies on programme-level EPG data only — consistent with RTÉ being
  primarily a public-service talk/news broadcaster (Radio 1, RnaG) and music channels
  that apparently do not publish a real-time track feed.
- **CORS absent from all endpoints.** Neither `live_stations/json` nor the schedule endpoint
  returns CORS headers, even with an `Origin` request header sent. A worker proxy entry
  is required for both.
- **Pulse, 2XM, Junior not in `live_stations/json`.** These three channels have no `stationId`
  in the Angular app's logo map or the live_stations response. Their schedule endpoints exist
  but returned empty arrays on 2026-05-09. They may be low-editorial-priority channels with
  sparse EPG coverage. Programme data for those channels is not reliably available via the
  discovered API.
- **Icecast `title` fields are empty.** The streams at `icecast.rte.ie` do not emit ICY
  metadata. Channels at `status: icy-only` in the catalog will not show track info.
- **`live_stations/json` refreshes on a 60 s `s-maxage` CDN cache** (observed in response
  headers: `cache-control: max-age=0, s-maxage=60`). A 60 s poll cadence respects the
  broadcaster's own update frequency for this endpoint.
- **Channel logo SVGs** are served from `https://www.rte.ie/static/dotie/radio-logos/`
  with no CORS requirement. Available: `RTE-Radio1.svg`, `2fm.svg`, `lyricFM.svg`,
  `RnaG.svg`, `RTE-Gold.svg`. These could be used as `favicon` overrides in `stations.yaml`.
- **Dates object in Angular component** reveals the schedule URL pattern and confirms
  a 21-day lookback + 21-day lookahead window of schedule data is served.
- **`ieradio1` and `ie2fm` Icecast mounts** are geo-restricted variants (the `ie` prefix
  is likely an Ireland-only redundancy stream or internal relay). Listener counts were 0
  and 5 respectively at time of capture; the primary streams (`/radio1`, `/2fm`) had 3
  and 26 listeners.
- **No rate-limit headers** observed on any endpoint. The RTÉ site runs on Cloudflare CDN.
- **ToS:** RTÉ is Ireland's national public broadcaster funded by the licence fee. No
  explicit API ToS found; the endpoints are served publicly and called by every rte.ie
  visitor. Reasonable polling cadence (60 s for `live_stations/json`) is appropriate.

---

## yle — YLE / Yleisradio (FI)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | Areena service ID |
|---|---|---|
| YLE Radio Suomi | `stream-only` | `yle-radio-suomi` (+ regional variants `yle-radio-suomi-helsinki`, …-turku, …-tampere, …-oulu, …-rovaniemi, etc.) |
| YLE Radio 1 | `stream-only` | `yle-radio-1` |
| YleX | `stream-only` | `ylex` |
| YLE Klassinen | `stream-only` | `yle-klassinen` |
| YLE Puhe (not in catalog) | n/a | `yle-puhe` |
| YLE Mondo (not in catalog) | n/a | `yle-mondo` |
| YLE Sami Radio (not in catalog) | n/a | `yle-sami-radio` |
| Radio Vega + X3M (Swedish-language, not in catalog) | n/a | `yle-radio-vega`, `radio-vega-huvudstadsregionen`, …, `yle-x3m` |

### Two distinct APIs — only one is browser-wirable

YLE publishes **two** API surfaces:

1. **`external.api.yle.fi`** — the historic developer-portal API. Required `app_id`+`app_key` issued via signup at `developer.yle.fi`. Per the public docs and community references, **this API was disabled by Yle during spring 2021** and most endpoints (`/v1/programs/nowplaying/<service>.json` etc.) no longer respond. Confirmed dead-end: not the path forward.

2. **`areena.api.yle.fi`** — the **internal API that the live web player at `areena.yle.fi/suorat` actually calls**. This is the real one. It is auth-gated, but the credentials are *shipped publicly in the player's own JS bundle* (more on this below) and a CloudFront WAF rejects requests without them with `HTTP 403`.

The Areena API is what the player uses, and it is technically reachable — but only with caveats described under "Auth" and "CORS" below.

### Endpoints (areena.api.yle.fi)

All paths take a fixed query suffix the player always sends:

```
?language=fi&v=10&client=yle-areena-web&app_id=areena-web-items&app_key=wlTs5D9OjIdeS9krPzRQR4I1PYVzoazN
```

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing programme (bulk, all radio channels) | `https://areena.api.yle.fi/v1/ui/schedules/now.json?service=<csv-of-service-ids>&transmissionlimit=1` | `app_id`+`app_key` (public, hard-coded in JS bundle) | origin-pinned to `https://areena.yle.fi` | `data/metadata-discovery/yle-schedules-now-bulk.json` |
| Full-day schedule per channel | `https://areena.api.yle.fi/v1/ui/schedules/<service-id>.json` | same | same | `data/metadata-discovery/yle-schedules-radio1-day.json` |
| Current programme details (richest single-channel call) | `https://areena.api.yle.fi/v1/ui/services/<service-id>/transmissions/current.json` | same | same | `data/metadata-discovery/yle-transmission-current-radio1.json`, `…-klassinen.json` |
| Live page driver (with controls + IDs) | `https://areena.api.yle.fi/v1/ui/views/live.json` | same | same | `data/metadata-discovery/yle-views-live.json` |
| Radio guide for a date | `https://areena.api.yle.fi/v1/ui/views/radio-guides/YYYY-MM-DD.json` | same | same | `data/metadata-discovery/yle-views-radio-guides-day.json` |
| Player resource (gives `currentProgramSource` URI) | `https://areena.api.yle.fi/v1/ui/players/<service-id>.json` | same | same | `data/metadata-discovery/yle-player-radio1.json` |
| Podcast feed (separate, public) | `https://feeds.yle.fi/areena/v1/series/<series-id>.rss` | none | no `Access-Control-Allow-Origin` header (server-side parse only) | n/a |
| Track-level "now playing song" | **does not exist** | — | — | — |

The web player's CSP `connect-src` allows only `*.yle.fi`, `wss://*.yle.fi`, `*.ylestatic.fi`, `endpoint.finnpanel.fi`, `*.akamaized.net`, `*.litix.io`, `sdk.fra-02.braze.eu`, `fi-yle-dev1.mini.snplow.net`. There is no other backing API in scope.

### Auth

- Every endpoint above is annotated `"authentication": ["yle-api"]` in the page driver JSON. Without `app_id`+`app_key`, requests get HTTP 403 from CloudFront / nginx.
- The web player injects credentials by appending `?app_id=…&app_key=…` to every URL via this helper (de-minified from `pages/_app-*.js`):

  ```js
  function addApiKeys(urlStr, appId, appKey) {
    const u = new URL(urlStr);
    u.searchParams.set("app_id", appId);
    u.searchParams.set("app_key", appKey);
    return u.href;
  }
  // appId, appKey come from window.envVariables, injected SSR into the HTML:
  //   window.envVariables = { ..., appIdFrontend:"areena-web-items",
  //                           appKeyFrontend:"wlTs5D9OjIdeS9krPzRQR4I1PYVzoazN", ... };
  ```

- These are **not personal credentials**. They are the shared frontend keys for `areena-web-items` (the Areena web client) and ship in the page source on every load. Reusing them is not auth-bypass — it is doing exactly what the browser does.
- That said: the keys can rotate at any time, and Yle's ToS may treat third-party use as out of scope. Treat as fragile.

### CORS

- `Access-Control-Allow-Origin: https://areena.yle.fi` (single origin, exact match) with `Access-Control-Allow-Credentials: true`. Confirmed via two GETs from different Origins — second one returns the same body but the response ACAO header still pins to areena.yle.fi.
- Preflight `OPTIONS` from `https://rrradio.org` returns HTTP 403 with no CORS headers at all.
- **Direct browser fetch from `rrradio.org` is impossible.** The worker proxy with an `Origin: https://areena.yle.fi` override (BBC-style) is the only path.
- Cache: `Cache-Control: max-age=300` (5 min). No `X-RateLimit-*` or `Retry-After` headers seen. `bulk schedules/now.json` covers 30+ services in a single response, so one call per ~5 min for *all* YLE channels is well within sane budget.

### Response shape (schedules/now.json — bulk)

```json
{
  "apiVersion": "1.3.9792",
  "meta": { "service": "yle-radio-1,ylex,...", "count": 7 },
  "data": [
    {
      "title": "Keinuva talo - Mika Kauhanen: Elämä junamatkana",
      "image": { "id": "yle-radio-1_channel", "version": "1750676272" },
      "labels": [
        { "type": "generic",          "formatted": "22.40–23.39" },
        { "type": "progress",         "raw": "2026-05-09T22:40:13+03:00/2026-05-09T23:39:18+03:00",
                                      "rawType": "interval" },
        { "type": "broadcastService", "formatted": "Yle Radio 1", "raw": "yle-radio-1" }
      ],
      "presentation": "broadcastCard",
      "controls": [
        { "type": "navigator",
          "destination": {
            "type": "player",
            "uri": "https://areena.api.yle.fi/v1/ui/players/yle-radio-1.json?…",
            "authentication": ["yle-api"]
          }
        }
      ],
      "type": "card"
    },
    /* …one entry per channel… */
  ]
}
```

Field map for a fetcher:

- **Programme name** → `data[i].title`
- **Channel match** → `labels[?type=="broadcastService"].raw` (one of `yle-radio-1`, `ylex`, `yle-radio-suomi`, `yle-klassinen`, …)
- **Programme time window** → `labels[?type=="progress"].raw` is an ISO-8601 interval `start/end`; `labels[?type=="generic"].formatted` has the human-readable `22.40–23.39`.
- **Image** → reconstruct via `https://images.cdn.yle.fi/image/upload/{id}.jpg` (image asset domain seen in catalog favicons + CSP `img-src`); the response itself only carries the asset id + version.
- **No track artist/title/album.** Confirmed by reading the JS chunks (`879-*.js`, `153-*.js`) — only `trackClick` / `trackPlayClick` *analytics* hooks, no `nowPlaying` / `currentTrack` / `playlist` field anywhere.

### Response shape (services/<id>/transmissions/current.json — richest)

```json
{
  "apiVersion": "1.3.9792",
  "meta": { "asOf": "2026-05-09T23:12:42+03:00", "expiresIn": "PT1605S" },
  "data": {
    "title": "Keinuva talo - Mika Kauhanen: Elämä junamatkana",
    "description": "Pohjois-Amerikan juurimusiikissa…\n\nEric Bibb: Freedom train…\n…",
    "image": { "id": "yle-radio-1_square", "version": "1750676272" },
    "labels": [
      { "type": "broadcastStartDate",  "raw": "2026-05-09T22:40:13+03:00" },
      { "type": "broadcastEndDate",    "raw": "2026-05-09T23:39:18+03:00" },
      { "type": "duration",            "formatted": "59 min" },
      { "type": "seriesTitle",         "formatted": "Keinuva talo - Mika Kauhanen" },
      { "type": "broadcastService",    "formatted": "Yle Radio 1", "raw": "yle-radio-1" }
    ],
    "presentation": "scheduleCard",
    "cards": [ { "type":"card", "title":"Elämä junamatkana", "description":"…" } ],
    "type": "card"
  }
}
```

Notable: for **Yle Klassinen** the `description` field contains the classical-music programme's *prose track listing* with timestamps:

```
Santoliquido: I Canti della sera (Iltalauluja) (Joyce DiDonato, mezzosopraano…).

18:11 Berlioz: Alkusoitto oopp. Benvenuto Cellini (Baltimoren SO/David Zinman).
18:22 E. Mayer: Sinfonia n:o 6 E-duuri (Bremerhavenin FO/Marc Niemann).
…
```

This is unstructured (no separate fields), but a regex over `^(\d{1,2}:\d{2})\s+([^:]+):\s*(.+)$` lines would extract a track schedule for classical only. The standard channels' `description` is just programme prose, no tracks.

### Wirable today?

⚠️ **via worker** — programme-level only, no per-track data, but otherwise clean.

Justification: HTTPS-only, structured JSON, stable schema, `app_id`+`app_key` are public client-side credentials we'd be reusing the same way the browser does, but `Access-Control-Allow-Origin` is pinned to `https://areena.yle.fi` so direct browser fetch from `rrradio.org` will fail. The Cloudflare worker would need a dedicated `/api/public/yle/<service>` route that injects `Origin: https://areena.yle.fi` and the credentials — exactly the BBC pattern (`fetchBbcMetadata` + `worker/src/index.ts` BBC route). One bulk call covers all 7 catalog YLE channels per polling tick.

If a worker route is not desired: **❌ unwirable** from the static site — there is no CORS-open YLE endpoint. ICY-over-fetch is the only fallback (current state) and produces nothing because the YLE Icecast streams don't emit ICY title metadata.

### Suggested fetcher

New `fetchYleAreenaMetadata` in `src/builtins.ts`. Closest analogue: `fetchBbcMetadata` (lines ~868–890). Pattern:

1. Add `metadata: yle-areena` and `metadataUrl: <yle-service-id>` (e.g. `yle-radio-1`, `ylex`) to each YLE station in `data/stations.yaml`.
2. Add a worker route `/api/public/yle/now/<csv-of-services>` that fetches `https://areena.api.yle.fi/v1/ui/schedules/now.json?service=<csv>&transmissionlimit=1&language=fi&v=10&client=yle-areena-web&app_id=areena-web-items&app_key=…` with `Origin: https://areena.yle.fi` + `Referer: https://areena.yle.fi/`, returns the body with public CORS. Cache 60 s. Treat `app_key` as a worker env var so it can be rotated without a redeploy.
3. The fetcher reads the bulk response, finds the entry whose `labels[?type=="broadcastService"].raw == station.metadataUrl`, returns `program: { name: title, subtitle: undefined }`. No `track` field — same as BBC.
4. Optional `fetchYleAreenaSchedule` mirrors the BBC schedule fetcher: hit `…/schedules/<service>.json` and map `labels[broadcastStartDate]/[broadcastEndDate]` + `data[i].title` into `ScheduleBroadcast`.
5. Optional Klassinen-only: parse `transmissions/current.json` `description` for `^HH:MM Composer: Title…` lines — but this is bonus, defer.

### Notes

- **No track-level metadata anywhere.** The Areena web player itself only displays the programme title on radio cards — there is no "now playing song" UI on areena.yle.fi for live radio. Don't promise track data to users.
- **Credentials may rotate.** `app_key=wlTs5D9OjIdeS9krPzRQR4I1PYVzoazN` is hard-coded in the bundle that ships from `areena-web-items.ylestatic.fi/4.0.2519/_next/static/…/_app-*.js`; when Yle redeploys with a new key, the static bundle changes too. Worker should treat the key as injected env config (re-extractable from the page if it ever 401s).
- **No published ToS on the Areena API specifically.** The retired `developer.yle.fi` portal had a CC-BY-style attribution requirement on metadata reuse. Same spirit likely applies here. If we wire this, attribute "Programme info © Yleisradio Oy" on the now-playing card.
- **Regional Yle Radio Suomi.** The bulk endpoint returns 17+ regional variants (`yle-radio-suomi-helsinki`, `…-tampere`, etc.). Our catalog has one generic `YLE Radio Suomi` station; the bulk now-playing for the parent `yle-radio-suomi` ID returns whichever region happens to be selected by the CDN at request time (we got `yle-radio-suomi-pori` in the sample). To get a stable national-network programme, prefer querying with a specific regional ID, or accept that "Radio Suomi" current programme drifts by region — usually the same nationwide block anyway.
- **Swedish-language Yle channels** (Radio Vega, X3M) are not in our catalog yet. Same API, same shape — adding them later costs nothing.
- **Podcast RSS** at `feeds.yle.fi/areena/v1/series/<series-id>.rss` is publicly reachable but has no CORS header. Not relevant for live metadata; mention only because the discovery checklist asks. Series IDs aren't trivially discoverable from the live API (`pointer.uri` references opaque package IDs like `57-p89RepWE0`, not the series IDs RSS uses).
- **HLS livestreams** (the player's actual audio) ship via `*.akamaized.net` HLS. Our catalog already uses the icecast endpoints (`icecast.live.yle.fi/radio/<…>/icecast.audio`); HLS is a possible upgrade later but unrelated to metadata.
- Captured `data/metadata-discovery/yle-*.json` files are gitignored (per `.gitignore` `data/metadata-discovery/`), so this PR commits only the docs section. To re-capture, run the curls in this file with `app_id`+`app_key` from any current load of `https://areena.yle.fi/suorat` (look for `window.envVariables`).

## dr — DR / Danmarks Radio (DK)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | DR channel slug | DR channel URN |
|---|---|---|---|
| DR P1 | `stream-only` | `p1` | `urn:dr:radio:channel:5fa156d1da351264f87b462d` |
| DR P2 (klassisk) | `stream-only` | `p2` | `urn:dr:radio:channel:5fa156d2da351264f87b4633` |
| DR P3 | `stream-only` | `p3` | `urn:dr:radio:channel:5fa156d2da351264f87b4634` |
| DR P4 København | `stream-only` | `p4` | `urn:dr:radio:channel:5fa156d2da351264f87b4644` |
| DR P5 København | `stream-only` | `p5` | `urn:dr:radio:channel:5fa156d2da351264f87b4638` |
| DR P6 BEAT | `stream-only` | `p6beat` | `urn:dr:radio:channel:5fa156d2da351264f87b463e` |
| DR P8 JAZZ | `stream-only` | `p8jazz` | `urn:dr:radio:channel:5fa156d1da351264f87b4631` |

The `/radio/v5/channels` listing returns 18 entries total (also `ly1`, `ly2`, `p7mix`, `special-radio`, plus internal `mcrweb*` / `dr-web-*` / `p3webcam` channels). Our catalog has the seven public broadcast channels above. **Note:** the DR API exposes only one `p4` channel — the regional P4 split (København, Bornholm, Fyn, Midt & Vest, Nordjylland, Syd, Sjælland, Trekanten, Østjylland) is not modelled at this level. Our `DR P4 København` station maps to plain `p4` for now-playing purposes; same for `p5` (one shared slug, our station is `DR P5 København`).

### One API surface — public, no auth needed

DR's `dr.dk/lyd` web player is a Next.js SPA whose runtime config exposes a single backend host: `apiHostname = "api.dr.dk"`. All player calls hit `https://api.dr.dk/radio/v5/...`. The bundle includes a hard-coded `x-apikey` header (value `6Wkh8s98Afx1ZAaTT4FuWODTmvWGDPpR`, found in chunk `pages/_app-*.js` module 10394 as constant `BH`), but **the live now-playing endpoints we care about return `200 OK` even without the key** — they're public-by-default; the key only gates write/private resources. CORS is wildcard. This is the cleanest broadcaster surface we've audited so far.

### Endpoints (api.dr.dk/radio/v5)

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| **Now-playing tracks (live, per channel)** — primary fetcher target | `https://api.dr.dk/radio/v5/indexpoints/live/<channel-slug>` | none required (key tolerated) | `*` | `data/metadata-discovery/dr-indexpoints-live-{p1,p2,p3,p4,p5,p6beat,p8jazz}.json` |
| Live programme (now show) per channel | `https://api.dr.dk/radio/v5/schedules/<channel-slug>/now` | `x-apikey` required | `*` | `data/metadata-discovery/dr-schedules-p3-now.json` |
| Bulk live programmes (all channels in one call) | `https://api.dr.dk/radio/v5/schedules/all/now` | none | `*` | `data/metadata-discovery/dr-schedules-all-now.json` |
| Day schedule (programme list) per channel | `https://api.dr.dk/radio/v5/schedules/snapshot/<channel-slug>` | none | `*` | `data/metadata-discovery/dr-schedules-snapshot-p3.json` |
| Channel listing | `https://api.dr.dk/radio/v5/channels` | none | `*` | `data/metadata-discovery/dr-channels.json` |
| Channel details (incl. stream URLs) | `https://api.dr.dk/radio/v5/channels/<channel-slug>` | none | `*` | `data/metadata-discovery/dr-channels-p3.json` |
| Track detail (recording, release, **cover art**) | `https://api.dr.dk/radio/v5/music/tracks/live/<channel-slug>/<url-encoded track-urn>` | `x-apikey` required | `*` | `data/metadata-discovery/dr-music-track-live-p8jazz.json` |
| Podcast/RSS feed | not on this API surface (separate `dr.dk` podcast pages) | — | — | — |

Versions `v3` and `v4` of the same paths also respond (200), but the player is on `v5` — use `v5`.

**Cache hint:** the server sets `Cache-Control: public, max-age=1` on `indexpoints/live/*` (truly live data) and `max-age=62`/`66` on `channels` and `schedules/all/now`. No `X-RateLimit-*` or `Retry-After` headers seen across any endpoint. Treat the API as polite-quota-only — 30–60 s polling per channel is well within sane budget.

### Response shape (indexpoints/live/<slug> — primary)

```json
{
  "type": "List",
  "channel": { "title": "P3", "id": "urn:dr:radio:channel:…", "slug": "p3", "type": "Channel",
               "presentationUrl": "https://www.dr.dk/lyd/p3" },
  "totalSize": 18,
  "items": [
    {
      "type": "Track",
      "durationMilliseconds": 230000,
      "playedTime": "2026-05-09T20:13:22+00:00",
      "musicUrl": "https://www.dr.dk/musik/titel/lyden-af-livet/9075733-1-8",
      "trackUrn": "urn:dr:music:track:9075733-1-8",
      "classical": false,
      "roles": [
        { "artistUrn": "urn:dr:music:artist:10739362",
          "role": "Hovedkunstner",
          "name": "Barselona",
          "musicUrl": "https://www.dr.dk/musik/kunstner/barselona/10739362" }
      ],
      "title": "Lyden af livet",
      "description": "Barselona"
    }
    /* …most-recent first; up to ~20 historical items per channel… */
  ],
  "id": "urn:dr:radio:index:…"
}
```

Field map for a fetcher:

- **Track title** → `items[0].title`
- **Track artist** → `items[0].roles.find(r => r.role === "Hovedkunstner")?.name` (primary artist). Fallback: `items[0].description` (the player's own subtitle string, often just the artist's display name; for classical it's a composer line).
- **Played-at timestamp** → `items[0].playedTime` (ISO-8601, used to know when to advance the now-playing display).
- **Track duration** → `items[0].durationMilliseconds`
- **Channel match** → `channel.slug` (one of `p1`, `p2`, `p3`, `p4`, `p5`, `p6beat`, `p8jazz`).
- **Cover art** → not in this response; requires a follow-up to `music/tracks/live/<slug>/<encoded trackUrn>` (with `x-apikey`), then read `release.images[0].sizes[?size=="medium"].source` (`small` / `medium` / `large` / `native` available, all `https://asset.dr.dk/drdk_releases/...front-*.jpg`).
- **Track history** → `items[1..]` (this same response carries up to ~20 recent tracks; no separate history endpoint needed).
- **Empty case** → talk channels (`p1`, `p4`) return `totalSize: 0, items: []` while the host is on air (no music currently playing). Fetcher should fall back to programme info from `schedules/<slug>/now` in that case, or simply return `null`.
- **Classical convention** → `classical: true` flips `roles` to include `"role": "Komponist"` (composer) and `"role": "Solist/featuring"` (performers). For P2 / classical-tagged tracks, prefer composer name + work title rather than primary artist.

### Response shape (schedules/<slug>/now — programme info fallback)

```json
{
  "type": "Live",
  "title": "P3 Musik",
  "startTime": "2026-05-09T20:00:00+00:00",
  "endTime":   "2026-05-10T03:00:00+00:00",
  "series":  { "title": "P3 Musik", "id": "urn:dr:radio:series:…", "slug": "p3-musik-…" },
  "channel": { "title": "P3", "slug": "p3", "id": "urn:dr:radio:channel:…" },
  "audioAssets": [ { "format": "HLS", "url": "https://drliveradio2.akamaized.net/hls/live/2118698/p3/masterab.m3u8" } /* …+ ICY low/high… */ ],
  "isAvailableOnDemand": false,
  "id": "urn:dr:radio:episode:…",
  "slug": "p3-musik-…"
}
```

Use `title` as the programme name and `series.title` if `title` is identical (same string for music blocks); the tuple `startTime/endTime` gives the programme window for a "X – Y" subtitle.

### Wirable today?

✅ **wire-now.** HTTPS-only, CORS wildcard, no auth required for the now-playing endpoint, structured JSON, stable schema, real track-level data with artist + title. No worker proxy needed for the primary path. The `music/tracks/live/...` cover-art enrichment call needs the public `x-apikey` (also embedded in the page) — still browser-safe (it's a public client key, not a secret), but to keep our fetcher tidy we can either hard-code it or skip cover art until we add it as a second-pass enrichment.

### Suggested fetcher

New `fetchDrMetadata` in `src/builtins.ts`. **Closest analogue:** `fetchSrgssrIlMetadata` (lines ~760–810) — both are public CORS-clean JSON endpoints returning a `now/items[]` list with `title` + `artist` siblings. Pattern:

1. Add `metadata: dr` to the `dr:` entry in `data/broadcasters.yaml`.
2. Add `metadataUrl: <slug>` (one of `p1`, `p2`, `p3`, `p4`, `p5`, `p6beat`, `p8jazz`) to each DR station in `data/stations.yaml`. The slug doubles as the channel selector.
3. Implement `fetchDrMetadata`:
   - Direct fetch `https://api.dr.dk/radio/v5/indexpoints/live/${station.metadataUrl}` with `Accept: application/json`. Sending `x-apikey: 6Wkh8s98Afx1ZAaTT4FuWODTmvWGDPpR` is harmless and avoids intermittent 401s on cache-miss (see notes).
   - If `items.length === 0` or `items[0].playedTime` is more than ~10 minutes old, return `null` (talk hour) — the np-display will fall back to other sources.
   - Otherwise return `{ track: { artist, title: items[0].title }, raw: '' }` where `artist = items[0].roles.find(r => r.role === "Hovedkunstner")?.name ?? items[0].description`.
   - For classical (`items[0].classical === true`): prefer `roles.find(r => r.role === "Komponist")?.name` as the artist; `items[0].title` is the work title.
4. **Optional v2:** add `fetchDrSchedule` that hits `schedules/<slug>/now` (with `x-apikey`) and returns `program: { name, subtitle: HH:MM–HH:MM }` for talk channels (P1, P4 København) where `indexpoints` is empty. Same fetcher key, second branch.
5. **Optional v3:** cover art — if `track.classical === false` and `trackUrn` present, follow-up GET `music/tracks/live/<slug>/<encoded trackUrn>` with `x-apikey` header, pull `release.images[?size=="medium"].source`. Worth wiring only after v1 ships and we see how often P3/P6/P8 listeners spend time on the now-playing card.
6. Register `dr: fetchDrMetadata` in `FETCHERS_BY_KEY`.

### Notes

- **API key.** `6Wkh8s98Afx1ZAaTT4FuWODTmvWGDPpR` is shipped in the public web bundle and used unconditionally by the official player; reusing it is doing exactly what the browser does. It's not a per-user credential. Still — don't leak it in error logs, and don't use it on endpoints we haven't tested as public. Some routes (e.g. `schedules/<slug>/now`, `music/tracks/...`) return `401 No API key found in request` without it; the now-playing route does not.
- **Auth-free vs key-required is per-route, not consistent.** Tested mid-investigation: `indexpoints/live/p3` and `…/p6beat` returned 200 anonymous, `…/p8jazz` returned 401 once and 200 next call (likely CDN cache hit/miss). To be safe, **always send the `x-apikey` header** even on routes that don't strictly need it — costs nothing and avoids intermittent 401s.
- **No regional P4 / P5.** The API exposes one `p4` and one `p5` channel slug with one schedule. `dr.dk/lyd/p4` shows a region-picker UI but the regional split happens later (different streams for the same `p4` schedule entry, switched by listener). Our `DR P4 København` and `DR P5 København` stations map to those single API slugs — accept that the *programme name* will be the national P4/P5 block; the *audio* still routes through the København-specific HLS variant we already have.
- **No anti-bot / fingerprinting.** Plain JSON over HTTPS, no cookies, no JS challenge, no `Sec-Fetch-Site` enforcement. Curl with a `Mozilla/5.0` UA works identically to a browser.
- **Firestore live updates.** The web player additionally subscribes to a Firestore document at `liveIndexPointLists/<channel-urn>` for sub-second push updates (we don't need this — polling `indexpoints/live` every ~30 s is plenty).
- **ToS.** No published developer ToS for `api.dr.dk/radio/v5`. The historic `developer.dr.dk` portal was retired years ago. As a Danish public-service broadcaster funded by media licence, DR's metadata is in spirit public-good; reusing programme/track info with an attribution line ("Track info © Danmarks Radio") is the friendly default. If we ever get a "please stop" email, switch off the fetcher — easy.
- **Sample files** at `data/metadata-discovery/dr-*.json` are gitignored (per `.gitignore` `data/metadata-discovery/`), so this PR commits only the docs section. To re-capture, run the curls in the table above (no auth needed for `indexpoints/live/<slug>`; pass `-H "x-apikey: 6Wkh8s98Afx1ZAaTT4FuWODTmvWGDPpR"` for `schedules/<slug>/now` and `music/tracks/live/...`).

## npr — NPR (United States)

Investigated: 2026-05-09.

### Federation note (read this first)

NPR is **not a single broadcaster.** It is a network of ~250 independently-operated member stations (WNYC, WBUR, KQED, WAMU, WBEZ, MPR News, plus separately-tracked broadcasters like KCRW and KEXP) **plus** a national production unit. There is **no single live now-playing API** that covers the whole network. Each member station runs its own web stack (WordPress / Laravel / Astro / Next.js / custom React) and publishes — or doesn't — its live metadata on its own infrastructure.

NPR HQ ships *national* content via podcast feeds (Morning Edition, All Things Considered, Fresh Air, NPR News Now) and via the NPR One mobile app, which uses an OAuth-gated Listening Service (`listening.api.npr.org`). The linear "NPR 24-Hour Program Stream" we list as `builtin-npr-program-stream` does **not** appear to expose a public unauthenticated current-show endpoint of its own. The legacy `api.npr.org/queryservice/` REST service is alive but key-gated, and the documented "free for non-commercial" key registration was retired several years ago.

The practical consequence: an "NPR fetcher" is really N fetchers, one per member station, since the API shape and metadata posture differ by member. Treat `broadcaster: npr` as a UI grouping label, not a single fetcher key. Wiring will be per-station, not per-broadcaster.

### Channels in catalog (broadcaster: npr)

| Station | Stream | Notes |
|---|---|---|
| `builtin-npr-program-stream` | `https://npr-ice.streamguys1.com/live.mp3` | NPR HQ 24-hour linear. No public live-show endpoint located. |
| `builtin-wnyc-fm` | `https://fm939.wnyc.org/wnycfm` | Covered by `api.wnyc.org/api/v1/whats_on/`. |
| `builtin-wbur` | `https://fm909.wbur.org/wbur_www` | Covered by `api.wbur.org/schedule` (programme grid only). |
| `builtin-wamu` | `https://wamu.cdnstream1.com/wamu.mp3` | StreamGuys w/ `icy-metaint: 0`. No public metadata endpoint located. |
| `builtin-wbez` | `https://stream.wbez.org/wbez128.mp3` | Same StreamGuys posture. Not investigated in depth. |
| `builtin-kqed` | `https://hls.kqed.org/hls/kqed_app/playlist.m3u8` | `/radio` page surfaced no metadata API. |
| `builtin-mpr-news` | `https://nis.stream.publicradio.org/nis.mp3` | mprnews.org Next.js routes 404 for `/api/now`, `/api/whats-on`, etc. |

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| WNYC / WQXR live "what's on" + current track | `https://api.wnyc.org/api/v1/whats_on/` | none | **no `Access-Control-Allow-Origin` reflected back** (worker proxy needed) | `data/metadata-discovery/npr-wnyc-whats-on.json` |
| WBUR programming schedule (weekly grid) | `https://api.wbur.org/schedule` | none | `*` | `data/metadata-discovery/npr-wbur-schedule.json` |
| WBUR channel / programme metadata | `https://api.wbur.org/channels/{slug}` | none | `*` | `data/metadata-discovery/npr-wbur-channel.json` |
| NPR Composer "On Now" widget | `https://api.composer.nprstations.org/v1/widget/{ucs}/now?format=json` | none on the widget path | `*` | swagger only — no live UCS captured (`data/metadata-discovery/npr-composer-widget-swagger.json`) |
| NPR Composer track history | `https://api.composer.nprstations.org/v1/widget/{ucs}/tracks?format=json` | none | `*` | (same swagger) |
| NPR Composer day / week schedule | `https://api.composer.nprstations.org/v1/widget/{ucs}/{day,week}?format=json&date=…` | none | `*` | (same swagger) |
| NPR Composer UCS lookup (call-letters → UCS) | `https://api.composer.nprstations.org/v1/ucs/search?name=WAMU` | **OAuth** (returns `Unauthorized`) | `*` | not capturable |
| NPR Listening Service v2 (NPR One backend) | `https://listening.api.npr.org/v2/...` | **OAuth** (consumer key + bearer) | n/a | n/a — out of scope |
| NPR legacy queryservice | `https://api.npr.org/queryservice/play/v3/...?apiKey=…` | **API key** (registration retired) | `*` | n/a |
| NPR national podcast feeds (per-show) | `https://feeds.npr.org/{showId}/podcast.xml` | none | `*` (Akamai) | n/a (RSS) |
| `legacy.npr.org/feeds/streaming/onair.json` (historical) | redirect target from `npr.org/feeds/streaming/onair.json` | none | — | **404** as of this investigation |

### Response shape — `api.wnyc.org/api/v1/whats_on/`

Top-level: object keyed by stream slug. Stream slugs returned today: `wnyc-fm939`, `wnyc-am820`, `q2`, `wqxr`, `wqxr-special` (Operavore), `wqxr-special2` (Holiday Channel). Each value:

```jsonc
{
  "name": "WNYC 93.9 FM",
  "slug": "wnyc-fm939",
  "has_playlists": false,                // true for music streams (q2, wqxr-*)
  "current_show": {
    "title": "BBC Newshour",             // ← programme name
    "show_url": "https://www.wnyc.org/shows/bbc-newshour",
    "description": "<p>...</p>",         // HTML, may need stripping
    "start": "2026-05-09T16:00:00-0400", // local
    "end":   "2026-05-09T17:00:00-0400",
    "iso_start": "2026-05-09T20:00:00+00:00",
    "iso_end":   "2026-05-09T21:00:00+00:00",
    "fullImage":   { "url": "...", "width": 300, "height": 300 },
    "listImage":   { "url": "...", ... },
    "detailImage": { "url": "...", ... }
  },
  "current_playlist_item": null,         // null for talk streams; populated for music
  "future": [],                           // upcoming shows (often empty)
  "expires": "2026-05-09T16:16:29",      // ← polling hint
  "expires_ts": 1778357776.0
}
```

For music streams (`q2`, `wqxr*`), `current_playlist_item` is populated:

```jsonc
"current_playlist_item": {
  "stream": "q2",
  "start_time": "2026-05-09T16:15:16",
  "iso_start_time": "2026-05-09T20:15:16+00:00",
  "catalog_entry": {
    "title": "For The Culture feat. D Double E",
    "composer": { "name": "Sons of Kemet", "url": "..." },  // ← primary credit (artist for pop, composer for classical)
    "soloists":  [{ "musician": { "name": "..." } }],
    "ensemble":  { "name": "..." },
    "reclabel":  { "name": "Impulse!" },
    "audio":     "https://pdst.fm/...",
    "length":    240
  }
}
```

Track-level cover art is **not** present — only programme imagery on `current_show`. The catalog model is classical-music-flavoured (composer + soloists + ensemble + conductor); for pop/jazz streams the "composer" field carries the artist's name.

### Response shape — `api.wbur.org/schedule`

```jsonc
{
  "body": {
    "weekday": [
      { "time": "12:00 AM", "items": [{ "label": "BBC World Service", "image": "...", "excerpt": "..." }] },
      { "time": "5:00 AM",  "items": [{ "label": "Morning Edition", "image": "...", "excerpt": "..." }] },
      ...
    ],
    "saturday": [...],
    "sunday":   [...]
  },
  "code": 200,
  "built": "2026-05-09T15:53:37-04:00"
}
```

`time` strings are local Eastern, no time-zone marker — fetcher must assume `America/New_York`. There is **no live current-show endpoint** at `api.wbur.org`; the schedule has to be cross-walked against current local time to derive "what's on now". `api.wbur.org/channels/{slug}` returns programme metadata (image, description, podcast RSS) but again no live position. WBUR is therefore *partial*: programme name + image derivable, no track data, no auto-correcting.

### Response shape — `api.composer.nprstations.org/v1/widget/{ucs}/now?format=json`

Per the Swagger spec at `https://api.composer.nprstations.org/v1/api-docs/widget` (saved). The path supports query params `format=html|json|jsonp|string`, `prog_id`, `limit`, `show_song`, `style=v2`, plus several affiliate-link toggles. Sister endpoints:

- `{ucs}/tracks` — recent track history
- `{ucs}/playlist` — deep history with `before`/`after` filtering
- `{ucs}/day?date=YYYY-MM-DD` — daily schedule
- `{ucs}/week?date=START,END` — weekly schedule

All return JSON when `format=json` and serve `Access-Control-Allow-Origin: *`. The 24-character hex **UCS** is a Mongo ObjectId tied to a stream (a member station could have multiple, e.g. one per channel).

The friction: `/v1/ucs/search?name=WAMU` returns `Unauthorized` without a signed OAuth request, and we don't have a UCS for any of the seven NPR-tagged stations in the catalog. Composer-using stations typically embed the UCS in their own player JS bundle — but inspecting `wamu.org`'s 1.5 MB `app.min.js` bundle found no `composer`, `nprstations`, or 24-hex pattern reference, suggesting WAMU has moved off Composer. KQED's `/radio` page similarly surfaced no Composer references. **Composer is real and useful in principle, but most of *our* NPR-tagged stations don't appear to use it.** Discovering UCS values would need either a Playwright session against each member's live player UI, or a list provided by the sponsor.

### Wirable today?

⚠️ **Partial, per-station only.** No single NPR-network fetcher is viable. Three sub-cases:

1. **WNYC + WQXR family** (`builtin-wnyc-fm`, plus future WQXR/WNYC-AM imports) — ⚠️ **wirable via worker proxy.** `api.wnyc.org/api/v1/whats_on/` is the richest endpoint found in this session: structured live data covering programme name, programme imagery, plus track artist/title for the music streams. CORS is the blocker — the response includes `Vary: Origin` and `Access-Control-Allow-Credentials: true` but **no `Access-Control-Allow-Origin` header is reflected back** to non-WNYC origins, so a direct browser fetch from `rrradio.org` will fail. Add `api.wnyc.org` to the `worker/src/index.ts` `/api/public/proxy` allowlist regex and wire a `fetchWnycMetadata` that selects the relevant slug from the multi-stream payload.

2. **WBUR** (`builtin-wbur`) — ⚠️ **partial.** `api.wbur.org/schedule` plus `/channels/{slug}` is CORS-clean (`*`) and gives a weekly programme grid + per-show images. No live track and no live "what's on now" — fetcher has to cross-walk current `America/New_York` time against the schedule grid. Programme name + image only, no music data, never auto-corrects mid-show. Worth a dedicated `fetchWburSchedule` for the schedule fetcher slot; the metadata fetcher would synthesise a current-programme guess from the same payload.

3. **WAMU, WBEZ, KQED, MPR News, plus `builtin-npr-program-stream`** — ❌ **not wirable from a public web endpoint in this session.** No metadata API surfaced; streams expose either ICY metaint=0 or HLS without ID3 timed metadata in the player path. Each would need either a per-station live capture (browser devtools on the actual web player, ideally Playwright) or a separate Composer UCS lookup. They stay `status: stream-only`.

### Suggested fetchers

Three new functions in `src/builtins.ts`, mapped on a per-station basis (the `metadata:` field in `data/stations.yaml` is per-station, so this works without giving NPR itself a network-wide fetcher):

```ts
// 1. fetchWnycMetadata — pulls api.wnyc.org/api/v1/whats_on/ once via worker
//    proxy, picks station.metadata.wnycSlug ("wnyc-fm939" | "wnyc-am820"
//    | "wqxr" | "q2" | "wqxr-special" | "wqxr-special2"), maps
//    current_show.title to programme + current_playlist_item.catalog_entry
//    to artist/title where present. Add `api\.wnyc\.org` to the
//    /api/public/proxy allowlist in worker/src/index.ts.
//
// 2. fetchWburSchedule + fetchWburMetadata — direct fetch api.wbur.org/schedule
//    (CORS=*), pick the row for the current America/New_York wall-clock,
//    emit programme name + image. No track data ever; no worker proxy needed.
//
// 3. (deferred) fetchNprComposerMetadata — generic helper that reads
//    station.metadata.composerUcs (24-char hex) and queries
//    api.composer.nprstations.org/v1/widget/{ucs}/now?format=json. No worker
//    needed (CORS=*); blocked on humans supplying UCS values per station.
```

**Closest existing analogues to copy from:**

- WNYC payload shape ≈ `fetchSrgssrIlMetadata` (multi-channel JSON keyed by slug — pick the one matching `station.metadata.wnycSlug`).
- WBUR schedule shape ≈ `fetchOrfSchedule` (weekly programme grid → current block by wall-clock).
- Composer ≈ a brand-new shape; closest is `fetchBrMetadata`'s "single now-playing JSON keyed by widget id" pattern.

### Notes

- **Treat `broadcaster: npr` as a UI-grouping label, not a fetcher key.** `metadataFetchers[broadcaster]` lookups in `src/builtins.ts` will always need to be per-station for NPR. Cleaner long-term: split the seven NPR-tagged catalogue entries across multiple broadcaster slugs (`wnyc`, `wbur`, `wamu`, `kqed`, `wbez`, `mpr`, `npr-national`) and add broadcaster entries to `data/broadcasters.yaml` for each. The current single-`npr` slug under-models the data shape.
- **Rate-limit posture.** No `X-RateLimit-*` headers seen on `api.wnyc.org` (cache-control is `max-age=10`, so polling once every 10–30 seconds is generous). `api.wbur.org` returns `s-maxage=86400` on channel data and `s-maxage=240` on the schedule, so a few requests per hour per client suffice.
- **WAMU's stream uses `Server: AIS Streaming Server 9.x` and `icy-metaint: 0`** — StreamGuys's "metadata stripped" configuration. There is no inline ICY title to extract. Same CDN posture for KQED HLS at `hls.kqed.org/hls/kqed_app/playlist.m3u8` (no public ID3 metadata in the m3u8).
- **KCRW** (separately tagged in `data/broadcasters.yaml`) is on Vercel with an aggressive bot challenge that returns `429 x-vercel-mitigated: challenge` to non-browser user agents. KCRW needs a real-browser session (Playwright) for any meaningful capture.
- **Composer is the right shape if we can get UCS values.** Well-designed (CORS=`*`, `?format=json` on every endpoint, separate now/tracks/day/week paths, no auth on the widget endpoints). It's used by many smaller PRSS-style member stations. The blocker is purely the UCS lookup, which is OAuth-gated. Suggested follow-up: file a sponsor question or run a Playwright session against `wnyc.org` / `kqed.org` / `wamu.org` live player UI to capture the UCS from in-browser fetch traffic.
- **No anti-bot on the wirable APIs.** `api.wnyc.org` and `api.wbur.org` accept plain curl with `Mozilla/5.0` UA, no cookies, no JS challenge.
- **Sample files** at `data/metadata-discovery/npr-*.json` are gitignored (per `.gitignore` `data/metadata-discovery/`), so this PR commits only the docs section. To re-capture: `curl -s "https://api.wnyc.org/api/v1/whats_on/"`, `curl -s "https://api.wbur.org/schedule"`, `curl -s "https://api.wbur.org/channels/wbur"`, `curl -s "https://api.composer.nprstations.org/v1/api-docs/widget"`.

## abc — Australian Broadcasting Corporation (AU)

Investigated: 2026-05-09.

ABC's web player at `abc.net.au/listen` is a Next.js SPA. The audio component
hooks into two distinct backend services on `abcradio.net.au`:

- **`music.abcradio.net.au`** — track-level "what's playing now" (artist, title,
  release, artwork). Used on music channels (Triple J, Classic, Country, Jazz,
  Double J, Unearthed, Kids Listen).
- **`program.abcradio.net.au`** — broadcast-level programme guide (show title,
  presenter, synopsis, start/end). Used on talk + spoken channels (Radio
  National, NewsRadio, Local Radio) and as the EPG for music channels.

The Next.js page also exposes `/listen/core-next/api/musicNowPlaying/<ID>` and
`/listen/core-next/api/epgNowPlaying/<ID>/now` as a thin server-side proxy,
but those are not directly callable from outside the SPA (return the ABC
"sorry" 404 page when hit cold). Wire to the underlying `*.abcradio.net.au`
hosts directly — they have proper CORS.

### Endpoints

| What | URL template | Auth | CORS | Cache hint | Sample |
|---|---|---|---|---|---|
| Now-playing track | `https://music.abcradio.net.au/api/v1/plays/<service>/now.json` | none | `*` | `max-age=93` | `data/metadata-discovery/abc-triplej-now.json` |
| Track history | `https://music.abcradio.net.au/api/v1/plays/search.json?station=<service>&order=desc&limit=10` | none | `*` | `max-age=60` | `data/metadata-discovery/abc-triplej-history.json` |
| Programme guide | `https://program.abcradio.net.au/api/v1/programitems/search.json?service=<service>&from=<ISO>&to=<ISO>&include=next,with_images,resized_images&limit=N` | none | `*` | `max-age=163` | `data/metadata-discovery/abc-triplej-epg.json`, `…abc-local-sydney-epg.json` |
| Cover art | embedded in now-playing under `now.recording.releases[0].artwork[0].sizes[]` (multiple ratios + widths) | — | — | — | (in `abc-triplej-now.json`) |
| Podcast feeds | per-show RSS exposed on each programme page (e.g. `abc.net.au/radionational/programs/<show>/feed/<id>/podcast.xml`) — out of scope for now-playing | none | varies | varies | n/a |

All three JSON endpoints are HTTPS-only, return `Content-Type: application/json`,
and ship `Access-Control-Allow-Origin: *` (verified via `curl -I`). No cookies,
no `Authorization` header, no query-param tokens. No `X-RateLimit-*` headers
were returned; respect the `Cache-Control: max-age=…` (60–163 s).

### Service-ID taxonomy

The `<service>` slug is the same on both APIs but is **not** the `papiServiceId`
used by the player config. Empirically derived from the player config and from
`creating_service.service_id` values returned by the unfiltered EPG endpoint:

| Channel | papiServiceId (player) | service slug (APIs) |
|---|---|---|
| Triple J | `TRIPLEJ` | `triplej` |
| Triple J Unearthed | `UNEARTHED` | `unearthed` |
| Double J | `DOUBLEJ` | `doublej` |
| ABC Classic | `CLASSIC` | `classic` |
| ABC Country | `COUNTRY` | `country` |
| ABC Jazz | `JAZZ` | `jazz` |
| Kids Listen | `KIDS_LISTEN` | `kidslisten` |
| ABC Radio National | `RN` | `RN` *(case-sensitive — uppercase)* |
| ABC NewsRadio | `NEWS` | `news` |
| ABC Sport | `SPORT` | (no EPG match found — see below) |
| ABC Radio Sydney (local) | `LOCAL_SYDNEY` | `local_sydney` |
| ABC Radio Melbourne | `LOCAL_MELBOURNE` | `local_melbourne` |
| ABC Radio (other locals) | `LOCAL_<CITY>` | `local_<city>` |
| Radio Australia | `RA` | `ra` |
| Radio Australia ML | — | `ra_ml` |

The mapping rule: roughly `lowercase(papiServiceId)` — except `RN` which
remains uppercase. Suggest using a lookup table keyed by `papiServiceId`
rather than a transform; future channels may add new exceptions.

Note: passing an unknown `service` slug to `programitems/search.json` does
**not** return an error — it returns the unfiltered live-program list, which
makes naive "does this slug work" probing return false positives. The reliable
check is: does the response contain at least one item whose
`creating_service.service_id == <expected>`?

### Response shape — `plays/<service>/now.json`

```json
{
  "next_updated": "2026-05-09T20:23:06+00:00",
  "last_updated": "2026-05-09T20:20:51+00:00",
  "next": { /* upcoming track, may be {} */ },
  "now": {
    "summary": { "artist": "...", "title": "...", "links": {...} },
    "entity": "Play",
    "played_time": "2026-05-09T20:20:41+00:00",
    "service_id": "triplej",
    "recording": {
      "title": "...",
      "duration": 155,
      "artists": [{ "name": "...", "is_australian": true, ... }],
      "releases": [{
        "title": "...",
        "format": "Single",
        "artwork": [{
          "url": "https://www.abc.net.au/.../cover.jpg",
          "type": "cover",
          "width": 600, "height": 600,
          "sizes": [
            { "url": "...100x100...", "width": 100, "aspect_ratio": "1x1" },
            { "url": "...160x160...", "width": 160, "aspect_ratio": "1x1" },
            { "url": "...340x340...", "width": 340, "aspect_ratio": "1x1" },
            { "url": "...580x580...", "width": 580, "aspect_ratio": "1x1" }
          ]
        }]
      }]
    }
  },
  "prev": { /* previous track, same shape as `now` */ }
}
```

Field map for the rrradio fetcher:

- **artist** → `now.summary.artist` (also `now.recording.artists[0].name` —
  prefer `summary.artist` because it's the broadcaster-canonical join).
- **track** → `now.summary.title`.
- **raw / ICY-style line** → `${artist} - ${title}`.
- **cover art** → `now.recording.releases[0].artwork[0].sizes[]` — pick a 1x1
  size by width (we render in a square slot). 340×340 is a sensible default.
- **track duration** → `now.recording.duration` (seconds) if we ever surface a
  progress bar.
- **next track** → `next.summary.{artist,title}` (often `{}` on talk channels).
- **previous track** → `prev.summary.{artist,title}` (rotating history).

Talk channels (NewsRadio `service=news`, Radio National `service=RN`) return
`{ "now": {}, "next": {}, "prev": {} }` — they don't push tracks. Fall back to
the EPG endpoint to surface programme info on those.

### Response shape — `programitems/search.json` (EPG)

```json
{
  "total": 1,
  "offset": 0,
  "count": 1,
  "items": [{
    "arid": "pe989a106f",
    "title": "Weekends",
    "short_synopsis": "Kick off your weekend...",
    "mini_synopsis": "...",
    "creating_service": { "service_id": "triplej", "title": "triple j" },
    "primary_publication_event": {
      "schedule_type": "Live",
      "start": "2026-05-09T21:00:00+0000",
      "end":   "2026-05-10T01:00:00+0000",
      "defining_timezone": "Australia/Sydney"
    },
    "series":     { "title": "Weekends" },
    "program":    { "title": "Weekends", "short_synopsis": "..." },
    "presenters": [{ "name": "...", "primary_image": {...} }],
    "primary_image": { "sizes": [...] }
  }]
}
```

For "what is on right now" send `from=<NOW>&to=<NOW+1h>&limit=1`. For a multi-
day schedule (`ScheduleFetcher`-style), send `from=<NOW>&to=<NOW+24h>&limit=N`
and group by day.

Field map:
- **programme.name** → `items[0].title` (fall back to `program.title`).
- **programme.subtitle** → `items[0].short_synopsis` or `mini_synopsis`.
- **programme.start/end** → parse `primary_publication_event.start/.end`.
- **schedule day boundary** → use `defining_timezone` (`Australia/Sydney`) so
  late-night shows attach to the right calendar day.

### Response shape — `plays/search.json` (track history)

Same play-record shape as the `/now.json` endpoint, but `items[]` is an array
of recent plays (up to ~10000 on `total`, default 10 per page). The `played_time`
field is the dispatch timestamp; `service_id` confirms the channel.

### Wirable today?

✅ **Wire-now.** All endpoints HTTPS, CORS-open (`*`), no auth, structured
JSON, public cache headers. No worker proxy needed. The only friction is the
service-ID lookup table and the per-channel decision (music vs talk) about
which endpoint to consult.

### Suggested fetcher

New shape; needs its own `fetchAbcMetadata` in `src/builtins.ts`. Closest
analogues:

- **`fetchSrgssrIlMetadata`** for the now-playing call shape (also
  artist+title with rich nested release/artwork, also from a public
  `*.<broadcaster>.<tld>` host with CORS open).
- **`fetchOrfMetadata` / `fetchHrMetadata`** for the dual-endpoint pattern
  (one music API + one programme API).

Outline:

```ts
// service-id lookup keyed off papiServiceId (stored on the station entry,
// or derived from station.broadcaster + station.name).
const ABC_SERVICE_BY_PAPI: Record<string, { music?: string; epg?: string }> = {
  TRIPLEJ:        { music: 'triplej',     epg: 'triplej' },
  CLASSIC:        { music: 'classic',     epg: 'classic' },
  COUNTRY:        { music: 'country',     epg: 'country' },
  JAZZ:           { music: 'jazz',        epg: 'jazz' },
  DOUBLEJ:        { music: 'doublej',     epg: 'doublej' },
  UNEARTHED:      { music: 'unearthed',   epg: 'unearthed' },
  KIDS_LISTEN:    { music: 'kidslisten',  epg: 'kidslisten' },
  RN:             {                       epg: 'RN' },
  NEWS:           {                       epg: 'news' },
  LOCAL_SYDNEY:   {                       epg: 'local_sydney' },
  LOCAL_MELBOURNE:{                       epg: 'local_melbourne' },
  // ...other locals follow the LOCAL_<CITY>/local_<city> pattern
};

const fetchAbcMetadata: MetadataFetcher = async (station, signal) => {
  const ids = abcServiceIds(station);
  if (!ids) return null;

  // 1. Music channel: try plays/now.json first.
  if (ids.music) {
    try {
      const url = `https://music.abcradio.net.au/api/v1/plays/${ids.music}/now.json`;
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as AbcPlaysNow;
        const now = data.now;
        if (now?.summary?.title) {
          const cover = pickAbcArtwork(now.recording?.releases?.[0]?.artwork?.[0]);
          return {
            artist: now.summary.artist?.trim() || undefined,
            track: now.summary.title.trim(),
            raw: `${now.summary.artist ?? ''} - ${now.summary.title}`.trim(),
            cover,
          };
        }
      }
    } catch {/* fall through */}
  }

  // 2. Talk channel (or music channel mid-program): hit EPG and return programme.
  if (ids.epg) {
    try {
      const now = new Date();
      const to = new Date(now.getTime() + 60 * 60 * 1000);
      const u = new URL('https://program.abcradio.net.au/api/v1/programitems/search.json');
      u.searchParams.set('service', ids.epg);
      u.searchParams.set('from', now.toISOString());
      u.searchParams.set('to', to.toISOString());
      u.searchParams.set('include', 'next,with_images,resized_images');
      u.searchParams.set('limit', '1');
      const res = await fetch(u, { signal, cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as AbcEpgResponse;
        const item = data.items?.[0];
        // Important: confirm creating_service.service_id matches our slug —
        // the API silently returns unfiltered results when the slug is unknown.
        if (item && item.creating_service?.service_id === ids.epg && item.title) {
          return {
            track: undefined,
            raw: '',
            program: {
              name: item.title.trim(),
              subtitle: (item.short_synopsis || item.mini_synopsis || '').trim() || undefined,
            },
          };
        }
      }
    } catch {/* fall through */}
  }
  return null;
};
```

A `fetchAbcSchedule: ScheduleFetcher` can be written against the same
`programitems/search.json` endpoint with `from=<midnight>&to=<midnight+24h>`
and grouped by `defining_timezone` (Australia/Sydney). Mirror the BBC schedule
implementation.

### Notes / weirdness

- **Talk channels return empty `now`.** Don't treat that as an error — it just
  means "no track playing." Surface programme info from the EPG endpoint
  instead.
- **EPG service filter is permissive.** Passing an unrecognised `service=` slug
  returns the unfiltered live-program firehose. The fetcher MUST verify
  `items[0].creating_service.service_id` matches the requested slug, or it'll
  show "Country Jukebox" on Triple J.
- **Service-ID casing.** Most slugs are lowercased — except `RN`. Hardcode the
  lookup table; don't rely on a transform.
- **Local Radio gaps.** Local stations relay national feeds overnight, so an
  empty `from→to=NOW+1h` window is normal at 02:00 AEST and is not a bug.
- **Cover art domains.** Original full-size assets are on
  `www.abc.net.au/<network>/albums/...`; resized variants live on
  `resize.abcradio.net.au/<sig>/<dim>/center/middle/<urlencoded source>`. Both
  HTTPS, both CORS-friendly.
- **Track duration is in seconds** (not ms), unsigned int, often present.
- **`is_australian: true`** on artists is a nice signal we could surface in
  rrradio someday (Australian-music tag).
- **Terms of use.** Endpoints are unauthenticated and used by abc.net.au's own
  player, but the broader ABC site is © ABC and only the player UI is licensed
  for broadcast. Polling at `max-age` cadence (60–163 s) is the natural fit.
- **Streaming hosts.** Note for the human reviewer: the player config also
  exposed an HLS host `https://streaming.abc-cdn.net.au/audio/hls/<slug>.m3u8`
  that may be a higher-quality alternative to the existing
  `live-radio01.mediahubaustralia.com` / `abc.streamguys1.com` URLs in
  `data/stations.yaml`. Out of scope for this metadata recon, but worth noting
  for a future curation pass.
- **Sample files** at `data/metadata-discovery/abc-*.json` are gitignored (per `.gitignore` `data/metadata-discovery/`), so this PR commits only the docs section. To re-capture: `curl -s "https://music.abcradio.net.au/api/v1/plays/triplej/now.json"`, `curl -s "https://music.abcradio.net.au/api/v1/plays/search.json?station=triplej&order=desc&limit=10"`, `curl -s "https://program.abcradio.net.au/api/v1/programitems/search.json?service=triplej&from=$(date -u +%FT%TZ)&to=$(date -u -v+1H +%FT%TZ)&include=next,with_images,resized_images&limit=5"`.

## kexp — KEXP 90.3 FM (US)

Investigated: 2026-05-09.

KEXP runs a clean, fully public Django REST Framework v2 API at
`api.kexp.org` powering their player and the open-source KEXP iOS
/ Android apps. CORS is wide-open (`*`) on every endpoint probed,
no auth, no rate-limit headers observed. The data is the richest
of any broadcaster recon'd so far: every play row carries
MusicBrainz release / recording / artist / label IDs, a cover-art
URL sourced from the Internet Archive, and three boolean flags
(`is_live`, `is_local`, `is_request`) that flag in-studio
sessions, Pacific-Northwest local artists, and listener requests
respectively. The current show carries DJ name + headshot, the
program name + program artwork, and a free-form `tagline` the DJ
edits live (today's read: `Happy Saturday! Reach out
dj@kexp.org, text 206-903-5397, @djmorganseattle :)`).

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| API root (lists collections) | `https://api.kexp.org/v2/` | none | `*` | `data/metadata-discovery/kexp-api-root.json` |
| Now-playing (most recent play) | `https://api.kexp.org/v2/plays/?limit=1` | none | `*` | `data/metadata-discovery/kexp-plays-latest.json` |
| Track history (paged, default desc by airdate) | `https://api.kexp.org/v2/plays/?limit=N` | none | `*` | `data/metadata-discovery/kexp-plays-history.json` |
| Current show | `https://api.kexp.org/v2/shows/?limit=1` (or `…/shows/<id>/` from play.show_uri) | none | `*` | `data/metadata-discovery/kexp-show.json`, `kexp-shows-list.json` |
| Program detail | `https://api.kexp.org/v2/programs/<id>/` | none | `*` | `data/metadata-discovery/kexp-program.json` |
| Host detail | `https://api.kexp.org/v2/hosts/<id>/` | none | `*` | `data/metadata-discovery/kexp-host.json` |
| Schedule (timeslots) | `https://api.kexp.org/v2/timeslots/?limit=N` | none | `*` | `data/metadata-discovery/kexp-timeslots.json` |
| Cover art | `play.image_uri` / `play.thumbnail_uri` (Internet Archive CDN) | none | n/a (img tag) | embedded |
| Podcast feed | not via this API — KEXP archives live at <https://archive.kexp.org/> and select shows on Mixcloud / Apple Podcasts | n/a | n/a | n/a |

Headers from `GET https://api.kexp.org/v2/plays/?limit=1` (with
`Origin: https://rrradio.org`):

```
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
vary: Accept, Cookie, Origin
allow: GET, HEAD, OPTIONS
strict-transport-security: max-age=15768000
cf-cache-status: DYNAMIC
server: cloudflare
```

OPTIONS preflight returns `access-control-allow-methods: DELETE,
GET, OPTIONS, PATCH, POST, PUT` and a 24-hour `access-control-
max-age`. No `X-RateLimit-*` or `Retry-After` headers seen.

### Response shape — `/v2/plays/`

The `plays` collection is the single most useful endpoint. One
row per song, per airbreak, per timesignal etc. — distinguished
by `play_type`. Two values observed:

- `trackplay` — actual song. All track fields populated.
- `airbreak` — DJ talking, ad break, station ID. `song`,
  `artist`, `album` etc. are absent. `image_uri` is `""`. The
  fetcher must skip these and pull the most recent
  `trackplay`.

Annotated `trackplay` row (from `kexp-plays-latest.json`):

```json
{
  "id": 3652561,                              // primary key
  "uri": "https://api.kexp.org/v2/plays/3652561/",
  "airdate": "2026-05-09T13:41:37-07:00",     // ISO8601 with TZ; sort key (default desc)
  "show": 66672,                              // FK -> /shows/<id>/
  "show_uri": "https://api.kexp.org/v2/shows/66672/",

  // Cover art — Internet Archive CDN, MusicBrainz-keyed
  "image_uri":     "https://dn721502.ca.archive.org/.../mbid-68eb725d-…_thumb500.jpg",
  "thumbnail_uri": "https://dn721502.ca.archive.org/.../mbid-68eb725d-…_thumb250.jpg",

  // Track identity (MusicBrainz IDs are gold for downstream linking)
  "song":              "Deny",
  "track_id":          "b96e290c-0156-4f79-ac51-3f7d5cea5c65",
  "recording_id":      "e093086d-b925-404b-94ec-467127a40672",
  "artist":            "La Sécurité",
  "artist_ids":        ["a03666b0-23ba-455f-bc74-1e8a7140fed3"],
  "album":             "Bingo!",
  "release_id":        "68eb725d-8856-45b5-a530-99e8293bac0a",
  "release_group_id":  "26e8b170-ff2a-462b-92a1-638d7c6015d0",
  "labels":            ["Bella Union"],
  "label_ids":         ["2e72153d-8eb0-49a3-8b18-3a054d2c7f33"],
  "release_date":      "2026-06-12",

  // KEXP-specific signals
  "rotation_status": "Medium",                // Heavy / Medium / Light / null — KEXP rotation tier
  "is_local":   false,                        // Pacific Northwest artist
  "is_request": false,                        // listener-requested
  "is_live":    false,                        // played from an in-studio session
  "comment":    null,                         // DJ free-form note (sometimes long with newlines)
  "location": 1,
  "location_name": "Default",
  "play_type": "trackplay"
}
```

Pagination wrapper (DRF `PageNumberPagination` shape):

```json
{
  "count":    66551,
  "next":     "https://api.kexp.org/v2/plays/?limit=10&offset=10",
  "previous": null,
  "results":  [ … ]
}
```

`/v2/plays/` does NOT return `count` (likely cursor-style on the
unbounded plays collection); `/v2/shows/`, `/v2/timeslots/`,
`/v2/hosts/`, `/v2/programs/` all do.

### Response shape — `/v2/shows/<id>/`

Picks up the now-on-air programme + DJ. Retrievable either by
following `play.show_uri` from a fresh play row, or by hitting
`/v2/shows/?limit=1` (the shows collection is sorted by
`start_time` desc — index 0 is the current show).

```json
{
  "id": 66672,
  "uri": "https://api.kexp.org/v2/shows/66672/",
  "program":      18,
  "program_uri":  "https://api.kexp.org/v2/programs/18/",
  "hosts":        [34],
  "host_uris":    ["https://api.kexp.org/v2/hosts/34/"],
  "program_name": "Variety Mix",
  "program_tags": "Rock,Eclectic,Variety Mix",   // CSV string, not array
  "host_names":   ["Morgan"],
  "tagline":      "Happy Saturday! Reach out dj@kexp.org, text 206-903-5397, @djmorganseattle :)",
  "image_uri":         "https://www.kexp.org/.../morgan_800x800.jpg",       // DJ photo
  "program_image_uri": "https://www.kexp.org/.../variety-800x800.jpg",      // programme tile
  "start_time":   "2026-05-09T12:00:38-07:00",   // no end_time on the show object
  "location": 1,
  "location_name": "Default"
}
```

Note: `start_time` is when the *current* show began, but there's
no `end_time` on the show object — the next show's `start_time`
is the implicit boundary, or you cross-reference `/v2/timeslots/`
for the scheduled window.

### Response shape — `/v2/timeslots/`

Repeating weekly schedule (day-of-week + clock window). Useful
for an EPG / "what's on at 19:00" view, less so for live
now-playing.

```json
{
  "id": 57,
  "program_name": "Midnight in a Perfect World",
  "program_tags": "Eclectic,DJ,Variety Mix",
  "host_names":   ["Guest DJ"],
  "weekday":    1,                 // 1 = Monday (DRF default; Sunday=7 inferred — verify)
  "start_date": "2020-08-20",      // when this slot started in the rotation
  "end_date":   null,              // null = ongoing
  "start_time": "00:00:00",
  "end_time":   "01:00:00",
  "duration":   "01:00:00"
}
```

Total: 59 timeslots covering one week.

### Wirable today?

✅ **Wire-now, fully.** HTTPS, CORS `*`, no auth, structured
JSON with consistent shapes, MusicBrainz-grade IDs. This is the
cleanest broadcaster API in the catalog.

Recommended polling cadence: **15 s** for `/v2/plays/?limit=2`
(2 in case the latest is an `airbreak`; pick the most recent
`trackplay`). Show / programme / host can be cached for 5 min
keyed off `play.show`. KEXP's apps poll roughly that often, no
rate-limit signal.

### Suggested fetcher

New shape — needs its own `fetchKexpMetadata` in
`src/builtins.ts`. Closest existing analogue is
**`fetchOrfMetadata`** (also a multi-collection paged JSON API
with separate "now playing" + "current show" calls). Pattern:

1. `GET https://api.kexp.org/v2/plays/?limit=2`.
2. `result = first row whose play_type === 'trackplay'`. If
   none in the top 2, fall through to `null` (rare — happens
   only during long airbreaks).
3. Map: `artist = result.artist`, `track = result.song`,
   `coverUrl = result.image_uri || result.thumbnail_uri ||
   undefined`, `raw = `${artist} - ${track}``.
4. Optional second fetch (cache-keyed off `result.show`):
   `GET https://api.kexp.org/v2/shows/${result.show}/` to
   surface programme + DJ (`programme = `${program_name} with
   ${host_names.join(', ')}``).
5. Optional flag surfacing — if `is_live`, prefix track with
   `(In-studio) `; if `is_local`, surface a Pacific-Northwest
   tag; both are KEXP-defining UX touches we don't get
   elsewhere.

Schedule fetcher (`ScheduleFetcher`) is also straightforward off
`/v2/timeslots/` keyed by `weekday` + `start_time` / `end_time`,
but live now-playing is the priority.

### Notes

- **Terms of service:** the API has no public ToS page that
  came up; KEXP has historically been generous with its data
  (their iOS app is open source on GitHub, their archive is
  public). Honor the obvious "be a good citizen" defaults:
  attribute KEXP, cap polling at the player's cadence, set a
  recognizable `User-Agent`.
- **`api.kexp.org` is fronted by Cloudflare** with `cf-cache-
  status: DYNAMIC` on plays — they're NOT serving stale plays
  through the CDN. Good for freshness, modest extra origin
  load; another reason to keep our cadence at ~15 s.
- **`play_type` enum** observed: `trackplay`, `airbreak`. Older
  KEXP code in the wild references `nontrackplay` and
  `timesignal` — those may exist historically, treat any
  non-`trackplay` as "skip and look further back".
- **Image hosting on the Internet Archive** means we don't need
  CORS on the image (image tags don't enforce it). Some
  image_uri values are empty strings (`""`) on airbreaks —
  fetcher must coerce to `undefined`.
- **MusicBrainz IDs** open up future enrichment paths (artist
  bio, related artists, label catalog) without re-scraping
  KEXP. Worth recording in the catalog if we ever want
  cross-broadcaster track linking.
- **Archive / on-demand:** KEXP's "Streaming Archive" is on the
  main site (e.g. `https://www.kexp.org/playlist/streaming-
  archive/`) and select shows mirror to Mixcloud (e.g.
  `mixcloud.com/KEXP`). No on-demand API surfaced from the v2
  router — Phase-2 concern; live now-playing is fully covered.
- **Seattle time:** `airdate` and `start_time` always carry the
  `-07:00` (PDT) / `-08:00` (PST) offset — fetcher should pass
  through, not normalize away the offset (downstream "live now"
  comparisons want the absolute instant, not local clock).

## nrk — NRK / Norsk rikskringkasting (NO)

Investigated: 2026-05-09.

NRK exposes its programme service through the public **PSAPI** at
`https://psapi.nrk.no/` (a documented developer-facing host —
the docs index lives at `psapi.nrk.no/documentation` and the
source is at `github.com/nrkno/psapi-documentation`). The web
player at `radio.nrk.no` is a server-rendered Astro SPA that
hits PSAPI client-side; the player module is
`/_astro/Player.<hash>.js`. There is also a newer
`pages.radio.api.nrk.no` host but it is auth-walled
(redirects to NRK SSO) — PSAPI is the right surface.

**Two-step now-playing pipeline.** PSAPI does **not** expose a
single "current track on channel" endpoint. The web player
combines two calls:

1. `GET /epg/{slug}` — daily programme guide for the channel.
   Pick the entry whose `plannedStart` is the latest value
   `<= now`. Read its `programId` (e.g. `MKKL01025726`).
2. `GET /radio/catalog/programs/{programId}` — episode detail
   with a `playlist[]` array of music tracks (start time,
   duration, performer, work). Pick the entry whose
   `startTime <= now < startTime + duration`.

Step 2's `playlist` is **populated as the programme airs** for
music-led channels (P3, mP3, Klassisk, Jazz, Folkemusikk) but
typically lags by 1–2 tracks and is sometimes empty for the
*currently airing* episode if it's just started (the just-prior
programme is fully populated). For talk-led channels (P1, P2,
Sápmi, Alltid Nyheter, Nyheter) the `playlist` is usually empty;
talk shows instead populate `indexPoints[]` (segment markers
with reporter/title), which is useful for an "in this hour"
display rather than a track ticker.

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Channel directory (live) | `https://psapi.nrk.no/radio/live` | none | allowlist `radio.nrk.no` only | `data/metadata-discovery/nrk-radio-live.json` |
| Programme guide (per channel, today) | `https://psapi.nrk.no/epg/{slug}` | none | allowlist | `data/metadata-discovery/nrk-epg-p1.json`, `nrk-epg-p3.json`, `nrk-epg-klassisk.json`, `nrk-epg-jazz.json`, `nrk-epg-sapmi.json` |
| Episode detail with track playlist | `https://psapi.nrk.no/radio/catalog/programs/{programId}` | none | allowlist | `nrk-catalog-program-klassisk.json` (33 tracks, classical), `nrk-catalog-program-p3-detteer.json` (78 tracks, pop) |
| Channel-level metadata (title + cover) | `https://psapi.nrk.no/playback/metadata/channel/{slug}` | none | allowlist | `nrk-playback-metadata-p1.json`, `nrk-playback-metadata-klassisk.json` |
| HLS manifest (already used for streaming) | `https://psapi.nrk.no/playback/manifest/channel/{slug}` | none | allowlist | `nrk-playback-manifest-p1.json` |
| Series detail (covers, descriptions) | `https://psapi.nrk.no/radio/catalog/series/{seriesId}` | none | allowlist | n/a |
| Programme detail (legacy, sparse) | `https://psapi.nrk.no/programs/{programId}` | none | allowlist | `nrk-program-klassisk-natt.json` (NO `playlist` field — use `/radio/catalog/programs/` instead) |
| Cover art | embedded in EPG entries (`image.webImages[].imageUrl`, multiple widths on `gfx.nrk.no`) and in episode `image[]`/`series.image[]` | none | n/a (img tag, no fetch) | — |
| Podcast feed | n/a — `podkast.nrk.no` is a private SSO host, no public RSS surfaced from PSAPI | — | — | — |

**Channel slugs in PSAPI** (verified against `/radio/live`):
`p1`, `p1pluss`, `p2`, `p3`, `p3musikk`, `mp3`, `klassisk`,
`jazz`, `folkemusikk`, `sapmi`, `alltid_nyheter`, `radio_super`,
`sport`, plus 14 regional `p1_*` variants
(`p1_oslo_akershus`, `p1_hordaland`, …).

All seven catalog channels match: `p1`, `p1pluss` (NRK P1+),
`p2`, `p3`, `mp3`, `klassisk`, `jazz`, `folkemusikk`, `sapmi`.

### Response shape

**`/epg/{slug}`** — top-level array of length 1, the day. Each
day has an `entries[]` array of programme objects:

```jsonc
{
  "_links": { "program": { "href": "/programs/{programId}" } },
  "programId": "DMPT03105626",        // ← pass to /radio/catalog/programs/
  "seriesId": "dette-er-p3",
  "seriesTitle": "Dette er P3",
  "title": "Dette er P3",
  "description": "…",
  "category": { "id": "musikk", "displayValue": "Musikk" },
  "plannedStart": "/Date(1778365800000+0200)/",  // ← millis since epoch (.NET WCF format!)
  "actualStart":  "/Date(1778365800000+0200)/",
  "duration": "PT1H",                  // ISO 8601
  "image": { "webImages": [{ "imageUrl": "https://gfx.nrk.no/…", "pixelWidth": 300 }, …] },
  "firstTransmission": { "publicationDate": "2026-05-09T13:00:00+02:00", … },
  "type": "program"
}
```

**`/radio/catalog/programs/{programId}`** — episode detail
shaped like:

```jsonc
{
  "_links": {
    "self":   { "href": "/radio/catalog/programs/MKKL01025726" },
    "series": { "href": "/radio/catalog/series/klassisk-natt", "title": "Klassisk natt" },
    "share":  { "href": "https://radio.nrk.no/serie/klassisk-natt/MKKL01025726" }
  },
  "id": "c104f0…",                    // internal hash
  "episodeId": "MKKL01025726",        // ← matches the EPG programId
  "titles":         { "title": "I dag", "subtitle": "" },
  "temporalTitles": { "defaultTitles": { "mainTitle": "Klassisk natt", "subtitle": "9. mai 2026" } },
  "duration": { "iso8601": "PT2H51M", "displayValue": "2 t 51 min" },
  "image":     [{ "url": "https://gfx.nrk.no/…", "width": 300 }, …],
  "indexPoints": [],                  // talk-show segment markers when used
  "playlist":   [
    {
      "title":       "Kathryn Stott + Truls Mørk",                                    // performers (Klassisk) / song title (P3)
      "description": "Frédéric Chopin - Nocturne nr. 20, op. posth, ciss-moll",       // composer-work (Klassisk) / artist (P3)
      "startTime":   "2026-05-08T22:03:05.914+00:00",                                 // ISO 8601 UTC ← the live anchor
      "duration":    "PT4M34S",                                                       // ISO 8601
      "startPoint":  "PT5.914S",                                                      // offset from programme start
      "type":        "Music",
      "channelId":   "klassisk",
      "programId":   "MKKL01025726",
      "programTitle": ""
    }, …
  ]
}
```

### Field map (abstract → NRK keys)

| rrradio field | source | NRK key path |
|---|---|---|
| current programme name | `/epg/{slug}` entry | `entries[].title` (or `seriesTitle`) |
| current programme image | same | `entries[].image.webImages[].imageUrl` |
| programme start / end (window) | same | `actualStart` / `plannedStart` (`/Date(ms+offset)/`), `+ duration` (ISO 8601) |
| current programme id | same | `entries[].programId` |
| current track artist | `/radio/catalog/programs/{id}` playlist[] | **Klassisk/Folkemusikk:** `title`. **P3/mP3/Jazz:** `description`. |
| current track title | same | **Klassisk/Folkemusikk:** `description` (composer + work). **P3/mP3/Jazz:** `title`. |
| current track start | same | `startTime` (ISO 8601 UTC) |
| current track duration | same | `duration` (ISO 8601, parse `PT…` to seconds) |
| episode cover | same | `image[].url` (multiple widths) |

The artist/title swap by genre is annoying but consistent. The
fetcher should branch on the channel slug (or
`category.id === "musikk"` plus a slug allowlist of classical
channels). For Klassisk the `description` field is gold:
`"<Composer> - <Work>"` parses cleanly on `" - "`.

### `/Date(ms+tz)/` quirk

EPG entries use the .NET WCF date format
(`/Date(1778277600000+0200)/`) for `plannedStart`,
`actualStart`, `maxTransmissionWindow`, etc. The episode
playlist uses ISO 8601 (`2026-05-08T22:03:05.914+00:00`). Mixed
shapes — fetcher needs both parsers. Same `/Date()/` shape
appears in DR samples (PR #218) and is straightforward:
`Number(/Date\((\d+)/.exec(s)?.[1])` → epoch ms.

### Wirable today?

⚠️ **via worker proxy.** Mechanism is clean (HTTPS, public,
documented, no auth, no rate-limit headers, generous
`cache-control: public,max-age=60,stale-while-revalidate=300`),
but **CORS is allowlisted to `https://radio.nrk.no` only** —
not `*` and not `https://rrradio.org`. Verified with both a
preflight (`Access-Control-Allow-Origin: https://radio.nrk.no`)
and a `Origin: https://rrradio.org` GET (no `Access-Control-*`
returned).

The fetcher must therefore route through the rrradio worker
proxy (`worker/src/index.ts` allowlist), same pattern as the
SR (Saarländischer Rundfunk) fetcher.

### Suggested fetcher

New `fetchNrkMetadata` in `src/builtins.ts`. **Closest
analogue:** `fetchSrgssrIlMetadata` (HAL `_links` shape, public
JSON, ISO 8601 timestamps) and `fetchCroMetadata` (parallel
fetch + merge programme + track). Sketch:

```ts
// metadataUrl on each NRK station = the channel slug, e.g. "p1", "klassisk".
const NRK_BASE = `${PROXY}?url=${encodeURIComponent('https://psapi.nrk.no')}`;
// (or, more cleanly, encodeURIComponent the full URL each time)

const fetchNrkMetadata: MetadataFetcher = async (station, signal) => {
  const slug = station.metadataUrl;                  // e.g. "klassisk"
  if (!slug) return null;
  const epgUrl = `${PROXY}?url=${encodeURIComponent(`https://psapi.nrk.no/epg/${slug}`)}`;
  const epgRes = await fetch(epgUrl, { signal, cache: 'no-store' });
  if (!epgRes.ok) return null;
  const epg = (await epgRes.json()) as NrkEpgDay[];
  const entries = epg[0]?.entries ?? [];
  const nowMs = Date.now();
  const current = pickCurrentEntry(entries, nowMs);
  if (!current) return null;

  // Programme info (always available).
  const program = {
    name: current.seriesTitle ?? current.title,
    subtitle: undefined,
    coverArt: pickWebImage(current.image, 600),
    startsAt: parseDotNetDate(current.actualStart),
    endsAt:   parseDotNetDate(current.actualStart) + parseIsoDuration(current.duration),
  };

  // Track info (best-effort).
  const progUrl = `${PROXY}?url=${encodeURIComponent(`https://psapi.nrk.no/radio/catalog/programs/${current.programId}`)}`;
  const progRes = await fetch(progUrl, { signal, cache: 'no-store' });
  if (!progRes.ok) return { track: undefined, raw: '', program };
  const prog = (await progRes.json()) as NrkProgram;
  const cur = (prog.playlist ?? []).find(t => isLive(t, nowMs));
  if (!cur) return { track: undefined, raw: '', program };

  // Field swap by channel genre (Klassisk/Folkemusikk are inverted).
  const isClassical = slug === 'klassisk' || slug === 'folkemusikk';
  const artist = isClassical ? cur.title : cur.description;
  const title  = isClassical ? cur.description.replace(/^.+? - /, '') : cur.title;
  return {
    track: { artist, title, raw: `${artist} – ${title}` },
    raw: `${artist} – ${title}`,
    program,
  };
};

// pickCurrentEntry: latest entry where parseDotNetDate(actualStart) <= nowMs.
// isLive(t, nowMs): startTime <= nowMs < startTime + duration.
// parseDotNetDate('/Date(1778277600000+0200)/'): Number(/(\d+)/.exec(s)![1]).
```

Schedule fetcher (`SCHEDULE_FETCHERS_BY_KEY['nrk']`) is trivial
on the same EPG response — return the next ~6 entries with
their start times and images.

### Comparison with SR (PR #205) and DR (PR #218)

NRK is the **third Nordic public broadcaster** investigated and
sits between the other two:

|  | SR (sveriges-radio) | NRK (this PR) | DR (danmarks-radio) |
|---|---|---|---|
| host | `api.sr.se/api/v2` | `psapi.nrk.no` | `api.dr.dk/radio/v5` |
| now-playing track endpoint | `/playlists/rightnow?channelid=N` (single call) | EPG → catalog/programs (two calls, derive from playlist[]) | `/indexpoints/live/{slug}` (single call) |
| classical metadata | dedicated `composer` / `conductor` / `producer` fields on P2 Musik | swap of `title` / `description` semantics on Klassisk | `roles[].role === "Komponist"` flag |
| CORS | `*` (no proxy needed) | allowlist `radio.nrk.no` (proxy needed) | `*` (no proxy needed) |
| auth | none | none | public `x-apikey` recommended |
| timestamp shape | mixed — `startTime` ISO 8601, programme dates `/Date(ms)/` | mixed — playlist ISO 8601, EPG `/Date(ms+tz)/` | ISO 8601 throughout |
| programme cover | `socialimage` on episode | `image.webImages[].imageUrl` on EPG entry, `gfx.nrk.no` | `imageAssets[]` on channel |

**No, the three cannot share a single fetcher.** Wire shape
differs at every layer — host, route, response keys, CORS
posture. They share the *spirit* (public JSON, no auth, EPG +
track separation) but the keys don't line up. `fetchNrkMetadata`
should be its own function.

The classical-music richness is **most comparable to SR P2
Musik**: NRK Klassisk gives composer + work + performers +
durations on every track once the playlist populates. Worth
prioritising in the eventual fetcher rollout — it's a
genuinely beautiful dataset.

### Notes

- **Allowlist the worker:** add `psapi.nrk.no` to
  `worker/src/index.ts` `/api/public/proxy` allowlist before
  shipping the fetcher (same pattern as SR/Saarländischer
  Rundfunk and other proxy-routed broadcasters).
- **`playlist` lag:** the just-aired programme is the most
  reliable source. Live programme's playlist often lags by
  one track or is briefly empty at programme boundaries —
  fetcher should fall back to programme-level metadata
  (programme name + cover) when the playlist is empty, not
  return `null`.
- **Talk channels:** P1, P2, Alltid Nyheter, Sápmi rarely
  populate `playlist`. The fetcher should still surface
  programme info (`current.title` + `seriesTitle`) so the UI
  doesn't go dark. Optionally use `indexPoints[]` for "now in
  this segment" if we ever want sub-programme granularity.
- **Sápmi note:** EPG slug is `sapmi` (no diacritics). Returns
  same shape as P1; mostly Sami-language news / culture, low
  music density.
- **Image widths:** EPG entries return `webImages[]` at 300 /
  600 / 960 / 1280 / 1600 / 1920 px; `playback/metadata` returns
  `posters[].image.items[]` at 300 / 600 / 960 / 1920. Pick 600
  for mobile, 1280 for tablet/desktop hero.
- **Geo-blocking:** EPG endpoints work globally; on-demand
  programme content is geo-blocked to Norway (`isGeoBlocked:
  true` on past episodes). Live streaming + EPG + playlist
  metadata: no geo-block observed from a non-NO origin.
- **Cache headers:** `playback/metadata` is `max-age=15`,
  `radio/live` is `max-age=60`, `radio/catalog/programs` is
  `max-age=60, stale-while-revalidate=300, stale-if-error=600`.
  Comfortable polling cadence: programme info every 30 s,
  track playlist every 20 s.
- **No auth/token requirement detected.** No `Authorization`,
  no cookies, no query-param tokens. The `pages.radio.api.nrk.no`
  variant *does* require NRK SSO — avoid that host.
- **Repository public:** `github.com/nrkno/psapi-documentation`
  — useful but light on examples; the live SPA is a better
  reference.

## cbc — CBC / Radio-Canada (CA)

Investigated: 2026-05-09.

CBC and Radio-Canada (the same crown corporation, two web brands)
expose **two genuinely separate metadata APIs** — they share the
back-end stream/CDN infrastructure (`services.radio-canada.ca`
fronts the HLS validation + media-meta for *both* brands) but
the schedule/now-playing surfaces are different shapes on
different hosts:

- **English CBC (cbc.ca/listen)** — Apollo GraphQL at
  `https://www.cbc.ca/graphql`. Open CORS (`*`),
  introspection-disabled but the SPA ships `linearScheduleOnNow`
  and `linearScheduleUpNext` queries inline. Programme-level
  only (no track-level musics — Radio One is talk, CBC Music's
  per-track data flows through the gated `/music/dj/v1`
  user-keyed API, not surfaced anonymously).
- **French Radio-Canada (ici.radio-canada.ca/ohdio)** — Apollo
  GraphQL at `https://services.radio-canada.ca/bff/audio/graphql`.
  Schema is **introspectable** (`__schema { queryType { fields }
  }` works). Returns BOTH programme-level and **track-level
  music metadata** (title / artists / composers / per-track
  startTime+endTime) for ICI Musique and ICI Musique Classique
  via `broadcastSchedule` → `Broadcast.musics[]`. ICI Première
  (talk) returns the programme list with `musics: []` — same
  shape, just empty for talk shows. CORS is **scoped to
  `https://ici.radio-canada.ca`** — calls from any other origin
  return without `Access-Control-Allow-Origin`, so a worker
  proxy is mandatory for the French side.

Both surfaces also expose REST APIs that the SPAs use for
non-realtime data:

- `https://www.cbc.ca/listen/api/v1/program-queue/{networkID}/{location}`
  — full daily schedule for an English CBC region (no CORS,
  worker-proxy needed). Returns `programImage`, `hostName`,
  `epochStart/End`, plus a `neuroID` field that points at
  `services.radio-canada.ca/neuro/v1` (the per-show track
  history surface the iOS/Sonos apps use; the v1 root accepts
  the public `Client-Key 55e07958-9508-4084-b447-fff9b11a8b82`
  but every plain `/playlists/{neuroID}`-style probe returned
  404 — the right path shape lives in the mobile bundles, not
  the web bundle, so deferring deeper neuro investigation
  unless track-level CBC Music becomes a priority).
- `https://www.cbc.ca/listen/api/v1/live-radio/getLiveRadioStations?locations=…`
  and `…/live-streams` — the channel/region directory that
  maps `callSign` (e.g. `CBC_R1_TOR`) to streamID, idMedia,
  programGuideLocationKey. Useful for the catalog migration
  more than runtime now-playing.
- `https://services.radio-canada.ca/media/validation/v2?appCode=medianetlive&idMedia={N}&tech=hls&output=json`
  — resolves `idMedia` (15095..15137 currently) to the
  Akamai HLS master URL. Already used implicitly: our
  `cbcradiolive.akamaized.net` URLs were pre-resolved at
  curation time. Same model for French (different `appCode`).
- `https://services.radio-canada.ca/media/meta/v1/index.ashx?appCode=medianetlive&idMedia={N}&output=json`
  — channel metadata (TitleID, network, fallback image URL).
  No CORS. Useful for cover art and channel name normalisation
  but not now-playing.

**Catalog mapping discovered:**

| Station id | English callSign / French networkId+regionId |
|---|---|
| `builtin-cbc-radio-1-toronto` | `CBC_R1_TOR` (idMedia 15103) |
| `builtin-cbc-radio-1-vancouver` | `CBC_R1_VCR` (idMedia 15119) |
| `builtin-cbc-radio-1-montreal` | `CBC_R1_MTL` (idMedia ~15110) |
| `builtin-cbc-music` | `CBC_R2_TOR` (idMedia 15129; networkID=2 in `program-queue`) |
| `builtin-ici-premiere` (Montréal) | networkId 3 + regionId 8 |
| `builtin-ici-musique` (Montréal) | networkId 4 + regionId 8 |

The full callSign list (38 R1 regions + 5 R2 regions) is in
`data/metadata-discovery/cbc-live-radio-stations.json`. The
French regionId map is in `cbc-graphql-liveschedules-region8.json`
plus the per-region probes captured in this session
(regionId 1 = Abitibi/Rouyn, 4 = Sherbrooke, 7 = Trois-Rivières,
8 = Montréal, 9 = Québec, 10 = Saguenay, etc.; full map needs
one walk through regionIds 1–30 — only six showed up in the
ten probes I ran, the rest probably exist as well).

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| **EN now/next programme** | `POST https://www.cbc.ca/graphql` body `{ onNow: linearScheduleOnNow(callSign: "CBC_R1_TOR") { programTitle startTime endTime program { thumbnail title description } } upNext: linearScheduleUpNext(callSign: "CBC_R1_TOR") { … } }` | none | `*` | `cbc-graphql-onnow-r1tor.json`, `cbc-graphql-onnow-r2tor.json`, `cbc-graphql-onnow-r2vcr.json` |
| **EN daily schedule** | `https://www.cbc.ca/listen/api/v1/program-queue/{1\|2}/{programGuideLocationKey}` | none | absent — needs worker proxy | `cbc-program-queue-1-toronto.json`, `cbc-program-queue-2-toronto.json` |
| **EN station directory** | `https://www.cbc.ca/listen/api/v1/live-radio/live-streams` and `…/getLiveRadioStations?locations={a,b}` | none | absent | `cbc-live-streams.json`, `cbc-live-radio-stations.json` |
| **EN aggregate config** | `https://www.cbc.ca/aggregate_api/v1/key-values?key=phoenix.config` | none | `*` | `cbc-aggregate-phoenix-config.json` |
| **FR now-playing + schedule** | `POST https://services.radio-canada.ca/bff/audio/graphql` op `Broadcasts` with `params: { regionId: 8, broadcastingNetworkId: 4, device: "Web", liveSchedule: true }` selecting `broadcasts { startTime endTime title hosts kicker picture { pattern } musics { title artists composers startTime endTime } }` | none | `https://ici.radio-canada.ca` only — needs worker proxy | `rc-graphql-broadcastSchedule-icimusique-live.json` (current programme + track list), `rc-graphql-broadcastSchedule-icimusique.json` (full day), `rc-graphql-broadcastSchedule-icipremiere.json` (talk; empty `musics`) |
| **FR multi-network live schedules** | same endpoint, op `LiveSchedules` with `params: { regionId: N }` selecting `schedules { broadcastingNetwork { id title } broadcastingStationCallSign: broadcastingStationCodeName broadcasts { startTime endTime title } }` | none | scoped (worker) | `rc-graphql-liveschedules-region8.json`, `rc-graphql-liveschedules.json` |
| **Stream URL resolver (both brands)** | `https://services.radio-canada.ca/media/validation/v2?appCode=medianetlive&idMedia={N}&tech=hls&output=json` | none | absent | `cbc-media-validation-15095.json` |
| **Channel meta + fallback art** | `https://services.radio-canada.ca/media/meta/v1/index.ashx?appCode=medianetlive&idMedia={N}&output=json` | none | absent | `cbc-media-meta-15095-json.json` |
| **Cover art** | embedded in `program.thumbnail` (EN GQL) and `Broadcast.picture.pattern` (FR GQL — pattern is a CDN URL with `{width}` / `{ratio}` placeholders) | — | — | — |
| Podcast feed | n/a here — CBC publishes per-show feeds at `https://www.cbc.ca/podcasting/includes/{slug}.xml` but those are episode-level, not the live channel surface | — | — | — |

### Response shape

**EN — `linearScheduleOnNow / UpNext`** (via `cbc.ca/graphql`):

```jsonc
{
  "data": {
    "onNow": {
      "programTitle": "Saturday Afternoon at the Opera",
      "startTime": 1778356800000,        // epoch ms (UTC)
      "endTime":   1778371200000,
      "program": {
        "thumbnail":   null,             // sometimes a CDN URL, often null
        "title":       "Saturday Afternoon at the Opera",
        "description": "\nHere's where to get your weekly opera fix, presented by …"
      }
    },
    "upNext": { /* same shape */ }
  }
}
```

`program` is **frequently `null`** for Radio One on the GraphQL
side (only `programTitle` + start/end ms are reliable). The
richer `programImage` + `hostName` come from the REST
`program-queue` endpoint instead.

**FR — `Broadcasts(broadcastSchedule)`** (via
`services.radio-canada.ca/bff/audio/graphql`):

```jsonc
{
  "data": {
    "broadcastSchedule": {
      "broadcasts": [
        {
          "startTime": "2026-05-09T20:00:30.000Z",   // ISO 8601 (UTC)
          "endTime":   "2026-05-09T23:00:30.000Z",
          "title":     "C'est si bon",
          "subtitle":  "Marc Hervieux",
          "hosts":     "Marc Hervieux",
          "kicker":    "ICI Musique",
          "picture": {
            "alt":     "…",
            "pattern": "https://images.radio-canada.ca/q_auto,w_{width}/v1/audio/animateur/{ratio}/marc-hervieux-musique.png"
          },
          "musics": [
            {
              "title":     "MUSIC, MUSIC, MUSIC",
              "artists":   "AMES BROTHERS",
              "composers": "STEPHEN WEISS, BERNIE BAUM",
              "startTime": "2026-05-09T20:00:35.000Z",
              "endTime":   "2026-05-09T20:03:09.000Z"
            },
            // … 30+ tracks per programme
          ]
        }
      ]
    }
  }
}
```

`liveSchedule: true` filters the response to *just the currently
airing* programme(s), with the day's full track list embedded —
the fetcher walks `musics[]` and picks the entry where
`startTime <= now < endTime`. Without `liveSchedule: true` the
whole day comes back; either works, the live flag just keeps the
payload smaller.

The `picture.pattern` is a templated URL — substitute `{width}`
(e.g. `380`) and `{ratio}` (e.g. `1x1`) before using.

### Wirable today?

⚠️ partly — split by brand:

- **English CBC**: ✅ wirable directly. `cbc.ca/graphql` is
  CORS-open, GraphQL POSTs work from the browser. Programme-only
  (no track), but that matches Radio One's talk-heavy character
  and the existing `stream-only` baseline. Wins us programme
  title + start/end + sometimes thumbnail/description on six
  builtin entries (Toronto/Vancouver/Montréal Radio One + CBC
  Music). For CBC Music's track-level data, the public surface
  is gated (DJ API needs userId+playlistId pair); ICY-over-fetch
  is the only realistic anonymous track signal there until we
  reverse-engineer the mobile/Sonos neuro shape.
- **French Radio-Canada**: ⚠️ via-worker. Same wins as English
  *plus* track-level music for ICI Musique / Musique Classique,
  but only via the worker proxy (CORS scoped to
  `ici.radio-canada.ca`). Worth the proxy entry — track-level
  metadata is rarer than programme-level and ICI Musique is the
  best-case track signal in the catalog after BR/SWR/DR.

### Suggested fetcher

Two new fetchers in `src/builtins.ts`. They share enough
structure (programme schedule with start/endTime windowing) to
sit next to each other but are best kept separate — different
URLs, different shapes, different parsing rules.

```
fetchCbcMetadata     // POST cbc.ca/graphql with linearScheduleOnNow/UpNext, callSign per station.metadataChannel
fetchCbcSchedule     // GET cbc.ca/listen/api/v1/program-queue/{1|2}/{location} via worker proxy

fetchRadioCanadaMetadata  // POST services.radio-canada.ca/bff/audio/graphql via worker, op Broadcasts, liveSchedule:true
fetchRadioCanadaSchedule  // same call without liveSchedule:true → all-day list
```

Closest existing analogues:

- **`fetchBbcMetadata`** for the EN GraphQL pattern — both POST a
  fixed query, both return programme-level only, both do "pick
  the on-now block from a structured response". Shape-translate
  `data.onNow.programTitle` → track.program in our envelope.
- **`fetchSrgssrIlMetadata`** + **`fetchSwrMetadata`** for the FR
  shape — those scan a programme's `playlist[]` for the entry
  whose time window contains `now`. Same logic against
  `Broadcast.musics[]`. The ABC/SRG track-history pattern in
  `data/metadata-discovery/abc-*.json` is a closer match for the
  list semantics (history-of-N tracks per programme).

The worker proxy needs **two new allowlist entries** in
`worker/src/index.ts` (`/api/public/proxy`):

```js
/^https:\/\/www\.cbc\.ca\/listen\/api\/v1\/(program-queue|live-radio)\/.+$/i,
/^https:\/\/services\.radio-canada\.ca\/bff\/audio\/graphql$/i,  // POST — proxy must forward Origin: ici.radio-canada.ca
```

The Radio-Canada GraphQL POST needs the worker to spoof
`Origin: https://ici.radio-canada.ca` in the upstream request
(same trick as the BBC `/api/public/bbc/...` route uses for
`bbc.co.uk`). The current `/api/public/proxy` route forwards
plain GETs; for RC we either (a) extend it to forward POST
bodies + Origin header, or (b) add a dedicated
`/api/public/radio-canada/graphql` route mirroring the BBC
pattern, which is cleaner and probably the right shape.

Catalog YAML extension to support the fetchers (no schema break
needed, just new optional fields):

```yaml
# CBC Radio One Toronto
metadataChannel: CBC_R1_TOR     # → linearScheduleOnNow
programGuideKey:                 # → program-queue REST
  network: 1
  location: toronto

# ICI Musique Montréal
metadataChannel:
  networkId: 4
  regionId: 8
  brand: radio-canada
```

### Notes

- **Brand split is real.** English and French *do* share infrastructure
  (Akamai HLS, `services.radio-canada.ca` for stream resolution
  and metadata) but the live programme/now-playing surfaces are
  fundamentally different shapes — one Apollo GraphQL with
  callSign+English-only schema on `www.cbc.ca`, one Apollo
  GraphQL with regionId/networkId/French-aware schema on
  `services.radio-canada.ca/bff/audio`. Treat as two fetchers.
- **Introspection is open on the FR endpoint** (`services.radio-canada.ca/bff/audio/graphql`)
  — useful for verifying field names without touching the
  bundle. EN endpoint has introspection disabled by Apollo (the
  bundle inlines the queries we need anyway).
- **Public Client-Key for the legacy media player:**
  `Client-Key 55e07958-9508-4084-b447-fff9b11a8b82` (from
  `services.radio-canada.ca/media/player/js/prod`). Required by
  the `/neuro/v1/...` endpoints. Public/embedded; not an auth
  secret. Useful only if we end up wanting CBC Music track-level
  data via the neuro path (which I couldn't shape out from the
  web bundle).
- **No rate-limit headers** observed on either GraphQL host. The
  EN host caches at the CDN edge (`cache-control: max-age=300`
  on the REST live-radio endpoints). The SPA polls `linearSchedule*`
  on programme transitions only, not on a fixed interval — for
  rrradio, polling every 60–90 s is conservative.
- **No auth/cookies/tokens detected** for any of the documented
  endpoints. The ones that 403/404 (`hubcap`, `pages.radio.api.nrk.no`,
  `/api/v1/live-radio/...` without the `/listen/` prefix) are
  just stale paths in the bundle, not gated surfaces.
- **`MEDIA_NET_PLAYBACK_LOG_URL`** in `aggregate_api/v1/key-values?key=phoenix.config`
  points at `services.radio-canada.ca/music/dj/v1/playbacklog` —
  a POST-only analytics endpoint where the *client* logs plays
  back to CBC. Do not call from a fetcher. The phoenix.config
  payload itself is open-CORS and harmless to inspect.
- **iOS / mobile app neuro paths not surfaced.** The web bundle
  only references `/music/dj/v1/playlists/{userId}` (gated) and
  `/music/dj/v1/playbacklog` (logging). Track-level CBC Music
  on the live web stream is not anonymously available through
  the surfaces I found in this pass — deferring unless a future
  curation pass needs it.
- **Robots / ToS:** `cbc.ca/robots.txt` allows `*` on
  `/listen/api/`, `/api/`, and `/graphql`. `radio-canada.ca` /
  `services.radio-canada.ca` likewise. No "no-AI" or
  "no-aggregation" clauses spotted; these are the same surfaces
  that power Radio Browser's regional CBC entries.

## kcrw — KCRW 89.9 FM (US)

Investigated: 2026-05-09.

KCRW exposes a single public Rails-backed read API at
`tracklist-api.kcrw.com` (CloudFront-fronted, hosted on Heroku-
ish infrastructure: `Server: Puma`, Rails 6.1.7.8, NewRelic
instrumentation visible in error responses). It powers KCRW's
internal "Playlist Manager" UI at the same host (`/Programs`)
and surfaces public read endpoints for the **two music-tracked
channels** the station logs:

- **`Simulcast`** — the live FM signal at 89.9 (KCRW main).
  Music plays interleaved with NPR talk programming, so most
  hours of the day this channel returns rows for music shows
  only (`Morning Becomes Eclectic`, `Anne Litt`, evening DJs)
  with gaps during news / talk blocks. Programme metadata
  (start/end, host, programme title) is included on every row.
- **`Music`** — internal name for **Eclectic 24** (`program_id:
  e24`), KCRW's 24/7 always-music stream. Single rolling
  programme; ~100 plays per day in the captured sample. This
  is the one to point at for continuous track ticker.

Other KCRW streams in our catalog — **News24** and **Summer
Nights** — are **not** in the tracklist API surface. News24 is
all talk (no music tracking), and Summer Nights is a seasonal
DJ-mixed feed that doesn't currently log into the playlist
manager. `GET /News24`, `/SummerNights`, `/Eclectic24` (with
that exact case), `/jazz`, `/Programs/...` etc. all return the
playlist-manager HTML rather than JSON. Only `/Simulcast` and
`/Music` produce JSON.

The endpoint has been stable and publicly documented since at
least March 2016 (KCRW developer Alec Mitchell on Hacker News
[`news.ycombinator.com/item?id=11242187`]: "I'm pulling the
day's songs via the API: `tracklist-api.kcrw.com/Simulcast/...`")
and the schema has been backwards-compatible across that decade.

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Simulcast — now-playing (single object) | `https://tracklist-api.kcrw.com/Simulcast` | none | `*` | `data/metadata-discovery/kcrw-root-simulcast.json` |
| Simulcast — day history (array, desc) | `https://tracklist-api.kcrw.com/Simulcast/date/YYYY/MM/DD` | none | `*` | `data/metadata-discovery/kcrw-simulcast-history.json` |
| Music / Eclectic 24 — now-playing (single object) | `https://tracklist-api.kcrw.com/Music` | none | `*` | `data/metadata-discovery/kcrw-music-now.json` |
| Music / Eclectic 24 — day history (array, desc) | `https://tracklist-api.kcrw.com/Music/date/YYYY/MM/DD` | none | `*` | `data/metadata-discovery/kcrw-music-history.json` |
| Now-playing with rrradio Origin (CORS verify capture) | `https://tracklist-api.kcrw.com/Simulcast` (with `Origin: https://rrradio.org`) | none | `*` | `data/metadata-discovery/kcrw-simulcast-now-cors.json` |
| Cover art | `albumImage` / `albumImageLarge` (Spotify CDN, `i.scdn.co`) | none | n/a (img tag) | embedded |
| Programme schedule | not exposed; programme info is denormalised onto each play row | — | — | — |
| Podcast / on-demand feeds | not via this API; KCRW shows mirror to Apple Podcasts / Spotify | n/a | n/a | n/a |

Headers from `GET https://tracklist-api.kcrw.com/Simulcast`
(with `Origin: https://rrradio.org`):

```
HTTP/2 200
content-type: application/json; charset=utf-8
access-control-allow-origin: *
access-control-allow-methods: GET,OPTIONS
access-control-allow-headers: Origin, Content-Type, Accept, X-REQUESTED-WITH
access-control-max-age: 1728000
cache-control: max-age=15, public, must-revalidate
etag: W/"edf2e224b6f9656a44cb1d0f92607351"
x-cache: RefreshHit from cloudfront
x-frame-options: SAMEORIGIN
x-runtime: 0.078004
```

OPTIONS preflight returns **`access-control-allow-origin: *`**
in the headers but the body is a Rails 500
(`No route matches [OPTIONS] "/Simulcast"`). For our use this
is fine — a `GET application/json` is a CORS-simple request and
does not require a preflight. Any non-simple request (custom
header, non-GET) would trip on this 500. No `X-RateLimit-*` or
`Retry-After` headers seen across multiple captures.

CloudFront edge-caches each now-playing response for 15 s
(`cache-control: max-age=15`); polling faster than that just
hits a cached body. The sweet spot is **15 s**, matching the
CDN TTL — KCRW's own player polls at roughly that cadence.

### Response shape — `/Simulcast` and `/Music` (now-playing)

Both endpoints return **a single flat play object** (not a
list, not an envelope). Annotated:

```json
{
  // Affiliate / "buy this song" links — pre-baked URLs to iTunes,
  // Spotify, Amazon. Not useful for now-playing UI directly,
  // but interesting for a "where to listen" card.
  "affiliateLinkiPhone":  "https://itunes.apple.com/...?term=%22Sleater%E2%80%90Kinney%22+%22Modern+Girl%22",
  "affiliateLinkiTunes":  "...",
  "affiliateLinkSpotify": "spotify:search:Sleater%E2%80%90Kinney+Modern+Girl",
  "affiliateLinkAmazon":  "http://www.amazon.com/...&tag=kcco04-20",

  // External IDs — KCRW does MusicBrainz + Spotify lookups on
  // the backend (`/music_brainz/recordings?...` is in their
  // playlist-manager bundle). When matched, spotify_id /
  // spotify_preview / itunes_url get populated; otherwise null.
  "itunes_id":     null,
  "itunes_time":   null,
  "itunes_url":    null,
  "spotify_id":    "2GOQVqZ3uVp7LKVAY1T0mk",            // 22-char base64 — Spotify track URI suffix
  "spotify_preview": "https://p.scdn.co/mp3-preview/...?cid=...",  // 30-second mp3, public

  // Programme block context (denormalised onto every row)
  "program_id":    "wb",                                 // short slug; e24 = Eclectic 24, mb = Morning Becomes Eclectic, wb = ?, varies by show
  "program_start": "12:00",                              // local clock string, no date
  "program_end":   "15:00",                              // → "this programme block runs 12:00–15:00 today"
  "program_title": "Anne Litt",                          // human-readable title (sometimes the host's name when the show IS that host)
  "host":          "Anne Litt",                          // explicit DJ field; "" when programme is host-anonymous (Eclectic 24 stream)
  "credits":       null,
  "guest":         null,                                 // populated when a guest DJ / live session is on

  // Track identity
  "title":         "Modern Girl",
  "artist":        "Sleater‐Kinney",                // unicode-non-breaking-hyphen used in artist names
  "album":         "The Woods",
  "label":         "Sub Pop Records",
  "year":          "2005",                               // string, sometimes null
  "artist_url":    "http://www.sleater-kinney.com/",     // editorial URL (may be http://, may be empty/null)

  // Cover art — Spotify CDN images (when matched)
  "albumImage":      "https://i.scdn.co/image/ab67616d00001e027d7487703050853d8d952bb7",  // ~300x300 thumb
  "albumImageLarge": "https://i.scdn.co/image/ab67616d0000b2737d7487703050853d8d952bb7",  // ~640x640 full

  // Channel + timing
  "channel":  "Simulcast",                               // or "Music" for Eclectic 24 endpoint (NB: NOT "Eclectic24")
  "offset":   7706,                                      // seconds since midnight local — NOT a timestamp, NOT track position
  "time":     "02:08 PM",                                // local clock string (Pacific)
  "date":     "2026-05-09",                              // ISO date string (local Pacific)
  "datetime": "2026-05-09T14:08:26-07:00",               // ISO 8601 with Pacific offset — the canonical sort key
  "comments": "",                                        // DJ free-form note — usually empty, but used on some shows
  "play_id":  1055338                                    // monotonically increasing primary key
}
```

Empty / null patterns to handle:

- `albumImage` and `albumImageLarge` are **`null`** when KCRW
  hasn't matched the track on Spotify (small indie / live-in-
  studio recordings). Coerce to `undefined` for the cover-art
  field.
- `host` is empty string `""` for the Eclectic 24 channel (no
  named DJ — it's a curation feed). Coerce to `undefined`.
- `year`, `label`, `artist_url`, `guest`, `credits` are
  frequently `null` / `""`. Treat as missing.
- `spotify_id`, `spotify_preview`, `itunes_*` are null when no
  external match — fine, those are optional enrichment, not
  primary now-playing.

### Response shape — `/Simulcast/date/YYYY/MM/DD` and `/Music/date/...`

Returns **an array of the same shape**, sorted by `datetime`
descending (newest first). Sample sizes seen:

- `/Simulcast/date/2026/05/09` (today, partial): 35 rows from
  one programme block (`Anne Litt`, 12:00–15:00). The morning
  hours of Simulcast are mostly NPR talk and produce no rows.
- `/Simulcast/date/2026/05/08` (yesterday, full day): 60 rows
  across two programmes (`Morning Becomes Eclectic`,
  `Resident DJ`).
- `/Music/date/2026/05/09` (today, partial): 100 rows — single
  rolling Eclectic 24 programme.

Pagination via `?page=N` is **silently ignored** on now-playing
(`/Simulcast` always returns the latest single object) and is
not needed on `/date/...` (the array is the full day, not paged).

### Wirable today?

✅ **Wire-now, fully.** HTTPS, CORS `*`, no auth, single-object
JSON shape with consistent fields, ~10-year-stable schema,
denormalised programme info on every row. Slightly less rich
than KEXP (no MusicBrainz IDs surfaced; programme metadata
lacks an end-of-show boundary signal beyond `program_end`
clock string) but cleaner than most public-radio APIs we've
seen because the now-playing call is **one round trip**, no
separate show / DJ / programme lookup needed.

Recommended polling cadence: **15 s** for the now-playing
endpoint, matching the CloudFront edge TTL. Faster polling
returns the same cached body. KCRW's own playlist-manager UI
polls at roughly that cadence.

The two streams that map to tracklist-api channels:

| Catalog id | Stream | Map to |
|---|---|---|
| `builtin-kcrw-live` / `us-kcrw-live-89-9-fm-aac` | `streams.kcrw.com/kcrw_{mp3,aac}` | `/Simulcast` |
| `builtin-kcrw-eclectic` / `us-kcrw-eclectic-24-aac` | `streams.kcrw.com/e24_{mp3,aac}` | `/Music` |

The two streams that **don't** map (no music metadata
available; leave at status `stream-only`):

- `us-kcrw-news24` (`streams.kcrw.com/news24_mp3`) — NPR talk; no track data.
- `us-kcrw-summer-nights` (if present) — seasonal DJ feed; not tracked.

### Suggested fetcher

New shape — needs its own `fetchKcrwMetadata` in
`src/builtins.ts`. Closest existing analogues:

- **`fetchKexpMetadata`** (about to ship in PR #221) — same US
  public-radio profile, same "single endpoint surfaces both
  track and programme" pattern, similar Spotify/MB ID
  enrichment. The structural difference is that KEXP returns a
  paged list with one row per *play* (including non-track
  airbreaks that the fetcher skips); KCRW returns a single
  pre-filtered "current track" object directly. So **the KCRW
  parser is simpler** — no list traversal, no airbreak skip,
  just map fields one-to-one. About 60–70 % of `fetchKexp`'s
  surface logic transfers; the actual fetch + parse is shorter.
- **`fetchOrfMetadata`** as a structural cousin — both have a
  channel/programme/track tree returned in a single response,
  differing in whether to surface programme name + host
  prominently.

Pattern:

```ts
// channel: derived from station.metadataChannel — "Simulcast" | "Music"
// (Catalog YAML extension: each KCRW station entry gets
// metadataChannel: Simulcast or metadataChannel: Music)

const url = `https://tracklist-api.kcrw.com/${channel}`;
const res = await fetch(url, { headers: { Accept: 'application/json' } });
const r = await res.json() as KcrwPlay;

return {
  artist: r.artist || undefined,
  track:  r.title  || undefined,
  raw:    r.artist && r.title ? `${r.artist} - ${r.title}` : undefined,
  coverUrl: r.albumImageLarge || r.albumImage || undefined,
  programme: r.program_title || undefined,
  host: r.host || undefined,           // empty on Eclectic 24 — surfaces as undefined
  album: r.album || undefined,
  // Optional extras the catalog-side renderer can pick up later:
  // spotifyId: r.spotify_id, spotifyPreview: r.spotify_preview, year: r.year, label: r.label
};
```

No worker proxy entry needed — `tracklist-api.kcrw.com` returns
`access-control-allow-origin: *` so the browser can fetch
directly. (Contrast with broadcasters where the worker has to
spoof an Origin header for a missing-CORS endpoint.)

### Notes

- **Vercel mitigation on `www.kcrw.com`.** The main KCRW site
  is on Vercel and returns `429 + x-vercel-challenge-token`
  for non-browser User-Agents on every path. Their actual
  player JS bundle (which would document this same API in
  context) was unreachable from our recon network. We cross-
  validated the `tracklist-api.kcrw.com` endpoint via direct
  schema capture + the 2016 Hacker News post + GitHub
  references (`ciyer/kcrw-playlists`, `KCRW-org/*` repos) —
  the API has been the canonical surface for a decade, and
  the live data sample pulled today (2026-05-09) shows the
  same shape that's been used since at least 2016 (additive
  changes only: `affiliateLink*` keys, `spotify_preview` are
  newer; everything else is original).
- **Cover art is on Spotify's CDN** (`i.scdn.co`). Spotify
  serves images CORS-friendly and HTTPS-only; no proxy needed.
  Expect ~70 – 80 % match rate; small/indie/live tracks won't
  have an image.
- **Time zone: Pacific.** All `time`, `date`, and `datetime`
  fields are in `-07:00` (PDT) / `-08:00` (PST). The fetcher
  should pass through, not normalise to UTC — downstream "is
  this current?" comparisons want the absolute instant.
- **`offset` is seconds-since-midnight local**, not a
  timestamp. Useful for "minutes into the show" displays;
  irrelevant for now-playing. Don't confuse with track
  position.
- **`program_end` is a clock string** with no end-of-day
  carry. Programmes that span midnight (`23:00`–`02:00`)
  would presumably break this naive interval check; haven't
  observed one yet. For KCRW the music programmes mostly run
  3-hour daytime/evening windows and don't cross midnight.
- **Eclectic 24 channel name asymmetry.** Catalog stations use
  the slug `eclectic24` and KCRW's own URLs say
  `kcrw.com/music/shows/eclectic24`, but the tracklist-api
  channel is **`Music`** (capital M, no number). The
  `program_id` field is `e24` and `program_title` is
  `Eclectic 24`. The catalog YAML extension should pin
  `metadataChannel: Music` explicitly and not auto-derive.
- **No history endpoint per-track.** `/Music/song/<id>` and
  `/play/<id>` return the manager-UI HTML, not JSON. If we
  ever want a per-track detail surface (writer credits, full
  Spotify profile), we'd have to follow the `spotify_id` to
  Spotify's open API or to MusicBrainz directly using the
  external IDs as keys.
- **`/Programs` is the playlist-manager UI**, not a public
  programme schedule. It's a Rails-served SPA at the same host
  (bundle: `/packs-test/js/application-<hash>.js`) — staff-
  facing, requires auth for write ops. Reads of `/Simulcast`
  and `/Music` are open to anyone; the SPA is just the editor
  on top.
- **Robots / ToS:** no `robots.txt` or developer-terms page
  surfaced for `tracklist-api.kcrw.com`. KCRW historically
  publishes its data widely (the 2016 HN post explicitly
  documents the endpoint as the way to do it); their sister
  station KEXP is similarly open-handed. Honour the obvious
  defaults: identifiable User-Agent, attribute KCRW, cap
  polling at the CDN TTL.
- **No rate-limit headers seen** across 6 captures. CloudFront
  edge caching means our load on origin is negligible at any
  reasonable cadence.
- **Suggested next broadcaster:** **WFMU** (Jersey City, the
  freeform public-radio peer to KCRW/KEXP — already in
  `broadcasters.yaml`, station count in catalog, distinctly
  different shape: known to publish per-show playlists at
  `wfmu.org/playlists/<show>` rather than a unified API,
  which makes it a good test of the "no canonical API
  endpoint" branch of the recon flow). Alternative: **WNYC**
  / **NPR member-station umbrella** if we want to cover the
  US public-radio cluster systematically before moving to
  international.

## sbs — SBS / Special Broadcasting Service (AU)

Investigated: 2026-05-09.

SBS is Australia's secondary public broadcaster (sister to ABC). Multilingual /
multicultural focus, runs eight live audio channels: SBS Radio 1/2/3 (talk +
language services), SBS Chill (downtempo), SBS PopAsia (J/K/C/V-pop), SBS
PopDesi (South Asian pop, page is now `/audio/radio/south-asian`), SBS Arabic24
(`sbs-pop-araby` internally), and SBS Sounds of Home / SBS EuroPop on the
`sbs4` HLS slot.

The web player at `sbs.com.au/audio/radio/{slug}` (and
`sbs.com.au/audio/music/{slug}`) is a Next.js 14 app whose live-channel page
calls **two endpoints on `https://fos.sbs.com.au`** (the "Front Of Site" service)
to render the now-playing UI:

1. `GET /web/audio/current-song/{epgId}?delay=90` — the live track now playing
   on a music channel (or `{}` if the channel is currently airing a talk
   programme or no fingerprinting is happening).
2. `GET /web/audio/channels?ids={bspId}` — programme-level metadata for one or
   more channels: `currentProgram`, `schedule[]` (next ~10 entries), `bspId`,
   `epgId`, `streamUrl`, `streamMimeType`, `name`, `leadImage`, `description`,
   plus a **denormalised `currentSong` object** (same shape as endpoint 1) when
   the channel `hasSongs: true` and a track is being recognised.

A third endpoint exists for the "Recently played" UI:

3. `GET /web/audio/songs?channels={epgId}&date={ISO-hour}&delay=90` — track
   history for one channel for a given hour bucket. Returns
   `{ "{epgId}": [...songs...] }` with each song carrying `status: "history"`
   (or `status: "playing"` for the still-airing track at top).

All three endpoints are open `Access-Control-Allow-Origin: *`, no auth, plain
GET, return `application/json; charset=utf-8`. The `delay=90` query parameter
is hardcoded in the bundle (chunk module `43075`); it tells the server to look
~90 s back to align with HLS audio buffer. The bundle code is at
`/_next/static/chunks/7984-*.js` (`useQuery` hook id `OS` → fetches `current-song`
+ `channels` in parallel via `Promise.allSettled`) and
`/_next/static/chunks/6302-*.js` (the `Songs` history hook).

**Two key IDs per channel:**

- `epgId` (string slug) — used by the `current-song/{epgId}` and `songs?channels=`
  endpoints. Values: `sbs-radio-1`, `sbs-radio-2`, `sbs-radio-3`, `sbs-pop-araby`
  (Arabic24), `sbs-chill`, `sbs-pop-asia`, `sbs-pop-desi`, `sbs-euro-pop`.
  Short variants like `chill`, `popasia`, `poparaby`, `popdesi` exist as
  alternate `channelId`s on the page DOM but the FOS API only accepts the
  `sbs-*` prefixed form.
- `bspId` (Brightspot CMS UUID) — used by `channels?ids={bspId}`.
  Both IDs are inlined in the page's `__next_f` SSR data.

### Channel mapping (catalog ↔ SBS API)

| rrradio station id | epgId | bspId | HLS slug | hasSongs |
|---|---|---|---|---|
| `builtin-sbs-chill` | `sbs-chill` | `00000183-abaa-db73-ab83-ffbf5e740000` | `sbschill` | true |
| `au-sbs-popasia` *(currently `broadcaster: independent`)* | `sbs-pop-asia` | `00000183-abac-d32e-a3cb-bbffa66c0000` | `popasia` | true |
| `au-sbs-radio-1` *(currently `broadcaster: independent`)* | `sbs-radio-1` | `00000183-ab9e-d32e-a3cb-bbdfda660000` | `sbs1` | false |
| *(not in catalog)* SBS Radio 2 | `sbs-radio-2` | `00000183-aba0-d32e-a3cb-bbff0b7d0000` | `sbs2` | false |
| *(not in catalog)* SBS Radio 3 | `sbs-radio-3` | `00000183-aba2-db73-ab83-ffbf96a40000` | `sbs3` | false |
| *(not in catalog)* SBS PopDesi / South Asian | `sbs-pop-desi` | `00000183-abae-da02-a9df-fbbf27f30000` | `popdesi` | true |
| *(not in catalog)* SBS Arabic24 | `sbs-pop-araby` | `00000183-abaf-db73-ab83-ffbfdec20000` | `arabic` | true (advertised; today saw `currentSong: null` mid-talk-show) |

The SBS player uses **HTTP** HLS URLs in some places (e.g. `streamUrl` field of
the `channels` response, and the `sbs-sounds-of-home-fm` entry of
`livestreamUrls`); the page-level `livestreamUrls` block uses HTTPS for everything
except sbs4. Catalog stays HTTPS-only — the front-end metadata fetcher only
needs `fos.sbs.com.au` (HTTPS) regardless.

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing track (music channels) | `https://fos.sbs.com.au/web/audio/current-song/{epgId}?delay=90` | none | `*` | `data/metadata-discovery/sbs-current-song-sbs-chill.json`, `…sbs-pop-asia.json`, `…sbs-pop-desi.json` (talk channels return `{}`: `…sbs-radio-1.json`, `…sbs-radio-2.json`, `…sbs-radio-3.json`, `…sbs-pop-araby.json`, `…sbs-euro-pop.json`) |
| Channel info + programme + denormalised currentSong + schedule | `https://fos.sbs.com.au/web/audio/channels?ids={bspId}` (comma-separable for batch) | none | `*` | `sbs-channels-sbs1.json` (talk; 23 KB, 15-entry schedule), `sbs-channels-chill.json`, `sbs-channels-popasia.json`, `sbs-channels-popdesi.json`, `sbs-channels-arabic.json` |
| Track history for a channel (per-hour bucket) | `https://fos.sbs.com.au/web/audio/songs?channels={epgId}&date={ISO-hour:00:00.000Z}&delay=90` | none | `*` | `sbs-songs-history-chill.json` (15 tracks for the previous-hour bucket on SBS Chill) |
| Cover art | embedded — track-level `image` is an iTunes/Apple Music CDN URL (`is1-ssl.mzstatic.com/.../450x450bb.jpg`); programme-level `thumbnail` is `images.sbs.com.au/...` | — | n/a (img tag) | — |
| HLS stream manifest | `https://sbs-hls.streamguys1.com/hls/{slug}/playlist.m3u8` (already the catalog `streamUrl`) | none | n/a (stream) | — |
| Brightspot CMS GraphQL | `https://cms.sbs.com.au/graphql/delivery/sbscontentapi` | none (uses cookie session for editorial UI) | (not probed in this pass — page-content surface, not now-playing) | n/a |
| Podcast feed | n/a — SBS publishes per-show feeds on `sbs-podcast.streamguys1.com/` directly as MP3 + analytics URL params, no public RSS index found via the SPA. The CMS GraphQL likely surfaces episode lists if needed | — | — | — |

### Response shape

**`/web/audio/current-song/{epgId}`** (music channel, song playing):

```jsonc
{
  "image":           "https://is1-ssl.mzstatic.com/image/thumb/Music221/.../450x450bb.jpg",
  "songName":        "Caravan",
  "artist":          "Novelbright",
  "startTime":       "2026-05-10T07:15:44+10:00",       // ISO 8601 with AEST offset
  "endTime":         1778361575000,                     // epoch ms (UTC)
  "duration":        "00:03:51",                        // HH:MM:SS string
  "channel":         "sbs-pop-asia",
  "status":          "playing",
  "songDisplayName": "Caravan by Novelbright"
}
```

Talk channel or no recognition: `{}` (literally — empty object, not 404, not
null fields). Detect via `Object.keys(payload).length === 0` or the absence of
`songName`.

**`/web/audio/channels?ids={bspId}`** — top-level array of one entry per `id`:

```jsonc
[
  {
    "epgId":          "sbs-pop-asia",
    "bspId":          "00000183-abac-d32e-a3cb-bbffa66c0000",
    "name":           "SBS PopAsia",
    "description":    "…",
    "streamUrl":      "http://sbs-hls.streamguys1.com/hls/popasia/playlist.m3u8",  // ← HTTP, ignore in favour of catalog
    "streamMimeType": "application/x-mpegURL",
    "leadImage":      { "alt": "...", "attributes": { "sizes": [{ "src": "..." }] } },
    "route":          { "permalink": "/audio/music/popasia", … },
    "hasSongs":       true,
    "currentProgram": {
      "title":       "Sunday Sleep-in",
      "description": "Turn it on, but keep it down low.",
      "thumbnail":   "https://images.sbs.com.au/.../popasia-music-4.jpg",
      "startTime":   "2026-05-09T19:00:00.000Z",       // ISO 8601 UTC
      "endTime":     "2026-05-09T23:00:00.000Z",
      "duration":    14400000,                          // ms
      "programMetadata": {
        "programmeType": "music",                       // "music" | "news"
        "isReplay":      false
      }
    },
    "currentSong": {
      "songName": "Back to Life", "artist": "&TEAM", "image": "https://...",
      "startTime": "2026-05-10T07:18:01+10:00", "endTime": 1778361680000,
      "duration": "00:03:19", "channel": "sbs-pop-asia",
      "status": "playing", "songDisplayName": "Back to Life by &TEAM"
    },
    "schedule":     [ /* next ~10–15 programmes, same shape as currentProgram */ ],
    "allPrograms":  [ /* full directory entries — used for "All Programs" UI */ ]
  }
]
```

Talk channels (Radio 1/2/3, Arabic24 mid-talk-show): `currentSong` is omitted
or `null`, `hasSongs` is `false` (or `true` but `currentSong: null` for Arabic24).
`currentProgram` is always populated.

**`/web/audio/songs?channels={epgId}&date={hour}`** — bucketed by hour:

```jsonc
{
  "sbs-chill": [
    { "songName": "Melting Hazard", "artist": "Salamanda", "image": "...",
      "startTime": "2026-05-10T06:55:44+10:00", "endTime": 1778360450000,
      "duration": "00:05:06", "channel": "sbs-chill",
      "status": "history", "songDisplayName": "Melting Hazard by Salamanda" },
    { "songName": "Bluafterglow", "artist": "Tasuki", … },
    // ~12–15 entries per hour for an active music channel
  ]
}
```

The first entry's `status` may be `"playing"` if it's still airing; the rest
are `"history"`. Tracks without artwork have no `image` key (rather than
`image: null`).

### Wirable today?

✅ for the music channels (Chill, PopAsia, PopDesi) — full track-level
now-playing + cover art + recent-history list, all CORS-clean and auth-free,
direct browser fetch. No worker proxy needed.

⚠️ partial for the talk/language channels (Radio 1/2/3, Arabic24, EuroPop):
the `current-song` endpoint always returns `{}`, but the `channels` endpoint
returns rich programme-level data — show title, description, host-language
thumbnail, start/end window. Equivalent to BBC's `/schedules/now/.../` shape.
Wirable as programme-only metadata.

❌ for cross-fading / segue-tight DJ-mix tracks: SBS Chill's track ticker has
the same 90-second buffer-alignment delay as its competitors and a few entries
land slightly out of order against actual airtime. Acceptable for our use.

### Suggested fetcher

New `fetchSbsMetadata` in `src/builtins.ts`. Closest analogues:

- **`fetchAbcMetadata`** — same country, same Next.js + `fos`-style live-audio
  service split. ABC's `music.abcradio.net.au` ↔ SBS's
  `fos.sbs.com.au/web/audio/current-song/`; ABC's `program.abcradio.net.au` ↔
  SBS's `fos.sbs.com.au/web/audio/channels`. Pattern-match the parser.
- **`fetchHrMetadata`** / **`fetchSrgssrIlMetadata`** for the
  "channels-style endpoint that also embeds `currentSong`" pattern — single
  fetch returns programme + song.

Recommended call strategy:

```
For SBS music channels (epgId in {sbs-chill, sbs-pop-asia, sbs-pop-desi}):
  1. GET /web/audio/channels?ids={bspId}
     → if currentSong present, use it for track + programme.
     → else use currentProgram only (the channel briefly went into a talk
       segment).
  2. Optionally batch multiple ids with `?ids=A,B,C` (not yet probed but the
     HTML's plural query param + `[ ... ]` array-of-N response shape strongly
     suggests it). One call covers Chill+PopAsia+PopDesi.

For SBS talk channels (sbs-radio-1/2/3, sbs-pop-araby, sbs-euro-pop):
  GET /web/audio/channels?ids={bspId}
  Map currentProgram → metadata "now showing" slot. No track signal.
```

Polling cadence: ~60 s is conservative. The bundle's `react-query` hook uses
the default `staleTime: 0` + page-focus refetch; no polling timer in the chunk.
The `delay=90` already absorbs HLS skew, so no per-track timing magic needed.

Catalog YAML extension (optional fields, no schema break):

```yaml
# SBS Chill
metadata:
  broadcaster: sbs
  epgId: sbs-chill                       # for /current-song/ + /songs
  bspId: 00000183-abaa-db73-ab83-ffbf5e740000  # for /channels
```

The fetcher reads both fields; if `epgId` is present and the channel has
`hasSongs: true` per the directory, it queries `current-song` first; otherwise
it falls back to `channels` for programme-only.

### Catalog hygiene

The current catalog has only **one** correctly-tagged SBS station
(`builtin-sbs-chill`). Two more (`au-sbs-popasia`, `au-sbs-radio-1`) exist but
are tagged `broadcaster: independent` (likely RB-import artefact —
`broadcaster: independent` is the default for unattributed Radio Browser
entries). When the fetcher PR lands, those two should be retagged
`broadcaster: sbs` so the per-broadcaster fetcher actually picks them up.
SBS Radio 2/3, PopDesi, Arabic24, EuroPop are all live and reachable via
`https://sbs-hls.streamguys1.com/hls/{slug}/playlist.m3u8` but not yet in our
catalog — worth a curate-pass after wiring metadata.

### Notes

- **No rate-limit headers** observed (`X-RateLimit-*` absent, no `Retry-After`).
  The CDN (CloudFront fronting AWS API Gateway — see
  `x-amzn-requestid`, `x-amz-apigw-id`) caches at the edge; headers reflect
  short TTLs (< 60 s) on `current-song` and `songs` since responses are time-
  sensitive. The `channels` endpoint returns `etag: W/"..."` and supports
  conditional `If-None-Match` if we want to be polite.
- **No auth, no cookies, no signed URLs.** The CORS preflight returns
  `access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE` (overly
  permissive — they didn't lock down to GET, but we only call GETs).
- **`fosService` host is environment-templated** in the page (`clientEnvVars`):
  the production value is `https://fos.sbs.com.au`. SBS may have other env
  values for staging; the SPA reads `window.config` at boot. Use the prod
  hostname statically.
- **`delay=90` is mandatory in practice.** Setting it to `0` gives "playing
  right now" data which leads our HLS buffer; SBS's audio is delayed ~80–95 s
  end-to-end. Keep the default 90.
- **Apple Music as artwork CDN.** Track artwork URLs are `is1-ssl.mzstatic.com`
  (Apple Music) — SBS resolves track → iTunes ID server-side. Fast, reliable,
  CORS-open, and matches what other Aus broadcasters (Triple M, Nova, KIIS)
  also do. Programme-level art lives on `images.sbs.com.au`
  (Brightspot-fronted, also CORS-open).
- **Brightspot CMS GraphQL** (`cms.sbs.com.au/graphql/delivery/sbscontentapi`)
  was not probed in this pass — it's the editorial-content surface (articles,
  podcast pages, language-section pages), not the live now-playing surface.
  Worth a follow-up only if we want to surface podcast-episode metadata
  alongside live channels.
- **iOS app uses the same FOS endpoints.** The bundle hint:
  `userProfileApiUrl: "https://user-profile.pr.sbsod.com"` and the `pr.sbsod.com`
  pattern is shared with the iOS / smart-TV apps. No app-only metadata API
  found.
- **ToS / robots:** `sbs.com.au/robots.txt` allows `*` for `/audio/`,
  `/news/`, etc. `fos.sbs.com.au` has no public robots. The endpoints are
  the same surface used by the public web player.

## rnz — RNZ / Radio New Zealand (NZ)

Investigated: 2026-05-09.

RNZ runs a Rails-rendered website at `www.rnz.co.nz` with a
small React/Vite player bundle hosted at
`resources.rnz.co.nz/assets/index.js` (Vercel-fronted). The
player is a custom-element-based widget (`<rnz-queue-player>`,
`<rnz-queue-media>`, `<rnz-site-header>` registered via
`customElements.define`) that takes its data from server-rendered
HTML attributes — there is **no JSON now-playing endpoint**
hit by the live player. The four streams are hard-coded into
the bundle:

```js
// from resources.rnz.co.nz/assets/index.js, kG variable
national:   https://radionz.streamguys1.com/national/national/playlist.m3u8
concert:    https://radionz.streamguys1.com/concert/concert/playlist.m3u8
pacific:    https://radionz.streamguys1.com/pacific/pacific/playlist.m3u8
parliament: https://radionz.streamguys1.com/parliament/parliament/playlist.m3u8
```

There is an AWS API Gateway host at `api.rnz.co.nz` but it
returns `403 Forbidden { "message": "Forbidden" }` to anonymous
GETs (CloudFront -> API Gateway with auth required). Not a
public surface — likely the editorial CMS / mobile-app backend.
Stop signal per the skill: *no anonymous JSON endpoint* for
live track data exists.

**The only signals available to a fetcher are server-rendered
into the schedule pages.** Specifically:

1. `/concert/schedules/<YYYYMMDD>` — RNZ Concert daily schedule
   with **full classical track lists** for each programme block:
   composer, work, performer, catalogue/label, optional
   instrument annotations. This is the high-value output.
2. `/<channel>/schedules/<YYYYMMDD>` — for `national`,
   `international` (Pacific), and concert: programme-level
   schedule grid (time, title, optional description). National
   and Pacific are talk-led and surface only programme metadata,
   not tracks.
3. `<rnz-site-header>` web-component attributes — `current-programme`
   and `latest-bulletin` JSON blobs. **Note**: the
   `current-programme` value is **global RNZ-wide** (the same
   "Mediawatch" payload appeared on `/concert` as on `/national`
   in the capture), so it cannot be used as a per-channel
   on-now signal. The `latest-bulletin` is the most recent RNZ
   News bulletin podcast MP3 — useful for an "RNZ News" surface
   but not channel-bound.

There is no JSON / GraphQL / podcast-feed surface that exposes
*currently airing* programme + track on a per-channel basis.
The schedule HTML is the substitute, scraped + parsed
client-side, with the consumer picking the entry whose start
time is the latest value `<= now`.

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Daily schedule (Concert) — programme + track lists | `https://www.rnz.co.nz/concert/schedules/<YYYYMMDD>` | none | absent | `data/metadata-discovery/rnz-concert-schedule-day.html` |
| Daily schedule (National) — programme + descriptions | `https://www.rnz.co.nz/national/schedules/<YYYYMMDD>` | none | absent | `data/metadata-discovery/rnz-national-schedule-day.html` |
| Daily schedule (Pacific) — programme + descriptions | `https://www.rnz.co.nz/international/schedules/<YYYYMMDD>` | none | absent | `data/metadata-discovery/rnz-pacific-schedule-day.html` |
| Whole-week schedule (any channel) | `https://www.rnz.co.nz/<channel>/schedules/whole_week/<YYYYMMDD>` | none | absent | n/a (same shape, denser) |
| Channel homepage — current programme block | `https://www.rnz.co.nz/<channel>` | none | absent | `data/metadata-discovery/rnz-national-homepage.html`, `rnz-concert-homepage.html` |
| Streams config (player bundle) | `https://resources.rnz.co.nz/assets/index.js` | none | `https://staging.rnz.co.nz` only | `data/metadata-discovery/rnz-streams-config.json` |
| Site-header current-programme + latest-bulletin (global, not per-channel) | embedded in any rnz.co.nz page HTML | none | absent | `data/metadata-discovery/rnz-site-header-{national,concert}.json` |
| News RSS | `https://www.rnz.co.nz/rss/news.xml` | none | absent | not captured (XML, not metadata) |
| Concert RSS | `https://www.rnz.co.nz/rss/concert.xml` | none | absent | not captured |
| Auth-walled JSON gateway | `https://api.rnz.co.nz/...` | required | n/a | returns 403; stop |
| Stream-side ICY metadata | `https://radionz.streamguys1.com/<channel>/<channel>/playlist.m3u8` | none | absent | n/a (HLS, no in-band ICY exposed) |

`Cache-Control: max-age=900, public` (15 min) on schedule
pages — Fastly edge cache. `max-age=300` on the Vercel-hosted
player bundle. Polling cadence well above 60 s is safe;
robots.txt `Crawl-delay: 7` is the broadcaster's stated floor
for crawlers.

### Response shape

#### Concert daily schedule HTML — the high-value surface

Programme blocks are `<li class="o-digest o-digest--schedule o-digest--standard">`,
each with:

- `<em class="o-digest__time">12:00 <small class="ampm">AM</small></em>`
  — start time in 12 h local NZ time. **No date/timezone in the
  markup**; the day comes from the URL path.
- `<a href="/concert/programmes/<slug>">Programme Title</a>`
  inside the `<h4 class="o-digest__title">` (or just title text
  if no programme page exists).
- `<div class="o-digest__detail">` containing `<p>` blocks. For
  Concert, each `<p>` is one track in the form:
  ```
  Composer, FirstName: Work title <em>(catalog/movement)</em> -
    Performer <em>(instrument)</em> [, additional performers]
    <em>(Label CATNUM)</em>
  ```
  with hour markers like `<p><strong>1:00</strong> approx</p>`
  scattered through the list.

Example single track from the capture:

```
<p>Beethoven, Ludwig van: Piano Sonata No 24 in F# Op 78 -
Jonathan Biss <em>(piano)</em> <em>(Onyx 4094)</em></p>
```

Mapping to abstract fields:
- **artist** -> composer (`Beethoven, Ludwig van`) or performer
  depending on display preference. For a classical fetcher I'd
  set `artist = composer`, `title = work`, and stash performer
  + catalogue in a free-text subtitle.
- **title** -> work (`Piano Sonata No 24 in F# Op 78`).
- **performer** -> text after the ` - ` separator, before the
  closing `<em>` (`Jonathan Biss (piano)`).
- **catalogue** -> final `<em>` (`Onyx 4094`).
- **track start time** -> not exposed per track. Only programme-
  block start time (e.g. `12:00 AM`) and approximate hour
  markers (`<strong>3:00</strong> approx`) are visible. This is
  RNZ Concert's editorial reality — they publish the *order*
  but not minute-precise timestamps for the music played within
  a multi-hour show.

This pairs well with the SR P2 Musik / NRK Klassisk
classical-rich tier in spirit, but with **lower precision**:
NRK ships per-track `startTime + duration` via the PSAPI
`programs/{programId}.playlist[]` array; RNZ Concert ships only
hourly approximations baked into static HTML.

#### National / Pacific daily schedule HTML

Same `o-digest--schedule` block structure, but `o-digest__detail`
contains a one-paragraph programme description rather than a
track list. Useful for a programme-name now-playing display
(equivalent to NRK's talk-channel `playlist=[]` + `indexPoints`
fallback), not for track tickers.

#### Channel homepage "on now" widget

Every channel page has a fixed-position card:

```html
<a class="content" href="/national/programmes/mediawatch">
  <span class="label _small_caps">on now</span>
  <h4>Mediawatch</h4>
  <span class="other _small_caps">Sundays at 9:05am and 10:12pm</span>
</a>
```

**Per-channel current programme** lives here, not in the
`<rnz-site-header>` `current-programme` attribute. The `<h4>`
is the programme title, the `<a href>` slug uniquely identifies
it, and the trailing `<span class="other">` is a static
recurrence note ("Weekdays at 6am") rather than a precise time
window. No image URL is in this widget directly; the cover art
comes from the adjacent `<rnz-queue-media media='{"images":...}'>`
JSON blob in the same row.

#### `<rnz-queue-media media='{...}'>` blob (per-row JSON)

For every play button in the page (live stream, podcast episode,
news bulletin), the media JSON has a stable shape:

```json
{
  "id": "concert",
  "audioSrc": "https://radionz.streamguys1.com/concert/concert/playlist.m3u8",
  "liveStreamName": "concert",
  "title": "RNZ Concert",
  "images": {
    "detail":    "https://rnz-ressh.cloudinary.com/.../rnz-concert-stream-cover",
    "detail_2x": "...",
    "thumb":     "...",
    "thumb_2x":  "..."
  }
}
```

For on-demand episodes the same shape carries `id` (numeric),
`title` (episode title), `context` (programme name),
`audioSrc` (mp3), `releaseDate`, `duration` in seconds, and
the same `images` map. This is the right place to source
**channel cover art** — the four strings above
(`rnz-{national,concert,pacific,parliament}-stream-cover`) are
deterministic Cloudinary public IDs, so a fetcher can hard-code
the cover URL rather than scrape it.

#### Site-header (global, not per-channel)

`<rnz-site-header current-programme='{"name":"...","code":"...",
"thumbnailUrl":"..."}' latest-bulletin='{"id":"...","audioSrc":
"...","duration":...}'>` — the `current-programme` is RNZ-wide
(same value on `/national` and `/concert`); the
`latest-bulletin` is the most recent RNZ News audio. Not
useful as a per-channel signal but a reasonable source for an
"RNZ news" pseudo-channel.

#### Cover art

Channel cover art lives at deterministic Cloudinary URLs (taken
from the player bundle):

```
https://media.rnztools.nz/rnz/image/upload/.../rnz-national-stream-cover
https://media.rnztools.nz/rnz/image/upload/.../rnz-concert-stream-cover
https://media.rnztools.nz/rnz/image/upload/.../rnz-pacific-stream-cover
https://media.rnztools.nz/rnz/image/upload/.../rnz-parliament-stream-cover
```

Programme-specific covers are at
`media.rnztools.nz/rnz/image/upload/<signed-prefix>/.../<asset-id>_<slug>_..._<ext>?_a=...`.
The signed prefix changes per transformation, so the cleanest
source is to take the URL directly from the
`<rnz-queue-media media='{...}'>` blob next to the on-now
widget rather than constructing it.

### Wirable today?

[warning] partial-via-worker — programme-level only.

Justification: There is no clean JSON now-playing endpoint.
The data is ingestable but only by HTML-scraping
`/concert/schedules/<YYYYMMDD>` (and
`/<channel>/schedules/<YYYYMMDD>` for national/pacific) plus
the on-page "on now" widget on each channel homepage. None of
these surfaces emit CORS headers, so a fetcher would route
through `worker/src/index.ts` `/api/public/proxy` with a new
allowlist entry. RNZ Concert is the one channel where the
output is meaningfully richer than ICY-over-fetch (full
composer/work/performer/label, hourly-precision); RNZ National
and RNZ Pacific gain only programme-name + description, which
ICY would already cover if the streams emitted it (they don't —
the HLS playlists are bare).

Status taxonomy implication: the three published RNZ stations
(`stream-only` today) would step up to `working` or
`fetcher-todo` once a fetcher lands; cover art and channel-card
metadata are ready to wire immediately even without the
schedule scraper.

### Suggested fetcher

New shape; needs its own `fetchRnzMetadata` in `src/builtins.ts`.

Closest analogue: **none of the existing JSON fetchers**, since
all of them parse JSON. The parsing is closer to the BBC
station-page fallback path, but RNZ doesn't have a Sounds-style
JSON twin to fall back to.

Sketch:
1. `metadataChannel` per station — one of `national`, `concert`,
   `international` (or `pacific`), `parliament`. Map to URL
   `https://www.rnz.co.nz/<channel>/schedules/<YYYYMMDD>` where
   `YYYYMMDD` is today's date in **Pacific/Auckland**.
2. Fetch through worker proxy (CORS missing).
3. Parse the HTML: extract every `<li class="o-digest--schedule">`,
   pull the `<em class="o-digest__time">`, the `<h4>` title +
   slug, and the `<div class="o-digest__detail">` body.
4. Combine the schedule slot start times with the day's date
   (NZST/NZDT) to compute UTC start instants. Pick the entry
   with the latest start `<= now`.
5. For RNZ Concert: when the `o-digest__detail` contains
   `<p>` blocks matching the composer pattern
   `^[^:]+:\s.+\s-\s.+\(.+\)$`, treat each `<p>` as a track in
   sequence. Use the hourly `<strong>HH:MM</strong> approx`
   markers to bisect the list against current time. Result:
   approximate now-playing track. Confidence: hour-bucket-level.
6. For RNZ National/Pacific: emit programme-name only as
   "now playing" with the description as subtitle; leave
   artist/title null.
7. Cover art: hard-code the four Cloudinary URLs from the
   bundle into the fetcher; treat as static channel metadata.

Catalog YAML extension (optional, no schema break):

```yaml
# RNZ Concert
metadataChannel: concert         # one of national | concert | international | parliament
classicalRich: true              # enable composer/work/performer parsing
```

`classicalRich` is the toggle that gates the
`o-digest__detail` `<p>` walker; the National and Pacific
stations leave it false.

Day-boundary handling: at NZ midnight, fetch *both* yesterday
and today; the hour `<strong>11:00</strong> approx` markers in
overnight programmes (e.g. "Music Through the Night") run past
midnight and are easier to bisect with both pages in hand.

### Notes

- **No live API; no JSON path.** Several "obvious" probes
  (`/api/live/national`, `/api/now-playing/<channel>`,
  `/api/v1/...`, `services.rnz.co.nz`, `audio.rnz.co.nz`,
  `radionz.streamguys1.com/.../metadata.json`) all return 404 /
  NXDOMAIN. The only `api.rnz.co.nz` host that resolves is
  AWS-API-Gateway-fronted and 403s to anonymous traffic.
- **`<rnz-site-header current-programme>` is a trap.** It
  reads like a per-channel current programme but in practice
  serves the same global RNZ-news payload across all channel
  pages. Use the in-page `<a class="content"><span>on now</span><h4>`
  block, not the header attribute.
- **Schedule HTML has no per-track timestamps on Concert.**
  Programmes have a single start time (e.g. `06:00 AM`) and the
  body is a `<p>`-per-track list, with optional hour markers
  (`<strong>7:00</strong> approx`). The fetcher's resolution is
  hour-bucket, not minute. This is RNZ's editorial product —
  not a missing field we can request, just how Concert
  publishes its log.
- **CORS is uniformly absent on rnz.co.nz.** Every schedule and
  homepage URL serves no `Access-Control-Allow-*`. Fetcher
  must go through the worker. The bundle host
  `resources.rnz.co.nz` *does* set
  `Access-Control-Allow-Origin: https://staging.rnz.co.nz`
  (single origin, not `*`) — irrelevant to us anyway since the
  bundle has no live data.
- **Cloudinary is the cover-art store.** `media.rnztools.nz`
  fronts a Cloudinary tenant; URLs are signed but the asset
  IDs (`rnz-national-stream-cover` etc.) are stable. Channel
  thumbnails can be hard-coded; programme thumbnails should be
  read out of the in-page `<rnz-queue-media>` JSON blob since
  the signature prefix rotates.
- **robots.txt** at `https://www.rnz.co.nz/robots.txt`:
  `Crawl-delay: 7`, `Disallow: /admin/`, blanket `Allow: /` for
  the catch-all `User-Agent: *`. AI-specific bots
  (`Amazonbot`, `PerplexityBot`, `Perplexity-User`,
  `AdsBot-Google`, `YouBot`, `Webz.io`, etc.) are explicitly
  Disallowed. rrradio's fetcher polling is well below the
  crawl-delay floor (1 request per minute per channel <= 1 / 7s),
  but a clear `User-Agent` string and a citation of RNZ as the
  source on the now-playing surface are both warranted.
- **No rate-limit headers** (`X-RateLimit-*`, `Retry-After`)
  observed on any captured endpoint. Cache TTLs (`max-age=900`
  on schedule HTML) implicitly cap useful poll frequency.
- **Streamguys HLS** for the audio is bare-bones — no in-band
  ID3 metadata, no `metadata.json` sidecar. ICY-over-fetch
  doesn't help; HTML-scrape is the only path.
- **API gateway exists but is private.** `api.rnz.co.nz` is
  AWS-API-Gateway-fronted (CloudFront -> API Gateway, returns
  `x-amzn-errortype: ForbiddenException`). Likely powers the
  RNZ mobile app(s) with an embedded key — not investigated
  further; bypassing auth is out of scope for this skill.
- **Smaller catalog than ABC.** 3 published rrradio stations
  (National, Concert, Pacific) + 1 not-currently-listed
  (Parliament, NZ-only relevance). Concert is the only channel
  where a fetcher would be a meaningful upgrade over the
  current `stream-only` status.

## rtbf — RTBF / Radio-Télévision Belge de la Communauté Française (BE)

Investigated: 2026-05-09.

### TL;DR

RTBF's AUVIO web player resolves live radio metadata via the
**streamabc** metadata-as-a-service platform — the same shape we already
parse with `fetchStreamabcMetadata` (Klassik Radio family). The endpoint
is keyed by an internal Red Bee Media `streamId` (`redbm_<id>`) which is
discoverable from a small BFF widget call. CORS is open, no auth, no
sliding tokens. Music-heavy channels (Classic 21, Tipik, Tarmac, Musiq3)
return real artist + song; talk channels (La Première, Vivacité, Jam)
return programme-only data.

### Topology

```
auvio.rtbf.be (Next.js SPA, Auvio brand)
  └─ bff-service.rtbf.be/auvio/v1.23/widgets/<id>
       └─ widget 18858 / 18893 = "RADIO_LIVE"
          → channel list with streamId per channel (redbm_xxx_yyy)

api.streamabc.net/metadata/channel/<streamId>.json
  → now-playing (artist + song for music channels,
                 programme info for talk channels)
```

The web player has no separate "now playing" call — when the user clicks
a channel from the live list, the player passes the `streamId` straight
to streamabc. Stream URLs (`radios.rtbf.be/<slug>-128.mp3`) 302-redirect
through `redbeemedia.streamabc.net` (Red Bee Media's streaming edge).

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Channel list (radio, all 25 incl. Classic 21 sub-channels) | `https://bff-service.rtbf.be/auvio/v1.23/widgets/18858?_page=1&_limit=40` | none | `*` | (used to discover streamIds; not committed) |
| Channel list (radio, "RADIO_LIVE" widget on a chaine page) | `https://bff-service.rtbf.be/auvio/v1.23/widgets/18893` | none | `*` | (also embedded in Auvio's Next.js SSR `__NEXT_DATA__`) |
| **Now-playing per channel** | `https://api.streamabc.net/metadata/channel/<streamId>.json` | **none** | **`*`** | `data/metadata-discovery/rtbf-{classic21,la-premiere,vivacite,musiq3,tipik,jam,tarmac}-streamabc.json` |
| Track history | not available — single "now" object only, no list endpoint discovered | — | — | — |
| Programme schedule | embedded in now-playing (`extdata.TitreEmission` + `HeureDebut`/`HeureFin`) — no separate EPG endpoint surfaced | — | — | — |
| Cover art | embedded (`extdata.VisuelEmission` for programme art; `cover` and `images.large.url` are present in the schema but were empty in all 7 captures) | — | — | — |
| Podcast feed | not investigated this pass (Auvio podcasts ship through `widget` MEDIA_LIST/PROGRAM_LIST endpoints, structurally similar to TV-on-demand) | — | — | — |

### channelId → streamId map (full RTBF radio inventory)

From `bff-service.rtbf.be/auvio/v1.23/widgets/18858` (25 channels). The
seven we have in the catalog today are bold; the others are
sub-channels we don't ship yet.

| channelId | label | streamId |
|---:|---|---|
| **5** | **Classic 21** | `redbm_jpnzfz9xn_vcpk` |
| **6** | **La Première** | `redbm_rfjq5bsen_cgdo` |
| **10** | **Vivacité** | `redbm_0m6pgddmi_pnew` |
| **32** | **Tipik** | `redbm_e3tfmdazg_a0ms` |
| **7** | **Musiq3** | `redbm_p8zpxwyb9_gvoa` |
| 24 | TARMAC | `redbm_j7yfpneoq_plxj` |
| 36 | Viva + | `redbm_46dyiulmu_y2w8` |
| 104 | Viva Sport | `redbm_thg7yxjyx_iumy` |
| **35** | **Jam** | `redbm_edouzby7c_qhxw` |
| 45 | Classic 21 60's | `redbm_fd7qs0ra5_rmh4` |
| 51 | Classic 21 70's | `redbm_yxqbs9asr_azhc` |
| 46 | Classic 21 80's Hits | `redbm_hp0cr0ups_yige` |
| 126 | Classic21 80's New Wave | `redbm_uthycln66_xziz` |
| 47 | Classic 21 90's | `redbm_lvorperuy_cssd` |
| 48 | Classic 21 Metal | `redbm_yifzj55tf_qwnb` |
| 53 | Classic 21 Blues | `redbm_dsnqypduf_4iwx` |
| 70 | Noir Jaune Rock | `redbm_62wvzoe7z_ga0w` |
| 55 | Route66 | `redbm_hxqt7gjxl_vg55` |
| 63 | Classic 21 Soulpower | `redbm_siuquknok_egox` |
| 108 | Classic 21 Underground | `redbm_xbbmjgfqf_aywg` |
| 109 | Classic 21 Live | `redbm_gkvv6okxp_8m6p` |
| 106 | Musiq3 Top du Classique | `redbm_e14stvhdi_x009` |
| 107 | Musiq3 Baroque | `redbm_muag3d2ls_x9ll` |
| 105 | Musiq3 Jazz | `redbm_i5yvt8j7j_51v7` |
| 127 | Tipik à l'ancienne | `redbm_hqkih6ilx_ov1w` |

(Pure FM, currently in our catalog, isn't in the RADIO_LIVE widget
anymore — the channel was rebranded to Tipik in 2021. The legacy
`radios.rtbf.be/pure-128.mp3` URL still resolves to a working stream
but doesn't appear in Auvio's "écoutez en direct" list. Either remove
from catalog or alias it to Tipik on a separate curation pass.)

### Response shape

`api.streamabc.net/metadata/channel/<streamId>.json` returns a single
"now" object — same shape as the existing `StreamabcResponse` interface
in `src/builtins.ts`, but with RTBF-specific French keys in `extdata`.

```json5
{
  "channel": "Classic21",      // brand name (sometimes the streamId on talk channels — quirky)
  "station": "rtbf",            // always "rtbf" — useful for cross-channel detection
  "type": "now",                // always "now" on this endpoint
  "artist": "SERGE GAINSBOURG", // UPPERCASE for music channels; channel name placeholder for talk
  "song":   "OVERSEAS TELEGRAM",// empty string for talk channels
  "album":  "",                 // never populated in 7 captures
  "cover":  "",                 // never populated; use extdata.VisuelEmission
  "images": {                   // schema reserves slots; all empty in 7 captures
    "large":  { "url": "" },
    "medium": { "url": "" },
    "small":  { "url": "" }
  },
  "start":           "09.05.2026 23:21:17",  // local time, dd.mm.yyyy
  "start_timestamp": 1778361677,              // unix seconds
  "duration":        205824,                   // milliseconds
  "isrc":   "",     // never populated
  "asin":   "",     // never populated
  "source": "metapush",
  "extdata": {
    "TitreEmission":   "DR BOOGIE",                                  // programme name
    "Presentateur":    "Walter De paduwa",                           // host (free-form casing)
    "VisuelEmission":  "https://static-content.rtbf.be/.../...jpg",  // programme cover (16x9 or 10x10)
    "VisuelChaine":    "https://static-oaos.rtbf.be/.../classic21.png",
    "NomChaine":       "Classic 21",                                 // human channel name
    "SloganChaine":    "Écoutez l'Original",
    "HeureDebut":      "21:00",                                      // programme start (local)
    "HeureFin":        "23:59"                                       // programme end
  }
}
```

**Music channels (Classic 21, Tipik, Tarmac, Musiq3, Musiq3 sub-channels,
Classic 21 sub-channels, Route66, Noir Jaune Rock, Viva +):**
artist + song are real and update with the now-playing track.

**Talk channels (La Première, Vivacité, Jam, Viva Sport):** `artist`
is set to the channel name (e.g. `"La Première"`, `"Vivacité"`,
`"Jam"`) and `song` is `""`. The useful payload is
`extdata.TitreEmission` + `HeureDebut`/`HeureFin` +
`VisuelEmission`. The existing `fetchStreamabcMetadata` rejects this
with `if (!data.song) return null;` — that guard would have to change,
**or** the new RTBF fetcher folds programme info into a
`program: { name, subtitle, ... }` even when there's no track.

**Mixed channels:** Tipik shipped `TIPIK PARTY` (programme) AND a real
artist+song (`JUNIOR JACK & ADESSO MUSIC` / `PIETRO MORELLO MIXE DS
TIPIK PARTY`) in the same response — so both surfaces should be
populated when both fields are present.

### CORS / auth / rate-limit

- **`Access-Control-Allow-Origin: *`** on `api.streamabc.net`. Browser-side fetch works.
- **No auth, no cookies, no query-param tokens.** Tested without `Origin` and with `https://rrradio.org` — same 200 response.
- **No rate-limit headers** observed on the 7 captures. The streamabc CDN responds in <80 ms with `Cross-Origin-Embedder-Policy: require-corp` (irrelevant for `fetch`-with-cors-mode-cors).
- **HTTP 204 (No Content)** for unknown channelkey slugs; **HTTP 200** with full body for valid streamIds. Useful sanity for the fetcher: treat 204 as "nothing playing" not "broken".

### Wirable today?

✅ — clean. HTTPS, open CORS, no auth, structured fields. Same shape as
the existing `fetchStreamabcMetadata` modulo the talk-channel "no song"
case and the French `extdata` keys. The 5 catalog stations (Classic 21,
La Première, Musiq3, Vivacité, Tipik) plus Jam and Tarmac if added
later all key off the same endpoint with their `streamId`.

### Suggested fetcher

Two equally clean options:

**(A) Extend `fetchStreamabcMetadata`** to (1) accept an absent `song`
when `extdata` carries programme fields, and (2) treat the French
`extdata.TitreEmission` / `Presentateur` / `VisuelEmission` /
`HeureDebut` / `HeureFin` keys as valid programme-info sources.
Lowest churn — RTBF and Klassik Radio share infra and we can
key behaviour off the existing `extdata` shape.

**(B) Add a sibling `fetchRtbfMetadata`** that calls the same endpoint
but is responsible for the RTBF-shaped `extdata` keys, the
"channel-name-as-artist on talk channels" cleanup, and the title-case
treatment (RTBF returns ALL CAPS for music channels — the existing
streamabc fetcher already title-cases). This is what most other
broadcasters in `src/builtins.ts` do (one fetcher per broadcaster
even when the upstream is shared). Closest analogue: existing
`fetchStreamabcMetadata` (literally identical wire shape).

I'd lean toward **(B)**: keeps Klassik Radio's classical-music
ensemble-folding logic separate from RTBF's programme-info logic, and
makes future per-channel quirks (Pure FM rebrand handling, Classic 21
sub-channels) easier to localise.

YAML extension required (no schema break — the new fetcher would key
off `metadata: rtbf` and `metadataUrl:
https://api.streamabc.net/metadata/channel/<streamId>.json`):

```yaml
# Classic 21
broadcaster: rtbf
metadata: rtbf
metadataUrl: https://api.streamabc.net/metadata/channel/redbm_jpnzfz9xn_vcpk.json
status: working   # promote from stream-only

# La Première (talk — programme-only)
broadcaster: rtbf
metadata: rtbf
metadataUrl: https://api.streamabc.net/metadata/channel/redbm_rfjq5bsen_cgdo.json
status: working
```

Polling cadence: 60 s is conservative (programme blocks change on
hour boundaries; tracks on music channels turn over every 3–5 min).
The streamabc CDN edge-caches; no rate-limit pressure.

### Notes

- **Same upstream as Klassik Radio.** `api.streamabc.net` is a Swiss
  metadata-as-a-service platform (IT Tonus AG, Aarau) used by Red Bee
  Media customers. The shape is stable; we already trust it.
- **VRT comparison (sibling Belgian broadcaster, PR #207):** entirely
  different infra. VRT runs its own GraphQL at
  `vrt.be/vrtnu-api/graphql/public/v1`; RTBF outsources radio
  metadata to streamabc. They share a country and a regulator, not
  infrastructure. Both are open-CORS without auth though, so wiring
  cost is comparable.
- **Pure FM rebrand.** Our catalog still ships `Pure FM` at
  `radios.rtbf.be/pure-128.mp3`. The brand was retired in 2021 and
  folded into Tipik. The stream URL still resolves but is missing
  from Auvio's RADIO_LIVE widget. Either drop the entry or alias
  its `metadataUrl` to Tipik (`redbm_e3tfmdazg_a0ms`) — pick this
  up on a curate-stations sweep, not in the fetcher PR.
- **Sub-channel opportunity (cheap follow-up).** All 25 channels in
  the RADIO_LIVE widget work with the same metadata endpoint shape.
  Classic 21 has 12 sub-channels (60's, 70's, 80's Hits, 80's New
  Wave, 90's, Metal, Blues, Soulpower, Underground, Live, Noir
  Jaune Rock, Route66) and Musiq3 has 3 (Top du Classique, Baroque,
  Jazz) plus Tipik à l'ancienne — these are well-curated music
  feeds that would publish at `working` status for free once the
  fetcher lands. Streams are at `radios.rtbf.be/<slug>-128.mp3`
  based on the streamabc redirect pattern (e.g.
  `c21-60-128.mp3`); needs a quick curation-pass to confirm each
  per-channel slug exists publicly.
- **No track history surfaced.** Auvio's web player UI has no
  "previous tracks" feature; the streamabc endpoint only returns
  `type: "now"`. Probed `/metadata/recent`, `/metadata/list`,
  `/metadata/history`, `/metadata/songs`, etc. — all 404. If we
  ever want history, the streamabc platform may expose it on a
  per-customer basis (Klassik Radio doesn't either) but it'd
  require asking RTBF/streamabc directly.
- **Stream serving.** `radios.rtbf.be/<slug>.mp3` 302-redirects to
  `redbeemedia.streamabc.net/redbm-<slug>-mp3-160-<id>?sABC=...&amsparams=...`
  with a per-request `skey` (no auth, just a session marker).
  Browser `<audio>` follows the redirect transparently; nothing
  to change in our streaming layer.
- **`bff-service.rtbf.be` is widget-only.** Unrecognised paths
  return HTTP 500 (Varnish), not 404 — don't probe broadly. The
  widget IDs we'd need long-term are 18858 (full radio list) and
  18893 (per-chaine-page radio block); both have
  `Access-Control-Allow-Origin: *` and no auth.
- **Robots / ToS.** `auvio.rtbf.be/robots.txt` allows crawling of
  the public radio pages; `bff-service.rtbf.be` and
  `api.streamabc.net` have no robots files. The streamabc endpoint
  is the same surface their own web player uses — same trust
  boundary as Klassik Radio.

## rtp — RTP / Rádio e Televisão de Portugal (PT)

Investigated: 2026-05-09.

### TL;DR

RTP's "RTP Play" web player drives **all** live radio (Antena 1/2/3,
RDP África, RDP Internacional) from a single PHP-style endpoint at
`www.rtp.pt/play/livechannelonairnow.php?channel=<key>`. The response
is a JSON array: index 0 is the now-playing item (with full EPG
programme block) and indices 1–4 are the previous four tracks. Music
channels (Antena 1, Antena 3, RDP África, RDP Internacional) return
real artist + song. **Antena 2 (classical) does NOT** — it returns
empty `dtitulo` / "Programação Indisponível" placeholders, so it does
*not* join the SR P2 / NRK Klassisk / RNZ Concert / BR Klassik
classical-rich tier despite the matching format. Wirable today only
**via the worker proxy** — the endpoint is HTTPS but lacks
`Access-Control-Allow-Origin`.

### Topology

```
www.rtp.pt/play/direto/<slug>          (page-rendered SPA, jQuery-era)
  └─ var playerlive = new RTPPlayer({ channelKey: "at1", … })
  └─ liveMetadataOnairNow('at1', '3', 'play', 'live')
       → /play/livechannelonairnow.php?channel=at1
         (text/html content-type but body is JSON array;
          no CORS; player polls per response.reload seconds,
          observed 30–1300s window)

       (also, used by Antena 2 in lieu of the now-playing path:)
       liveMetadata('92', '1', '0', '260509', '2236', 'radio', 'play','live','…')
       → /play/livechannelmetadata.php?channel=…&howmanynext=…&howmanybefore=…
         (returns base64-encoded HTML fragments for direct DOM
          injection — not useful for clean parsing; the
          underlying data is the same shape as
          livechannelonairnow.php anyway, just wrapped in
          presentation.)
```

The page-source-embedded `RTPPlayer({ … })` block already exposes a
useful pre-render: `metadata.program.title`, `metadata.channel.name`,
and `mediaSession.metadata.artwork[]`. That's static SSR though —
the polling loop is what carries live track data.

### Channel-key map (PHP `?channel=` parameter)

This is **not** the same as the `channelKey` in the player config,
nor the numeric `channel.id`. The PHP endpoint takes the short keys
passed to `liveMetadataOnairNow(...)`:

| Display name | Page slug | Player `channelKey` | API `?channel=` | Numeric `id` |
|---|---|---|---|---|
| Antena 1 | `antena1` | `at1` | **`at1`** | 91 |
| Antena 2 (classical) | `antena2` | `at2` | **`at2`** | 92 |
| Antena 3 | `antena3` | `at3` | **`at3`** | 93 |
| RDP Internacional | `rdpinternacional` | `rdp_internacional` | **`int`** | — |
| RDP África | `rdpafrica` | `rdp_africa` | **`afr`** | — |

(Numeric IDs are *not* interchangeable — `?channel=92` returns
Antena 1's data, not Antena 2's. Likely a fallback default.)

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing + 4-item history | `https://www.rtp.pt/play/livechannelonairnow.php?channel=<key>` | none | **missing** (worker proxy required) | `data/metadata-discovery/rtp-onairnow-{at1,at2,at3,int,afr}.json` |
| EPG-rich live (HTML fragments, base64) | `https://www.rtp.pt/play/livechannelmetadata.php?channel=<numeric>&howmanynext=N&howmanybefore=N&grid=1&prog=1&channeltype=live&typeView=live` | none | none | `data/metadata-discovery/rtp-channelmetadata-at1.json`, `rtp-channelmetadata-at2.json` |
| Live channel directory (TV) | `https://www.rtp.pt/play/livechannelonair.php?channel=<key>` | none | `*` | `data/metadata-discovery/rtp-onair-*.json` (TV-only — radio keys all default to RTP1; **not useful for radio**) |
| Geo-rights / DRM | `https://www.rtp.pt/services/rtpplay/?ch_k=<key>` | none | `*` | not captured (returns `{country, rights, video, timeout, live, cachefile}` — no track data) |
| Podcast feed | `https://www.rtp.pt/play/podcast/rss/<channel-slug>` (e.g. `antena1`) | none | `*` | n/a (RSS, not JSON) |

### Response shape — `livechannelonairnow.php` (the one that matters)

Top-level: a JSON array of 5 items (current + 4 prior tracks).

```json
[
  {
    "id": "0",                          // current track marker
    "reload": 61,                       // seconds until next poll
    "depg": {                           // optional deep-EPG block (Antena 1 only)
      "TITULO": "Tubarão-Azul",         // ← TRACK TITLE
      "COMENT1": "Eu.Clides",           // ← TRACK ARTIST
      "realDateTime": "2026-05-09 22:37:23",
      "realEndDateTime": "2026-05-09 22:40:25",
      "duracao": "00:03:02",
      "IMAGE": "//cdn-images.rtp.pt/common/img/channels/logos/...",
      "EPG": {
        "TITULO": "Rui Santos",         // ← PROGRAMME / SHOW NAME
        "NOMEG": "Música Variada",      // ← PROGRAMME GENRE
        "COD_PROG": "7571",
        "IMAGE": "//cdn-images.rtp.pt/EPG/radio/imagens/7571_11456_90964.jpg",  // ← PROGRAMME COVER
        "realDateTime": "2026-05-09 20:09:00",
        "realEndDateTime": "2026-05-09 22:59:59",
        "DIRECTO": "S",
        "live": "1",
        "timeToEnd": "00:20"
      },
      "PLAY": {
        "program_id": 7571,
        "program_title": "Três Vidas e Uma Só Morte",  // (often a sibling show — looks like the same channel's adjacent slot; treat as supplementary)
        "program_rewrite": "tres-vidas-e-uma-so-morte"
      }
    },
    "dtitulo": "Tubarão-Azul",          // ← ALIAS TRACK TITLE (always present)
    "dcoment1": "Eu.Clides",            // ← ALIAS TRACK ARTIST
    "dcomentlabel": "Eu.Clides",
    "dhora": "22:37",                   // ← TRACK START (HH:MM, local PT)
    "dhorafinal": "22:40"               // ← TRACK END (HH:MM, only on item 0)
  },
  { "id": "1", "dtitulo": "Yougotmefeeling", "dcoment1": "Parcels", "dcomentlabel": "Parcels", "dhora": "22:34" },
  { "id": "2", "dtitulo": "Pop Toma", "dcoment1": "Lena DÁgua", "dcomentlabel": "Lena DÁgua", "dhora": "22:30" },
  { "id": "3", "dtitulo": "Meu Norte", "dcoment1": "Matilda", "dcomentlabel": "Matilda", "dhora": "22:27" },
  { "id": "4", "dtitulo": "Frágil", "dcoment1": "Jorge Palma", "dcomentlabel": "Jorge Palma", "dhora": "22:24" }
]
```

**Field mapping for the fetcher:**

- **Track title** → `[0].dtitulo` (fallback `[0].depg.TITULO`).
- **Track artist** → `[0].dcoment1` (fallback `[0].depg.COMENT1`).
- **Track timing** → `[0].dhora`–`[0].dhorafinal` (HH:MM, local PT timezone; or `[0].depg.realDateTime`–`[0].depg.realEndDateTime` for full timestamps + duration).
- **Programme name** → `[0].depg.EPG.TITULO` (e.g. *"Rui Santos"*; the show currently on air).
- **Programme genre** → `[0].depg.EPG.NOMEG` (e.g. *"Música Variada"*).
- **Programme cover art** → `[0].depg.EPG.IMAGE` (relative `//cdn-images.rtp.pt/EPG/radio/imagens/<id>.jpg` — prepend `https:`).
- **Track history** → `[1..4]` (only `dtitulo`/`dcoment1`/`dhora`; no end times, no cover art).
- **Polling cadence** → respect `[0].reload` seconds; observed values 30, 47, 61, 162, 1300. Floor to 30s as a polite default if missing.

**Caveats:**

- `depg` is `""` (empty string) on most channels except Antena 1; only Antena 1 ships the deep EPG block today. Treat `depg` as either an object **or** an empty string.
- Some channels return HTML entities in fields (`&ccedil;` / `&iacute;` / `&aacute;`). Decode before display.
- The PLAY.program_title on Antena 1 today (`Três Vidas e Uma Só Morte`) does *not* match the EPG.TITULO (`Rui Santos`) — they're different shows. The EPG block is the authoritative "what's on now"; PLAY.program_title appears to point at a related on-demand episode. Prefer `depg.EPG.TITULO` for programme display.
- Per-channel today (2026-05-09 22:37 WEST):
  - **at1**: full track + EPG (✅ richest)
  - **at3**: track title + artist (✅) — no `depg`
  - **int**: track title + artist (✅) — no `depg`
  - **afr**: track title + artist (✅) — no `depg`
  - **at2**: `dtitulo: null`, history items all "Programação Indisponível" (❌ no track data published)

### Wirable today?

⚠️ **wirable via worker proxy.** The endpoint is HTTPS, no auth, no
session token, returns clean structured JSON, polite reload field —
but it lacks `Access-Control-Allow-Origin`. Add a regex to
`worker/src/index.ts` `/api/public/proxy` allowlist:

```ts
/^https:\/\/www\.rtp\.pt\/play\/livechannelonairnow\.php\?channel=(?:at1|at2|at3|int|afr)$/i,
```

Once proxied, the four music channels (Antena 1/3, RDP África, RDP
Internacional) ship `working`. Antena 2 stays `stream-only` (no
broadcaster signal to fetch — separate ticket if we want to chase
classical metadata via a different path).

### Suggested fetcher

New shape; needs its own `fetchRtpMetadata` in `src/builtins.ts`.

**Closest analogues:**

- **`fetchHrMetadata`** (`src/builtins.ts:328`) — same "fetch via
  `/api/public/proxy?url=…`" path, parse JSON, pluck a nested
  `current` block. Mirror its proxy-routing prelude.
- **`fetchSrMetadata`** (`src/builtins.ts:1317`) — also worker-routed
  PHP endpoint with simple `?welle=` channel param; the structural
  mirror for "single endpoint, channel-keyed, no separate history
  call". Probably the closest single fetcher.

**Sketch (to be reviewed/finalised by a human):**

```ts
// channel-key map, keyed by station name suffix or stationuuid
const RTP_CHANNEL_KEYS: Record<string, string> = {
  'Antena 1': 'at1',
  'Antena 2': 'at2',
  'Antena 3': 'at3',
  'RDP Internacional': 'int',
  'RDP África': 'afr',
};

const fetchRtpMetadata: MetadataFetcher = async (station, signal) => {
  const key = RTP_CHANNEL_KEYS[station.name];
  if (!key) return null;
  const upstream = `https://www.rtp.pt/play/livechannelonairnow.php?channel=${key}`;
  const url = `${WORKER_BASE}/api/public/proxy?url=${encodeURIComponent(upstream)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const items = (await res.json()) as RtpItem[];
  const cur = items?.[0];
  if (!cur) return null;

  const title = cleanEntities(cur.dtitulo || cur.depg?.TITULO || '');
  const artist = cleanEntities(cur.dcoment1 || cur.depg?.COMENT1 || '');
  if (!title && !artist) return null; // Antena 2 path

  const epg = typeof cur.depg === 'object' ? cur.depg.EPG : undefined;
  const programmeName = epg?.TITULO ? cleanEntities(epg.TITULO) : undefined;
  const programmeImage = epg?.IMAGE ? `https:${epg.IMAGE}` : undefined;

  return {
    title,
    artist,
    programme: programmeName,
    coverArt: programmeImage,
    pollAfterSeconds: cur.reload ?? 60,
  };
};
```

(Type-stub is illustrative — match the actual `MetadataFetcher`
return shape used by neighbouring builtins.)

For station-level wiring, the four music channels each set
`metadata: rtp` on their `data/stations.yaml` entry (no per-station
config needed; the fetcher derives the channel key from
`station.name`). Antena 2 stays without a metadata binding until a
separate signal turns up.

### Notes

- **Same-platform-as-TV.** RTP runs one "RTP Play" SPA for both TV
  and radio; the TV-side endpoint `livechannelonair.php` is
  CORS-open but radio keys (`at1`/`at2`/etc.) all collapse onto
  `RTP1` (TV channel id 5) — confirmed by probing five different
  parameter names (`ch`, `chan`, `channel_key`, `key`, `id`,
  `ch_k`, `station`, all with the same RTP1 default). So we
  cannot reuse the CORS-open endpoint as a shortcut.
- **Antena 2 (classical) does NOT join the classical-rich tier.**
  The endpoint returns `dtitulo: null` for current and
  "Programação Indisponível" history items. Confirmed across both
  the now-playing endpoint and the alternate `livechannelmetadata`
  path (whose decoded base64 HTML also says "Programação
  Indisponível"). RTP appears to simply not publish a track-level
  feed for Antena 2. (Hypothesis: their classical workflow doesn't
  log titles into the broadcast automation in real time. Same gap
  exists at RNE Radio Clásica — verifiable once the parallel RNE
  recon lands.)
- **Mismatch between `EPG.TITULO` ("Rui Santos") and
  `PLAY.program_title` ("Três Vidas e Uma Só Morte").** The two
  reference different programmes — `EPG.TITULO` is the show
  currently on air, `PLAY.program_title` looks like a related
  podcast/episode rewrite. Use `EPG.TITULO`.
- **Content-type lies.** `livechannelonairnow.php` returns
  `Content-Type: text/html` even though the body is JSON. The
  worker proxy already overrides the response Content-Type to
  `application/json; charset=utf-8`, so the client doesn't see
  this — but a direct `fetch().json()` against the upstream URL
  would still parse fine as long as you don't gate on the header.
- **Reload cadence.** The `reload` field at index 0 ranges from
  30s to 1300s. For talk-heavy slots (no track changes for an
  hour) RTP returns 1300s; for music-driven slots it's typically
  30–60s. Respect this; it's the broadcaster's hint about how
  often their queue actually rotates.
- **HTML entity decoding.** Some fields ship as HTML-escaped
  Portuguese text (`&ccedil;`, `&iacute;`, `&atilde;`). Decode in
  the fetcher (existing helper or a small entity map for the
  Portuguese-specific characters).
- **No auth, no rate-limit headers, no robots restrictions on the
  player path.** The endpoint is what their own SPA hits; same
  trust boundary.
- **HTTPS only — already compliant** with the catalog's HTTPS-only
  rule (audit #71).
