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

## vrt — Vlaamse Radio- en Televisieomroeporganisatie (BE)

Investigated: 2026-05-09.

### Channels in catalog

| Station | Status before | Page ID | Has track data? |
|---|---|---|---|
| VRT Radio 1 | `stream-only` | `/radio1` | yes (when a track plays) |
| VRT Radio 2 | `stream-only` | `/radio2` | yes (when a track plays) |
| VRT Studio Brussel | `stream-only` | `/kanalen/studio-brussel` | yes (when a track plays) |
| VRT MNM | `stream-only` | `/kanalen/mnm` | yes (when a track plays) |
| VRT Klara | `stream-only` | `/kanalen/klara` | yes (when a track plays; classical — often empty) |

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| Now-playing (track + programme + cover) | `https://www.vrt.be/vrtnu-api/graphql/public/v1` (POST) | `X-VRT-CLIENT-NAME: WEB` header required | `Access-Control-Allow-Origin` set only for `*.vrt.be` origins — **not open** | `data/metadata-discovery/vrt-graphql-channelpage-stubru.json`, `vrt-graphql-channelpage-radio1.json` |
| Programme schedule (schedule tiles list) | same GraphQL endpoint, `StaticTileList` component query | same | same | `data/metadata-discovery/vrt-graphql-schedule-radio1.json` |

**GraphQL query** (minimal now-playing, no auth required beyond the header):

```graphql
{
  page(id: "<PAGE_ID>") {
    __typename
    ... on ChannelPage {
      brand
      heading {
        __typename
        ... on Banner {
          title
          description
          image {
            templateUrl
          }
        }
      }
    }
  }
}
```

Where `<PAGE_ID>` is the per-channel slug (see table above). The body must be a JSON POST:
`{"query": "..."}` and the request must include `X-VRT-CLIENT-NAME: WEB` — without it the
server returns HTTP 400.

**Page IDs confirmed working:**

| Channel | Page ID |
|---|---|
| Radio 1 | `/radio1` |
| Radio 2 | `/radio2` |
| Studio Brussel | `/kanalen/studio-brussel` |
| MNM | `/kanalen/mnm` |
| Klara | `/kanalen/klara` |

### Response shape

Sample (Studio Brussel, track playing):
```json
{
  "data": {
    "page": {
      "__typename": "ChannelPage",
      "brand": "stubru",
      "heading": {
        "__typename": "Banner",
        "title": "De Afrekening",
        "description": "James Blake - Trying Times",
        "image": {
          "templateUrl": "https://images.vrt.be/orig/2025/08/28/c617b334-f704-4ec5-932d-b6d0158076ad.jpg?gravity=center"
        }
      }
    }
  }
}
```

Key field mapping:

| Abstract field | GraphQL path | Notes |
|---|---|---|
| Programme name | `heading.title` | Always present; e.g. `"De Afrekening"` |
| Track (artist + title) | `heading.description` | `"Artist - Title"` when a track plays; **empty string `""` between tracks / during talk segments** |
| Artist | first part of `heading.description` before ` - ` | Use `indexOf(' - ')` to split; same guard as WDR fetcher |
| Track title | remainder after first ` - ` | |
| Cover art URL | `heading.image.templateUrl` | Programme art (not track album art). Append `?w=400` for a 400 px wide version. CORS `*` on `images.vrt.be`. |

**`heading.description` format:**
- Track playing: `"Artist - Title"` (e.g. `"James Blake - Trying Times"`, `"Angèle Feat. Justice - What You Want"`)
- No track / presenter talking: `""` (empty string — fetcher should return `null` for track and fall back to programme name only)

**Cover art:**
The `heading.image.templateUrl` is the programme/show art, **not** track album art. It is
stable across multiple polls for the same programme slot. Append `?w=400` or `?w=200` for
resized versions (CDN serves `images.vrt.be` with CORS `*`). Cover changes between programme
slots (~every 1–2 hours), not between tracks.

**Programme schedule:**
The same GraphQL query can include the `StaticTileList` component to fetch the day's programme
schedule. Each `RadioEpisodeTile` item has `title`, `description` (presenter), `active`, and
`image`. The `active: true` item is the currently playing programme (same as `heading.title`).
See `vrt-graphql-schedule-radio1.json` for the full structure.

### API behaviour

- **HTTP method:** POST JSON to `https://www.vrt.be/vrtnu-api/graphql/public/v1`
- **Required header:** `X-VRT-CLIENT-NAME: WEB` (without it: HTTP 400)
- **Optional headers:** `X-VRT-CLIENT-VERSION: 1.0.0` (observed in bundle; not strictly needed)
- **Cache-Control:** `public, max-age=600` (10-min CDN TTL). The VRT CDN appears to cache
  the response — the live track data updates when a new track starts playing (sub-minute
  granularity observed), suggesting cache invalidation on the VRT side. Recommend polling at
  **30 s** (a typical track is 3–4 min, 30 s gives good responsiveness without being aggressive).
- **CORS:** The GraphQL endpoint returns `Access-Control-Allow-Origin: <origin>` only for
  `*.vrt.be` origins. External origins (including `rrradio.org`) receive **no CORS header** on
  the response. **Requires the worker proxy** — add
  `https://www.vrt.be/vrtnu-api/graphql/public/v1` to the allowlist in `worker/src/index.ts`.
