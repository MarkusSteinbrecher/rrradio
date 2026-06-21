# Station profiles — the rich per-station knowledge base

One human-authored YAML per station (`<id>.yaml`), compiled by
`tools/build-station-profiles.mjs` into `public/station-profiles.json`.

This is a **separate layer from the catalog**:

| Layer | File | Answers | Granularity |
|---|---|---|---|
| Catalog | `data/stations.yaml` → `public/stations.json` | *what plays this stream* (URL, codec, status, fetcher) | every station (~31k) |
| Enrichment table | `public/sources/stations-enriched-CH.*` | *shallow attributes at scale* (group, lang, logo, FM/DAB) | per country (~100s) |
| **Station profile** | `data/station-profiles/<id>.yaml` → `public/station-profiles.json` | ***what IS this station*** | deep, hand/agent-curated |

Profiles serve two consumers: **cross-station analysis** (flat fields like
`format`, `genres`, `organization.group`, `reach.audienceDaily`,
`music.rotationStyle`) and the **per-station detail page** (prose + lists:
`description`, `programming.flagshipShows`, `reach.fm`, `presence.socials`).

Build: `npm run station-profiles` (or `node tools/build-station-profiles.mjs --check`).

## Field spec

`id` matches the filename and (where it exists) the catalog row's `id`.
Every section is **optional** — populate what the source actually yields;
omit what you can't verify rather than guessing. `null`/absent = unknown.

```
id: <slug>                      # required; == filename, == catalogId when in catalog

identity:
  name:            string       # required — canonical display name
  shortName:       string
  tagline:         string       # on-air slogan / claim
  positioning:     string       # one-line self-description
  logo:    { url, source }      # source: radioplayer | wiki | broadcaster | …
  brandColor:      "#rrggbb"

organization:
  type:    public|commercial|community|internet
  owner:           string       # legal entity
  group:           string       # brand family → broadcasters.yaml key when wired
  foundedYear:     int
  headquarters: { city, address, canton }

profile:                        # editorial — the heart of the detail page
  description:     string       # 1–2 sentence user-facing blurb
  format:          string       # "Hot AC", "Community / freeform", "Adult Contemporary", …
  contentMix: { music: 0..1, talk: 0..1 }
  targetAudience:  string
  distinctive:     string       # what sets it apart

music:                          # the analysis core — "what do they play"
  genres:        [string]
  languageShare: { <lang>: 0..1 | "high"|"low" }
  rotationStyle: current-hits|gold|mixed|eclectic|freeform
  playlistSample:               # real recently-played evidence (goes stale → stamp it)
    sampledAt:   YYYY-MM-DD
    source:      string         # endpoint/page the sample came from
    tracks:    [ { artist, title } ]
  topArtists:    [string]       # derived, optional

programming:
  flagshipShows: [ { name, when, presenters?, note? } ]
  presenters:    [string]
  podcasts:      [string]
  scheduleUrl:   string

reach:
  languages:     [string]       # ISO-ish: de, fr, it, rm, es, …
  region:        string
  geo:           [lat, lng]
  fm:            [number]        # MHz frequencies
  dab:    { present: bool, since, region }
  audienceDaily: int            # listeners/day, with year in a comment

streams:        [ { url, codec, bitrate, type } ]   # type: icecast|hls|hls-video|shoutcast
isVideo:        bool            # true for visual-radio HLS (player note)

nowPlaying:
  endpoint:      url
  type:          icecast-xspf|status-json|graphql|azuracast|json|json-covers|icy|none
  cors:          bool           # false → needs the worker proxy
  coverArt:      bool
  fetcher:       string         # our builtins key, when wired

presence:
  homepage:      url
  socials: { facebook, instagram, twitter, youtube, tiktok, spotify, soundcloud }
  apps:    { ios, android }
  podcasts:      url
  contact: { email, tel }
  wikipedia:     url
  affiliations:  [string]       # e.g. UNIKOM, AMARC, Radioplayer

identifiers:
  catalogId:     string         # data/stations.yaml id
  stationuuid:   string         # Radio Browser
  rpuId:         string         # Radioplayer
  wikidata:      string         # Q…

meta:
  status:        working|icy-only|stream-only|fetcher-todo|…
  liveness: { onDab: bool, inRadioplayer: bool }
  provenance: { <field>: <source> }   # where notable facts came from
  updatedAt:     YYYY-MM-DD
  notes:         string
```

## Adding a station

1. Run the deep website read (the `/station-profile` method): about, schedule,
   playlist/now-playing, frequencies, podcasts, + localized Wikipedia.
2. **Sample the real playlist** — it's the strongest evidence of musical
   identity. Adapt to type: commercial → playlist + format; community → the
   show grid + its languages (a track-only read mislabels community radio).
3. Author `<id>.yaml`, omitting unverifiable fields.
4. `npm run station-profiles` and commit the YAML + regenerated JSON.
