# Genre Art Contract

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: fcbc168
```

## Purpose

Pins the file that supplies the pictures on the Browse genre cards:
`https://rrradio.org/genre-art.json`. The web repo publishes it, so a picture
changes with a web deploy and not with an app release.

Who must honor it:

- The web build, which writes the file from `data/genre-art.yaml` and rejects a
  source that breaks a rule below.
- Any client that draws genre cards with pictures. It reads the file, shows one
  set of three pictures per genre and rotates through the sets on a shared
  clock.

This contract owns the file format, the validity rules, the rotation formula
and the licence rules for hosted photos. It does NOT own:

- The genre list and genre ids → `src/genre-taxonomy.data.mjs` and the
  [catalog schema](catalog-schema.md).
- The layout of a genre card → [browse](../features/browse.md).
- The pictures built into an app as its fallback → that app's repo.

## Definition

The file is one JSON object:

```jsonc
{
  "schemaVersion": 1,
  "rotateEveryDays": 7,
  "genres": {
    "<genre id>": [            // the genre's sets
      [ Entry, Entry, Entry ], // one set: three pictures, hero first
      [ Entry, Entry, Entry ]
    ]
  }
}
```

An `Entry` is `{ "artist"?: string, "album"?: string, "image": string }`.

**Sets.** Each genre is a list of sets. A set is three entries. The first is the
hero, drawn in the centre circle of the card.

**Rotation.** A client shows one set per genre and moves to the next every
`rotateEveryDays` days. Periods count from Monday 1970-01-05 00:00 UTC:

```
index = floor((unixSeconds - 4*86400) / (rotateEveryDays*86400)) mod sets.length
```

With 7 days the set changes every Monday at 00:00 UTC, and every device shows
the same set. Genres may have different numbers of sets; each uses its own
`sets.length`. A genre with one set never changes.

