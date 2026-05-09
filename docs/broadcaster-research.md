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

## nhk — NHK / Japan Broadcasting Corporation (JP)

Investigated: 2026-05-09.

### TL;DR

NHK runs **two completely separate metadata stacks**:

1. **Domestic radio** ("らじる★らじる" / radiru): rich, well-typed
   schema.org-style JSON at `api.nhk.jp/r8/...` covering all three
   national channels (R1=AM, R2=education, R3=FM) across 8 regional
   variants. **CORS-open, no auth, 60s cache.** Track-level music
   metadata (composer, performer, label, catalogue code, duration in
   ISO-8601) is published per-programme on FM and on a few music R1
   slots — but **only on the day-schedule and broadcastEvent
   endpoints**, not on the now-on-air rollup. **However**: the
   underlying domestic streams (`simul.drdi.st.nhk/live/N/...`)
   return **HTTP 403** from a Swiss IP. Geo-blocked. So the metadata
   is reachable from rrradio but the audio is not — domestic NHK
   stations cannot ship at `working` from outside Japan.
2. **NHK World-Japan** (international service, 17 languages): the
   eight stations already in our catalog (`jp-nhk*`). Streams
   reachable globally at `master.nhkworld.jp/...`. **The English /
   non-Japanese radio services do NOT have a now-playing endpoint —
   they're 24/7 looping pre-produced bulletins.** Only the
   Japanese-language NHK World radio (the "Radio深夜便/Radio Japan"
   service streamed at `masterpl.hls.nhkworld.jp/hls/wp/live/master.m3u8`)
   has an EPG via `masterpl.hls.nhkworld.jp/epg/r1/{YYYYMMDD}.json`
   with hour-block programme titles, no track-level music data.

### Topology

```
DOMESTIC (radiru)
  www.nhk.or.jp/radio/                  — homepage
  www.nhk.or.jp/radio/player/           — JS player
    └─ /radio/config/config_web.xml     — area→stream + API URL templates
       └─ api.nhk.jp/r8/pg/now/radio/{areaId}/now.json    — NOA rollup (r1+r2+r3)
       └─ api.nhk.jp/r8/pg/date/{r1|r2|r3}/{areaId}/{YYYY-MM-DD}.json
                                                          — full day, includes musicList
       └─ api.nhk.jp/r8/t/broadcastevent/be/{eventId}.json
                                                          — single-programme detail w/ musicList
  simul.drdi.st.nhk/live/{1..19}/joined/master.m3u8       — domestic HLS (geo-blocked)

NHK WORLD (international)
  www3.nhk.or.jp/nhkworld/{lang}/live_radio/              — UI (en/ja/es/fr/zh/ko/...)
    └─ /nhkworld/app/radio/hlslive_radio.json             — language-id → stream URL map
    └─ master.nhkworld.jp/nhkworld-radio/playlist/{rs1..rs5,gs2,kai,sin}/live.m3u8
    └─ masterpl.hls.nhkworld.jp/epg/r1/{YYYYMMDD}.json    — Japanese-language radio EPG only
    └─ www3.nhk.or.jp/nhkworld/data/{lang}/radionews/rnews.json
                                                          — VOD bulletin catch-up (not live)
    └─ www3.nhk.or.jp/rj/podcast/rss/{english2|...}.xml   — RSS podcast feeds
```

### Endpoints

