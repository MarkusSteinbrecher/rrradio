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
