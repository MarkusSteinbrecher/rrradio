# Metadata And Artwork Specification

Metadata turns a stream into a useful radio experience. The shared contract is
the catalog's broadcaster metadata fields and fetcher keys, not a specific
language implementation.

## Shared Contract

- `metadataUrl` identifies a broadcaster-specific now-playing endpoint when one
  exists.
- Broadcaster fetcher keys are stable contracts across platforms.
- Fetcher behavior should match across web, iOS, and Android: same JSON paths,
  same HTML/XML parsing intent, same null-vs-error semantics.
- ICY-over-fetch is a fallback for stations marked `icy-only`.
- Track metadata should be normalized into artist, title, raw label, and any
  program/schedule fields the platform supports.
- Station favicon is the first station-art source.
- Track cover art may fall back to public music metadata APIs only when privacy
  rules allow it.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Broadcaster fetchers | Reference proving ground. | Native parity for wired fetchers. | Planned native parity. |
| ICY metadata | Supported via fetch where CORS/proxy allows. | Supported through AV metadata and bounded fetch fallback. | Partial; basic ICY parser/fetcher exists. |
| Program schedule | Supported for wired broadcasters. | Supported for wired broadcasters. | Planned. |
| Station logos | Supported. | Supported. | Planned. |
| Track cover art | Supported. | Supported. | Planned. |
| Lyrics lookup | Supported. | Planned/partial native parity. | Planned. |

## Privacy Rules

- Do not send track titles, artist names, user-entered URLs, or search queries
  to analytics.
- Metadata fetch failures should record coarse categories only.
- User-visible diagnostics may include operational detail only when the user
  explicitly enables and exports diagnostics.

## Porting Rule

When a new web fetcher is added, add or update the corresponding native fetcher
before marking the station as fully parity-supported on native platforms.