- **Rate limits:** No `X-RateLimit-*` or `Retry-After` headers observed. The endpoint is
  served publicly through CloudFront + API Gateway (AWS). 30 s polling across ~5 channels is
  well within reasonable bounds.
- **Socket.io:** The CSP also grants `wss://api.vrt.radio/socket.io/` — this appears to be a
  real-time push channel for the VRT MAX web player. The REST GraphQL endpoint is sufficient
  for rrradio's polling-based fetch model; no need to implement WebSocket logic.

### Wirable today?

| Signal | Verdict |
|---|---|
| Track (artist + title) | ⚠️ **via-worker** — data is available, CORS requires proxy |
| Programme name | ⚠️ via-worker — same endpoint |
| Cover art | ✅ **wire-now** — `images.vrt.be` has `Access-Control-Allow-Origin: *`; use URL directly in `<img>` |
| Track history | ❌ not available — no per-track history list endpoint found |
| Programme schedule | ⚠️ via-worker — available in same GraphQL response |

Overall: ⚠️ **via-worker** — HTTPS-only, structured JSON, no auth, but missing CORS header.
Needs one allowlist entry in the worker proxy. Once proxied: track + programme name + cover
available for all 5 channels.

### Suggested fetcher

New `fetchVrtMetadata` in `src/builtins.ts`. Closest analogue: `fetchSrMetadata` (programme-only,
via worker proxy, single POST per channel) + the `fetchNdrMetadata` cover-art pattern.

Implementation sketch:
1. `station.metadataUrl` = the per-channel page ID slug (e.g. `"/radio1"`, `"/kanalen/studio-brussel"`)
   — just the slug, not the full URL. Keeps YAML small; the fetcher prepends the base URL.
2. POST to `https://www.vrt.be/vrtnu-api/graphql/public/v1` through the worker proxy.
   Include `X-VRT-CLIENT-NAME: WEB` header (forwarded by proxy or baked into the proxied request).
3. Parse `data.page.heading.description`:
   ```ts
   const raw = data?.page?.heading?.description ?? '';
   const sep = raw.indexOf(' - ');
   if (sep === -1 || raw === '') return { program: { name: data.page.heading.title } };
   const artist = raw.slice(0, sep).trim();
   const track  = raw.slice(sep + 3).trim();
   ```
4. Cover art: `data.page.heading.image?.templateUrl` + `?w=400` (serve directly in `<img>`; CORS open).
5. Programme name: `data.page.heading.title` (always present).
6. Register as `vrt` in `FETCHERS_BY_KEY`.

Worker proxy: add `https://www.vrt.be/vrtnu-api/graphql/public/v1` to the allowlist in
`worker/src/index.ts`. The proxy must forward the POST body and `X-VRT-CLIENT-NAME: WEB` header
(or add it server-side).

### Notes

- **CORS restriction:** The GraphQL endpoint explicitly allows only `*.vrt.be` origins.
  Attempting to call it from `rrradio.org` (even via browser `fetch()`) returns no
  `Access-Control-Allow-Origin` header and the response is blocked. The worker proxy is mandatory.
- **`X-VRT-CLIENT-NAME: WEB` header:** Required. Without it the API returns HTTP 400
  `Bad Request`. The bundle exports the value `"WEB"` as the constant `k` in module 52f0199e.
  The version (`X-VRT-CLIENT-VERSION`) is optional — the API accepts requests without it.
- **GraphQL endpoint is `/vrtnu-api/graphql/public/v1`** (public, no auth) — the authenticated
  variant is `/vrtnu-api/graphql/v1` (requires `Authorization: Bearer <token>`). Do not confuse
  the two. Introspection queries are blocked on both (`INTROSPECTION_QUERY_NOT_ALLOWED`).
- **Description is empty between tracks.** VRT only populates `heading.description` when a track
  is actively playing. During presenter talk, jingles, or news segments, the field is `""`. The
  fetcher must handle this gracefully (return `null` for track, fall back to programme name).
- **Image is programme art, not album art.** The `heading.image.templateUrl` shows the programme
  artwork (e.g. "De Afrekening" show art for Studio Brussel). It does not change per track.
  Acceptable as a channel cover; the rrradio display can use it as a fallback until VRT surfaces
  per-track artwork (not found in the GraphQL schema today).
- **`images.vrt.be` resizing:** Append `?w=<px>` to resize (e.g. `?w=400`). The CDN resizes on
  demand. Gravity/crop via `?gravity=center&aspect_ratio=<ratio>&h=<px>` also supported.
  The original URL already includes `?gravity=center` — strip and re-add `?w=400` for clean sizing.
- **Socket.io API (`api.vrt.radio`):** The CSP grants `wss://api.vrt.radio/socket.io/` —
  this is the real-time WebSocket feed used by the VRT MAX radio player. It supports socket.io
  v4 polling transport; initial handshake returns session IDs and ping intervals. Not pursued
  further — the GraphQL REST endpoint is sufficient and simpler to integrate.
- **ToS:** VRT is Belgium's Flemish public broadcaster. The GraphQL endpoint is called by every
  VRT MAX visitor. No explicit developer API ToS; the `/graphql/public/v1` path signals public
  intent. Reasonable polling cadence (30 s) is appropriate.

---