| What | URL template | Auth | CORS | Sample |
|---|---|---|---|---|
| **Domestic NOA rollup** | `https://api.nhk.jp/r8/pg/now/radio/{areaId}/now.json` | none | `*` | `nhk-noa-tokyo-130.json`, `nhk-noa-osaka-270.json` |
| **Domestic day schedule** (1 service × 1 day, ~50–65 entries with `musicList` populated for music programmes) | `https://api.nhk.jp/r8/pg/date/{r1\|r2\|r3}/{areaId}/{YYYY-MM-DD}.json` | none | `*` | `nhk-day-r1-tokyo.json` (1/64 with music), `nhk-day-r3-fm-tokyo.json` (11/53 with music) |
| **Domestic broadcastEvent detail** | `https://api.nhk.jp/r8/t/broadcastevent/be/{broadcastEventId}.json` | none | `*` | `nhk-broadcastevent-r3-recital.json` (3-track classical), `nhk-broadcastevent-r3-jazzvoyage.json` (host info but empty musicList) |
| Domestic stream | `https://simul.drdi.st.nhk/live/{1..19}/joined/master.m3u8` | none | n/a | **HTTP 403 from CH** — geo-blocked |
| Domestic config (areaId, apikey, areakey, all stream URLs) | `https://www.nhk.or.jp/radio/config/config_web.xml` | none | `*` | (XML, not committed — also reachable inline at the player page) |
| **NHK World stream-id → URL map** | `https://www3.nhk.or.jp/nhkworld/app/radio/hlslive_radio.json` | none | `*` | `nhk-world-hlslive-radio.json` |
| NHK World live (Japanese) HLS resolver | `https://livepl.nhkworld.jp/hlslive_web.json` | none | `*` | `nhk-world-hlslive.json` (single-key file pointing at WP HLS) |
| **NHK World Japanese-language radio EPG** ("Radio深夜便", `wp` brand) | `https://masterpl.hls.nhkworld.jp/epg/r1/{YYYYMMDD}.json` | none | `*` | `nhk-world-epg-r1-20260510.json` (24 hour-block entries; no track data) |
| NHK World non-Japanese radio EPG | — none discovered — | — | — | confirmed absent: pre-produced bulletins only |
| NHK World live UI config (per-language strings) | `https://www3.nhk.or.jp/nhkworld/common/assets/live/live-config/{lang}.json` | none | `*` | `nhk-world-live-config-en.json` (UI strings, not playback data) |
| NHK World audio-news catch-up (VOD bulletins, last 30) | `https://www3.nhk.or.jp/nhkworld/data/{lang}/radionews/rnews.json` | none | `*` | `nhk-world-radionews-en.json` |
| NHK World podcast feed | `https://www3.nhk.or.jp/rj/podcast/rss/{english2\|spanish\|french\|...}.xml` | none | `*` | n/a (HEAD only) |

All endpoints respond with `cache-control: max-age=60` (api.nhk.jp + nhk.or.jp) or up to 1 hour (cloudfront-fronted nhkworld.jp). No `X-RateLimit-*` headers; no `Retry-After`; no auth tokens of any kind. CSP on `api.nhk.jp` is restrictive (`default-src 'self'`) but doesn't affect cross-origin JSON consumption — `Access-Control-Allow-Origin: *` is set.

### Domestic areaId / areakey table (from `config_web.xml`)