**Image hosts.** `image` is an `https` URL whose host is `rrradio.org` or ends
in `.mzstatic.com` (Apple's artwork servers). No other host is valid.

**Two kinds of picture.**

- *Music genres* show album covers, linked from Apple's artwork servers. A cover
  is never copied to `rrradio.org`.
- *Spoken-word genres* (`news`, `talk`, `sports`, `public`) have no records to
  show. They use photos hosted at
  `https://rrradio.org/genre-art/<genre>-<n>.jpg`.

## Detail

### Fields

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `schemaVersion` | integer | no | Format version. Always `1`. | — |
| `rotateEveryDays` | integer ≥ 1 | yes | Days one set stays up. | `7` |
| `genres` | object | no | Catalog genre id → list of sets. A genre left out keeps the client's built-in pictures. | — |
| `genres.<id>[]` | array of 3 `Entry` | no | One set, hero first. | — |
| `Entry.image` | string (URL) | no | The picture. `https`; host `rrradio.org` or `*.mzstatic.com`. | — |
| `Entry.artist` | string | yes | Artist of the album. Omitted for photos. | — |
| `Entry.album` | string | yes | Album title. Omitted for photos. | — |

### Rules the web build enforces

`npm run check-genre-art` runs in CI (the `catalog` job) and fails the build when
`data/genre-art.yaml` breaks one of these, or when the committed
`public/genre-art.json` is not what the YAML builds.

| # | Rule |
|---|---|
| 1 | `schemaVersion` is `1`. `rotateEveryDays`, when given, is a whole number ≥ 1. No other top-level keys. |
| 2 | Every key of `genres` is a catalog genre id. |
| 3 | Every genre listed has at least one set. Every set has exactly three entries. |
| 4 | An entry has an `image` and no keys other than `artist`, `album`, `image`. `artist` and `album`, when given, are non-empty strings. |
| 5 | `image` is `https` on `rrradio.org` or `*.mzstatic.com`. |
| 6 | No image URL appears twice in the file. |
| 7 | Music genres use only `*.mzstatic.com` images, each with `artist` and `album`. No album (same artist and title, ignoring case) appears twice in the file. |
| 8 | Spoken-word genres use only photos at `https://rrradio.org/genre-art/<genre>-<n>.jpg`, named for their own genre. |
| 9 | Every photo referenced exists in `public/genre-art/` and is a square of 480 to 600 px. |
| 10 | Every photo in `public/genre-art/`, referenced or not, has a row in `public/genre-art/SOURCES.md` whose licence is `CC0` or `Public domain`. |

### Rules for choosing pictures (not machine-checked)

- Album covers: well-known records that stand for the genre. Look a song up at
  `https://itunes.apple.com/search?term=<artist+title>&entity=song`, take
  `artworkUrl100` and replace `100x100bb` with `600x600bb`.
- Photos: CC0 or public domain only, with no identifiable people. The licence
  record is `public/genre-art/SOURCES.md`, served next to the photos.
- Pictures are square, around 480 to 600 px.

## Examples

A music genre with two sets and a spoken-word genre with one:

```json
{
  "schemaVersion": 1,
  "rotateEveryDays": 7,
  "genres": {
    "jazz": [
      [
        { "artist": "Miles Davis", "album": "Kind of Blue",
          "image": "https://is1-ssl.mzstatic.com/image/thumb/Music/7f/9f/d6/mzi.vtnaewef.jpg/600x600bb.jpg" },
        { "artist": "John Coltrane", "album": "A Love Supreme (Monophonic Edition)",
          "image": "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/0b/3d/a7/0b3da78f-6d48-194f-0525-714e39c5b264/25UMGIM90747.rgb.jpg/600x600bb.jpg" },
        { "artist": "The Dave Brubeck Quartet", "album": "Time Out",
          "image": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/7a/e3/06/7ae30672-0c73-a4d4-0a74-624eefc2843b/dj.ytdbjvto.jpg/600x600bb.jpg" }
      ]
    ],
    "news": [
      [
        { "image": "https://rrradio.org/genre-art/news-1.jpg" },
        { "image": "https://rrradio.org/genre-art/news-2.jpg" },
        { "image": "https://rrradio.org/genre-art/news-3.jpg" }
      ]
    ]
  }
}
```

Rotation with three sets and `rotateEveryDays: 7`:

| Moment (UTC) | `unixSeconds` | Period number | Set index |
|---|---|---|---|
| Sunday 2026-11-22 23:59:59 | 1795391999 | 2967 | 0 |
| Monday 2026-11-23 00:00:00 | 1795392000 | 2968 | 1 |
| Monday 2026-11-30 00:00:00 | 1795996800 | 2969 | 2 |
| Monday 2026-12-07 00:00:00 | 1796601600 | 2970 | 0 |

## Versioning & evolution

- `schemaVersion` changes only for a breaking change. A client ignores the whole
  file for any number it does not know, so a bump turns the file off for every
  released client until it updates.
- New optional fields on an entry or at the top level are not a breaking change.
  Clients ignore fields they do not know. The web build lists allowed keys, so a
  new field is added to the build and to this contract in the same change.
- Adding, removing or reordering sets is a content change, not a format change.
  It can move which set shows this period, because the index is taken modulo
  the number of sets.
- Genres are added and removed with the catalog taxonomy. A client ignores a
  genre id it does not draw.

## Failure & fallback

The web build is strict. Clients are lenient, so a file the build would reject
still degrades one piece at a time.

| Condition | Client behavior |
|---|---|
| File missing, request fails, or body is not this JSON | Keep the last good cached copy; with no copy, show the built-in pictures. |
| `schemaVersion` is present and not `1` | Ignore the whole file; keep the cached copy or the built-in pictures. |
| `rotateEveryDays` missing, not a number, or under 1 | Use 7. |
| Genre missing from `genres` | That genre shows its built-in pictures. |
| Entry malformed, or its `image` is not `https` on an allowed host | Drop the entry. |
| Set has more than three valid entries | Use the first three. |
| Set has fewer than three valid entries | Drop the set. |
| Genre has no valid set left | That genre shows its built-in pictures. |
| A picture fails to load | Fall back per circle (iOS: the bundled photo for a spoken-word genre, a station logo for a cover). |

Dropped sets shorten `sets.length`, so the rotation index is taken over the
valid sets only.

## Platform obligations

**Web (publisher)**

- Build `public/genre-art.json` from `data/genre-art.yaml` with
  `npm run genre-art`, and commit both. The committed artifact is what deploys.
- Run `npm run check-genre-art` in CI.
- Serve the photos and `SOURCES.md` under `/genre-art/`. Never host a copy of an
  album cover.

**Every client that draws genre pictures**

- Fetch `https://rrradio.org/genre-art.json` at most every 6 hours and keep the
  last good copy for offline use. Normal cache headers apply.
- Apply the host rule to every `image` before loading it.
- Use the rotation formula above, in UTC, so all devices agree.
- Keep built-in pictures as the fallback for a missing file or genre.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Publish `genre-art.json`, photos and licence record | Supported | Not applicable | Not applicable |
| Build check in CI | Supported | Not applicable | Not applicable |
| Draw genre cards from the file | Not planned (genre chips have no pictures) | Reference (`feat/remote-genre-art`) | Planned |
| Rotate sets on the shared clock | Not planned | Reference | Planned |
| Built-in fallback pictures | Not applicable | Reference | Planned |

## Open questions

1. Should the web app's own genre chips show these pictures? If so, it uses the
   same file and `rotationIndex` from `tools/build-genre-art.mjs`.
2. Apple can retire an artwork URL. Nothing checks the linked covers on a
   schedule today; a dead cover falls back per circle on the client.

## Reference

- Source: `data/genre-art.yaml`. Artifact: `public/genre-art.json`.
- Build and rules: `tools/build-genre-art.mjs` (`buildGenreArtPayload`,
  `rotationIndex`), tests `tools/build-genre-art.test.mjs`. CI gate:
  `tools/check-genre-art.mjs`, wired in `.github/workflows/deploy.yml`.
- Photos and licence record: `public/genre-art/`, `public/genre-art/SOURCES.md`.
- iOS client: `rrradio/Models/GenreArtStore.swift` (fetch, cache, validity,
  rotation), `rrradio/Views/FeedPages/GenreCoverArt.swift` (built-in pictures).
- Definition: [#846](https://github.com/MarkusSteinbrecher/rrradio/issues/846).

## Known deviations

None recorded.
