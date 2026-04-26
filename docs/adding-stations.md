# Adding a station

The curated catalog is **data, not code**. Two YAML files describe the
broadcasters and stations; a small build script generates the JSON file
that ships with the app.

```
data/broadcasters.yaml   ← organisations (BR, ORF, BBC, …)
data/stations.yaml       ← individual stations, reference a broadcaster
public/stations.json     ← generated; do not hand-edit
public/stations/*.png    ← bundled station logos
```

## Status taxonomy

Every station has a `status:` field. Only the first three are emitted
into the bundled catalog; the rest stay in YAML as documentation.

| Status         | Meaning                                                   | Published? |
| -------------- | --------------------------------------------------------- | ---------- |
| `working`      | stream + metadata + cover all flowing                     | yes        |
| `icy-only`     | stream OK, ICY-over-fetch supplies the current track      | yes        |
| `stream-only`  | plays, no metadata source available                       | yes        |
| `fetcher-todo` | broadcaster API known, fetcher not yet wired              | no         |
| `investigate`  | not researched yet                                        | no         |
| `not-public`   | auth/session/geo locked (Apple Music, Spotify, …)         | no         |
| `broken`       | URL dead or stream consistently fails                     | no         |

## Tools

```sh
npm run probe -- '<stream-url>' ['<metadata-url>']
```

Mirrors what the browser sees: CORS preflight, ICY headers, the first
`StreamTitle` value, optional HEAD on a metadata URL. Output is JSON,
suitable for paste-into-yaml. Use this *first* on any new station.

```sh
npm run catalog
```

Reads the YAML, validates, writes `public/stations.json`. Runs
automatically before `npm run dev` and `npm run build`. Prints a
status-by-count summary so you can see what was published vs. held
back.

## Path A — station fits an existing fetcher

The fetchers already wired in `src/builtins.ts`:

| Key              | Use for                                              |
| ---------------- | ---------------------------------------------------- |
| `grrif`          | Grrif (single station, hardcoded URL)                |
| `orf`            | Any ORF channel (FM4, Ö1, Ö3, …) via `metadataUrl`   |
| `br-radioplayer` | Any BR channel via `metadataUrl`                     |
| *(none)*         | ICY-over-fetch fallback for any other CORS-permissive Icecast stream |

If the broadcaster you're adding already has a fetcher, you only need
to edit YAML.

### 1. Probe

```sh
npm run probe -- 'https://example.com/stream.mp3' \
                 'https://example.com/api/now-playing.json'
```

Save the result for the `notes:` field if anything's surprising.

### 2. Append to `data/stations.yaml`

```yaml
- id: builtin-orf-oe1
  broadcaster: orf
  name: Ö1
  streamUrl: https://orf-live.ors-shoutcast.at/oe1-q2a
  metadataUrl: https://audioapi.orf.at/oe1/api/json/4.0/live
  bitrate: 192
  codec: MP3
  tags: [culture, talk, austria]
  favicon: stations/orf-oe1.png
  homepage: https://oe1.orf.at/
  country: AT
  status: working
  featured: false
```

`country` and `homepage` can be omitted if the broadcaster already has
them (they get inherited).

### 3. Logo

Drop a square (or near-square) PNG into `public/stations/`. ~120–256 px
is plenty — anything larger gets downscaled in CSS.

### 4. Verify

```sh
npm run dev
```

Open [http://localhost:5178/](http://localhost:5178/), find the station
in Browse / search, play it, confirm the cover and "On air" line both
populate.

### 5. Commit & push

```sh
git add data/ public/stations/<your>.png
git commit -m "Add <Station Name>"
git push
```

GitHub Pages redeploys in ~30 s.

## Path B — new broadcaster (different metadata API shape)

If no existing fetcher fits, add a new one.

### 1. Research the broadcaster's now-playing endpoint

Open the station's player page in a browser. **DevTools → Network**,
filter by `xhr` / `fetch`. Tap play. Look for a JSON request that
returns the current track. Take note of:

- The URL (and how it's parameterised per channel — slug? id?)
- CORS headers (does `Access-Control-Allow-Origin` echo your origin?)
- The response shape (where artist / title / cover live)
- Whether the response is well-formed JSON or has a comment prefix
  (BR's starts with `//@formatter:off`, for example)

### 2. Add the broadcaster to `data/broadcasters.yaml`

```yaml
wdr:
  name: WDR
  fullName: Westdeutscher Rundfunk
  country: DE
  family: ARD
  homepage: https://www1.wdr.de/radio/
  metadata: wdr-onair    # <- the fetcher key you'll register in code
  notes: |
    Free-form context. URL pattern, response quirks, etc.
```

### 3. Implement the fetcher in `src/builtins.ts`

```ts
const fetchWdrMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json() as YourResponseShape;
    // …extract artist, title, cover…
    return {
      artist: data.artist,
      track: data.title,
      raw: `${data.artist} - ${data.title}`,
      coverUrl: data.imageUrl,
    };
  } catch {
    return null;
  }
};
```

Then register it:

```ts
const FETCHERS_BY_KEY: Record<string, MetadataFetcher> = {
  grrif: fetchGrrifMetadata,
  orf: fetchOrfMetadata,
  'br-radioplayer': fetchBrMetadata,
  'wdr-onair': fetchWdrMetadata,    // ← add this
};
```

**Conventions**:

- `(station, signal) => Promise<ParsedTitle | null>`
- Return `null` when the source is reachable but has no current track —
  the poller keeps polling.
- Wrap in `try/catch` and return `null` on transient errors. Throwing
  tells the poller "this source is unsupported, stop forever" — only
  do that if you mean it.
- Title-case SHOUTING strings if the source emits them.

### 4. Add stations referencing the new broadcaster

Same as Path A step 2.

### 5. Verify, commit, push

Same as Path A steps 4–5.

## Locked stations (record them so we stop forgetting)

When you bump into a station that can't work in a third-party app —
Apple Music, Spotify, Tidal, geo-locked BBC streams from outside the
UK, etc. — add an entry with `status: not-public` and a note explaining
why. Keeps the next person (or future you) from re-investigating.

```yaml
- id: not-public-apple-music-1
  broadcaster: apple-music
  name: Apple Music 1
  streamUrl: https://itsliveradio.apple.com/3p-tune-in/tune_in/978194965/index-cmaf.m3u8
  status: not-public
  notes: |
    HLS URL with a signed `accessKey` query param that expires per
    Apple Music session. No third-party way to refresh it. Returns
    HTTP 433 "Forbidden_TimeFail_3" once expired.
```

## Common gotchas

- **Stream plays in your browser but `Icy-MetaData: 1` fetch fails** —
  CORS preflight rejected. The stream-bytes fetch (what `<audio>` does)
  doesn't preflight, but our metadata fetch does. The station has CORS
  open for audio but not for the custom header. No metadata, but the
  station still streams — set `status: stream-only`.
- **`icy-metaint` header missing in JS but visible in curl** — the
  server doesn't add `Access-Control-Expose-Headers: icy-metaint`. Our
  ICY reader falls back to brute-force scanning the bytes for the
  literal `StreamTitle='…'` pattern, which works without that header.
- **JSON response starts with `//`** — some servers prepend formatter
  hints. Strip leading non-JSON before `JSON.parse`. The BR fetcher
  has a `parseLooseJSON` helper you can crib.
- **Cover URL points to a tiny thumbnail** — add the URL pattern to
  `isLowResCoverUrl` in `src/main.ts` so the iTunes upgrade kicks in.