The player switches the NOA URL by `areakey` (3-digit prefecture-ish
code; not the same as `apikey`). `r1` and `r3` (= NHK FM) carry
regional opt-out windows so their content differs by area; `r2` is
national-only and identical across all 8 areas (it's a single feed).
FM is present in all 8 regions.

| areajp | area | apikey | areakey |
|---|---|---:|---:|
| 札幌 (Sapporo) | sapporo | 700 | 010 |
| 仙台 (Sendai) | sendai | 600 | 040 |
| 東京 (Tokyo) | tokyo | 001 | **130** |
| 名古屋 (Nagoya) | nagoya | 300 | 230 |
| 大阪 (Osaka) | osaka | 200 | **270** |
| 広島 (Hiroshima) | hiroshima | 400 | 340 |
| 松山 (Matsuyama) | matsuyama | 800 | 380 |
| 福岡 (Fukuoka) | fukuoka | 501 | 400 |

### Domestic response shape (`api.nhk.jp/r8/pg/now/radio/130/now.json`)

Top-level: `{ "r1": {...}, "r2": {...}, "r3": {...} }` where each
service contains:

```
{
  publishedOn: [ // schema.org BroadcastService
    { id: "bs-r1-130", name: "NHK AM放送",
      broadcastDisplayName: "NHK AM・東京",
      identifierGroup: { serviceId: "r1", serviceName: "NHK AM",
                         areaId: "130", areaName: "東京", … },
      logo: { url, main:{url,width,height}, medium:{...}, small:{...} },
      eyecatch: {...},  // larger artwork variants
      hero: {...}
    }
  ],
  publication: [ // up to 6 BroadcastEvent — current + next ~5
    { id: "r1-130-2026051072015",
      type: "BroadcastEvent",
      name: "ニュース・気象情報・交通情報（関東甲信越）",     // ← programme title
      description, detailedDescription:{epg40,epg80,epg200,epgInformation},
      startDate: "2026-05-10T06:25:00+09:00",                 // ISO + JST offset
      endDate:   "2026-05-10T06:30:00+09:00",
      duration: "PT5M",
      isLiveBroadcast: true,
      identifierGroup: {
        broadcastEventId: "r1-130-2026051072015",  // ← join key for /broadcastevent
        radioEpisodeId,   radioEpisodeName,
        radioSeriesId,    radioSeriesName,         // ← series-level identity
        serviceId: "r1",  areaId: "130",  stationId: "001",
        date: "2026-05-10",  eventId: "72015",
        genre: [ {id:"0009",name1:"ニュース/報道",name2:"ローカル・地域"}, … ]
      },
      misc: {
        actList: [ {name:"挾間美帆",nameRuby:"ﾊｻﾞﾏﾐﾎ"} ],   // hosts/performers
        musicList: [],                              // ← EMPTY ON NOA, populated on /date and /broadcastevent
        programType: "program",
        coverage: "block" | "nationwide",
        playControlSimul: true, playControlVOD: false,
        ...
      },
      url: "https://api.nhk.jp/r8/t/broadcastevent/be/r1-130-2026051072015.json",
      about: { id: "WP51J1RQ4R", name, identifierGroup: {…},
               partOfSeries: { id, name, ... } }   // schema.org RadioSeries
    }
  ]
}
```

The `r2` block is sparse when r2 is off-air (school broadcasts
don't run 24/7) — `publication: []`, `name: null` etc. — so a
fetcher must defensively handle null `publication` arrays.

### Domestic music-list shape (`musicList` items, populated on /date and /broadcastevent)

```
{
  name: "交響曲　第４番　ヘ短調　作品３６",  // track title
  nameruby: "コウキョウキョク　ダイヨンバン …",  // katakana reading
  composer: "チャイコフスキー",               // present for classical
  arranger: "",
  lyricist: "",
  location: "２０２５年３月２０日　ＮＨＫ５０９スタジオ",  // recording venue (or empty)
  provider: "",
  label: "ワーナー",                          // record label
  duration: "PT42M46S",                       // ISO-8601 duration
  code: "5054197793073",                      // catalogue / EAN
  byArtist: [
    { name: "ローマ聖チェチーリア国立アカデミー管弦楽団", role: "", part: "管弦楽" },
    { name: "アントニオ・パッパーノ", role: "", part: "指揮" }
  ]
}
```

Per-programme entries have **0..N tracks**. R3/FM today: 11 of 53
programmes had non-empty `musicList`; R1/AM today: 1 of 64. R2 was
off-air all day. Empty list is the dominant case for talk-heavy
slots even on FM.

### NHK World response shape (`masterpl.hls.nhkworld.jp/epg/r1/20260510.json`)

```
{ data: [
  { seriesId: "r",
    airingId: "2026051000",
    title: "ニュース/ラジオ深夜便▽…",
    episodeTitle, description, link, thumbnail,
    firstShow: 1,
    startTime: "2026-05-10T00:00:00+09:00",
    endTime:   "2026-05-10T01:00:00+09:00",
    endTimeReal,
    jstrm: 0, wstrm: 1,                     // streamability flags
    extractProgram: 0,
    episodeId: "r202605100020260510001",
    playURL: "https://masterpl.hls.nhkworld.jp/hls/r1/{episodeId}/master.m3u8",
    vodStartTime, vodEndTime,
    episodeThu...
  },
  // 24 hour-block entries per day
] }
```

No track-level data anywhere in the NHK World tree. The catch-up
endpoint (`radionews/rnews.json`) carries pre-produced VOD bulletins
(`onair_date`, `audio` URL, `duration`, `program_id`) — useful for
"latest news" tile but not now-playing.

### Wirable today?

⚠️ **Partial — meaningful split:**

- **Domestic NHK** (R1/R2/FM Tokyo–Fukuoka): metadata reachable + rich (music data, ISO durations, schema.org-style),  but the **streams 403 from non-Japan IPs**, so we can't ship them at all from rrradio. **Status: not-public** — gate behind a future "geo-aware catalog" or skip entirely. (Sponsor decision: shipping a station whose stream fails is worse than not shipping it.)
- **NHK World Japanese-language radio** ("Radio深夜便" at `masterpl.hls.nhkworld.jp/hls/wp/live/master.m3u8` — already in catalog as `jp-nhk` → `https://masterpl.hls.nhkworld.jp/hls/r1/live/master.m3u8`): EPG endpoint exists, returns hour-block programme titles. ✅ **wirable as programme-only** (no track data) — same shape as BBC's talk-radio fetcher.
- **NHK World non-Japanese radio** (rs1=English, rs2=Spanish/French/Portuguese rotation, rs4/rs5/gs2/kai/sin = other languages — already in catalog as `jp-nhk-world-radio*`): no programme endpoint surfaced. The HLS streams loop pre-produced 30-min bulletins; the player UI only shows static channel branding. **Status: stream-only is correct** — leave as-is.

So **net wirable signal**: programme info for `jp-nhk` (Radio Japan
Japanese-language) only. ~1 station out of the 8 NHK entries we
already ship.

### Suggested fetcher

```ts
// New shape; needs its own fetchNhkMetadata in src/builtins.ts.
// Closest analogue: fetchBbcMetadata (programme-only fallback) for
// the World/wp branch; fetchOrfMetadata for the domestic /r8/pg
// shape if we ever wire domestic (still gated by geo on the audio side).
```

Two passes possible — pick one based on station scope:

1. **Minimum viable (NHK World `jp-nhk` only).** One station, today,
   already in catalog. Per-station `metadataUrl:
   "https://masterpl.hls.nhkworld.jp/epg/r1/<today>.json"` — fetcher
   fetches today's UTC date in `YYYYMMDD` (or, more correctly, JST
   today via `+09:00`), filters `data[]` to the entry whose
   `[startTime, endTime]` brackets `Date.now()`, returns
   `{ track: undefined, program: { name: title, subtitle:
   episodeTitle } }`. Same pattern as the BBC fallback. EPG is also
   trivial to expose as `ScheduleFetcher` — map all 24 entries.
2. **Full domestic (R1/R3 Tokyo, Osaka, …)** — only if we add a
   geo-aware "JP only" gate in the catalog/UI. Then a per-station
   `metadataUrl: ".../r8/pg/now/radio/{areaId}/now.json"` plus a
   `serviceId` (`r1` | `r2` | `r3`) selector in `extra:`. Fetcher
   reads `noa[serviceId].publication`, finds the entry whose
   `[startDate, endDate]` brackets now, and: (a) returns programme
   info from `name` + `description`; (b) **optionally** follows
   `url` to the broadcastEvent JSON to lift a non-empty `musicList`
   (one track at a time — pick whichever has the most-recent
   `startDate ≤ now`, but the API doesn't expose per-track
   timing — see "Limits" below). Cover art at
   `publishedOn[0].logo.medium.url` (channel logo, not programme
   art).

### Notes

- **Geo-block scope.** Empirical from a Swiss IP: domestic streams
  `simul.drdi.st.nhk/live/3/joined/master.m3u8` → HTTP 403 (openresty,
  not cloudfront — geographic guard at the edge). All
  `api.nhk.jp/r8/...` endpoints return 200 cross-region. All
  `*.nhkworld.jp` streams + JSON return 200. So: metadata is global,
  domestic audio is JP-only, NHK World audio is global. (Some
  third-party reports say domestic radiru is also reachable from
  Korea/Taiwan; can't confirm.)
- **No track-level "now playing".** Even where `musicList` is
  populated, items have `duration` (ISO-8601) but no per-track
  start offset within the programme — they're a programme-level
  manifest, not a timed cue list. To pick the "currently playing"
  track you'd need to sum durations from `programme.startDate` and
  guess. Approximate at best; for FM classical/jazz where tracks
  are 5–40 min each this would be off by a track-or-two regularly.
  The `description.epg40/epg80/epg200` fields sometimes inline the
  exact set list as plain text — could be parsed as a fallback for
  music shows.
- **NOA strips musicList.** The `now.json` endpoint returns the same
  publication structure as the day-schedule, but with `musicList`
  forced to `[]`. So a fetcher that wants tracks **must** make a
  follow-up call to the broadcastEvent URL. Cost: 2 fetches per
  poll cycle for music channels; 1 fetch for talk channels.
- **r2 is school-radio.** R2 = "ラジオ第2" carries language-learning
  shows on a fixed daily schedule and is **off-air at night**.
  When off-air the NOA payload returns `r2.publication: []` and
  `r2.publication[0].name === null` shapes — defensive null-checks
  required.
- **`r3` brand.** In NHK's API r3 = NHK FM. Don't confuse with
  R3 in BBC (Radio 3) or other broadcasters.
- **NHK World "r1" is misleading.** `masterpl.hls.nhkworld.jp/epg/r1`
  is the *NHK World Japanese-language radio* schedule, not domestic
  R1. The "r1" segment here is NHK's internal naming for that
  feed's programme rail.
- **No track-history endpoint.** Surveyed
  `/r8/pg/recent`, `/r8/pg/history`, `/r8/pg/{service}/recent.json`,
  `/r8/t/musiclist/...` — all 404. Track history would need a
  client-side rolling cache (same pattern as DR Denmark).
- **Stream codecs.** Domestic AAC `audio/aac` per `encodingFormat`.
  NHK World feeds in catalog are AAC at 64–96 kbps.
- **Robots / ToS.** `www.nhk.or.jp/robots.txt` allows the player and
  config paths; `api.nhk.jp` and `masterpl.hls.nhkworld.jp` have no
  robots files. NHK exposes these endpoints to power their own
  public web/iOS/Android players (jp.nhk.netradio bundle ID
  referenced in `player.js`) — same trust boundary as ARD/ZDF or
  the BBC. Public broadcaster, public-funded, programme metadata
  is not licensed/restricted content.
- **Coordination with curate-stations.** Future opportunity: the
  domestic NHK FM feed for at least Tokyo + Osaka + Sapporo (3
  major regional FM variants — each carries 30–60 min regional
  windows on top of the national schedule) would more than double
  the music-metadata yield, but only after a geo-fence story
  exists. Issue gate.
- **Catalog hygiene.** All 8 existing `jp-nhk*` stations are
  tagged `broadcaster: independent`. After this recon a follow-up
  PR should add `nhk:` to `data/broadcasters.yaml` and re-tag at
  least `jp-nhk` (the Japanese-language Radio Japan) to
  `broadcaster: nhk` so a future fetcher can target it via slug.
