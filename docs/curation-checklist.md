# Curation checklist (per station)

When promoting a Radio Browser station from `stream-only` toward `working`,
walk this checklist. Each row tells you what we measure, where the answer
comes from, and what to do if the check fails.

`npm run analyze` runs the automated checks (stream, HTTPS, ICY,
metadata-API, fetcher, logo) over every publishable station and prints
the results — see `public/station-status.json` for the machine-readable
output that the admin dashboard reads.

## Activities

### 1. Stream

**Question:** Does the URL actually play in a modern browser?

**Pass criteria:** GET with `Icy-MetaData: 1` returns 2xx with a
content-type starting with `audio/` (or `application/vnd.apple.mpegurl`
for HLS, or `application/octet-stream`).

**Failure paths:**
- 4xx/5xx → URL is dead → set `status: broken`, drop from catalog
- non-audio content-type → stream URL points at a wrapper page →
  re-check Radio Browser for a corrected URL or set `status: broken`
- timeout → broadcaster might be down briefly → re-run after a day

### 2. HTTPS

**Question:** Is the stream URL `https://`?

Why it matters: rrradio.org is HTTPS, so an HTTP stream is blocked by
the browser as mixed content and silently fails to play.

**Failure path:** Try `s.url_resolved` from a fresh Radio Browser query;
many stations have an HTTPS variant the auto-curate first-pick missed.
If no HTTPS variant exists, set `status: broken` (we can't ship it).

### 3. ICY metadata (in-stream)

**Question:** Does the stream itself emit `StreamTitle='Artist - Track'`
metadata blocks?

**Pass criteria:** Either `icy-metaint` header is exposed AND a non-empty
StreamTitle arrives in the first 16 KB, OR the brute-force scan finds
`StreamTitle='...'` somewhere in the first 64 KB. (`tools/probe-station.mjs`
does both.)

**Failure path:** If ICY isn't there, the station can still ship at
`status: stream-only` — users will see the station name but no track
info. To upgrade, see step 4.

### 4. Metadata API (out-of-band)

**Question:** Does the broadcaster publish a separate JSON endpoint with
"now playing" data?

**How to find:** Open the broadcaster's own player page in a browser
DevTools → Network → look for repeated XHR/fetch calls returning JSON
with track info. Common patterns:
- `<broadcaster>.<tld>/.../onair.json`
- `audioapi.<broadcaster>.<tld>/<channel>/api/...`
- `radioplayer.json` somewhere under the channel page

**On finding one:**
1. Verify CORS allows browser-side fetch (response has
   `Access-Control-Allow-Origin: *` or matches our origin)
2. Set `metadataUrl: <url>` on the station's YAML row
3. If the broadcaster matches an existing fetcher (orf, br-radioplayer,
   grrif), we're done — just re-deploy
4. If it's a new shape, add a fetcher in `src/builtins.ts` and a
   broadcaster entry in `data/broadcasters.yaml`

**Failure path:** No metadata API → keep at `icy-only` (if step 3 passed)
or `stream-only`.

### 5. Fetcher wired

**Question:** Is the per-broadcaster fetcher actually registered for
this station?

**Check:** Station's `metadata` field (inherited from the broadcaster
unless overridden) matches a key in `FETCHERS_BY_KEY` in
`src/builtins.ts`.

**Failure path:** Add the fetcher (see step 4).

### 6. Program info

**Question:** Does the metadata fetcher surface the *show name*
("Morning Show", "Blaue Couch") in addition to the track?

**Today's coverage:** ORF (FM4, Ö1) and BR (Bayern 1, Bayern 3, …)
both publish program info via their respective APIs. Grrif's
`covers.json` does not. Generic ICY does not.

**Upgrade path:** Improve the fetcher to populate the
`program: { name, subtitle }` field on the returned `ParsedTitle`.

### 7. Logo

**Question:** Do we have a curated, square PNG logo for this station?

**Pass criteria:** `favicon:` field is a relative path under
`stations/` (e.g. `stations/fm4.png`), and the file is checked in.

**Failure path:** Auto-imported stations get the broadcaster's favicon
URL from Radio Browser, which is often low-res or off-brand. To
upgrade:
1. Find a high-res square logo on the broadcaster's site (their press
   kit, brand page, or the `og:image` meta on their main page)
2. Save as `public/stations/<station-id>.png` at 256-512px square
3. Set `favicon: stations/<station-id>.png` on the YAML row

### 8. Tags

**Question:** Are the genre/region tags accurate enough to surface this
station via the genre filter?

**Today's filter chips:** jazz, ambient, classical, electronic, indie,
rock, news, eclectic. At least one of these should appear in the
station's tags array if it fits any.

**Failure path:** Edit the YAML row's `tags:` field. Lower-case,
comma-separated.

## Status taxonomy reference

A station graduates through statuses as more checks pass:

| Status | Stream | HTTPS | ICY or API | Fetcher | Logo |
|---|---|---|---|---|---|
| `broken` | ✗ | — | — | — | — |
| `not-public` | (auth/geo locked) | — | — | — | — |
| `stream-only` | ✓ | ✓ | — | — | optional |
| `icy-only` | ✓ | ✓ | ICY | (generic) | optional |
| `working` | ✓ | ✓ | API | per-broadcaster | curated |

Only `stream-only`, `icy-only`, `working` ship into the public catalog.
