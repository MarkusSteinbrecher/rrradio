# Localization Contract

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

Pins the shared localization model so the same UI string renders identically
(same key, same fallback, same plural choice) on web, iOS, and Android.

The invariant has three parts every platform must honor:

1. **A shared key registry** — one canonical set of string-key names. A key
   names a slot in the UI, never an English literal.
2. **A fixed supported-language set** — `en`, `de`, `fr`, `es`. `en` is the
   source language and the universal fallback.
3. **A deterministic lookup + fallback rule** — given a key and a resolved
   language, every platform resolves the same value, and falls back the same
   way when a translation is missing.

This contract owns the *registry shape, language set, lookup order, and plural
algebra*. It does not own which surface uses which key (that is each feature
spec's `Localization` section) and does not own how the language preference
syncs (see [Data and sync](../data-sync.md)).

## Definition

### Key registry

- A **key** is a stable string identifier (e.g. `nowPlaying`, `addFavorite`).
- Two key namespaces exist:
  - **Singular keys** — one value per language. Resolve via `text(key)`.
  - **Plural keys** — a value per language *per plural category*. Resolve via
    `text(key, count:)`.
- The registry is **closed**: every key is declared once and every supported
  language MUST carry a value for every declared key (full cardinality). A key
  present in one language but absent in another is a contract violation.
- Values may embed `{placeholder}` tokens substituted at render time. The only
  reserved token in plural values is `{count}`.

### Language resolution

```
choice ∈ { system, en, de, fr, es }            (user preference)
rawCode = choice == system ? OS-language : choice-code
resolvedLanguage =
    rawCode startsWith "de" → "de"
    rawCode startsWith "fr" → "fr"
    rawCode startsWith "es" → "es"
    otherwise               → "en"
```

- The user picks a **choice**, not a raw locale. `system` follows the OS UI
  language; the four explicit choices pin a language regardless of OS.
- Resolution collapses any regional variant to one of the four base codes by
  prefix; anything unrecognized resolves to `en`.
- The choice is persisted and re-applied on launch. The resolved language is
  recomputed live when the OS language changes *and* the choice is `system`.

### Lookup algebra

Singular:

```
text(key, lang) = table[lang][key]
               ?? table["en"][key]      // fallback to source language
               ?? key.name              // last-resort: emit the key name
```

Plural:

```
category = pluralCategory(count, lang)
text(key, count, lang) =
      pluralTable[lang][key][category]
   ?? pluralTable[lang][key][other]     // category fallback within language
   ?? pluralTable["en"][key][category]  // language fallback
   ?? pluralTable["en"][key][other]
   ?? key.name
then substitute {count} → formatted count
```

### Plural categories

The contract uses a **two-category CLDR subset** sufficient for the four
shipped languages:

```
pluralCategory(count, lang):
    lang == "fr" → (count == 0 || count == 1) ? one : other   // FR: 0 and 1 are singular
    otherwise    → (count == 1)               ? one : other   // EN/DE/ES: only 1 is singular
```

This is a deliberate subset of full CLDR (no `zero`/`two`/`few`/`many`). It is
correct for `en`/`de`/`fr`/`es` only. See Open questions before adding a
language with richer plural rules (Polish, Russian, Arabic, Czech, …).

## Detail

### Language choice

| State | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `system` | choice | — | Follow the OS UI language; resolved code recomputed on OS-language change. | yes (default) |
| `en` | choice | — | Force English. | — |
| `de` | choice | — | Force German. | — |
| `fr` | choice | — | Force French. | — |
| `es` | choice | — | Force Spanish. | — |

- Persisted as the choice token (`system` / `en` / `de` / `fr` / `es`), not the
  resolved code, so a `system` user keeps following the OS after a relaunch.
- The choice is a syncable preference (see [Data and sync](../data-sync.md));
  the resolved code and any OS-language change are never synced.

### Singular key entry

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| key | identifier | no | Stable slot name; identical across platforms. | — |
| `en` value | string | no | Source-language text; also the fallback value. | — |
| `de`/`fr`/`es` value | string | no (full cardinality) | Translated text. | — |
| `{placeholder}` tokens | inline | yes | Named substitutions filled at render. Unfilled tokens are left literal. | left intact |

### Plural key entry

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| key | identifier | no | Stable plural slot name. | — |
| `one` value | string | no | Singular-category template; contains `{count}`. | — |
| `other` value | string | no | Plural-category template; contains `{count}`. | — |
| per language | one/other pair | no (full cardinality) | Each supported language carries both categories. | — |

### Plural keys (registry)

The plural namespace is small and fixed; every entry is a count-prefixed noun:

`broadcastsCount` · `stationsCount` · `favoritesCount` · `listsCount` ·
`customStationsCount` · `recentsCount` · `catalogStationsLoaded` ·
`cloudSyncRestored` · `cloudSyncSynced` · `cloudSyncPushed`.

## Examples

Singular entry (key `close`):

```
close → en: "Close"  de: "Schließen"  fr: "Fermer"  es: "Cerrar"
```

Singular lookup with fallback (key present in `en`, absent in `de`):

```
text("someKey", "de") = table["de"]["someKey"]   → nil
                      ?? table["en"]["someKey"]   → "Some text"   // used
```

Last-resort (key absent everywhere): `text("ghostKey", "de") = "ghostKey"`.

Placeholder substitution:

```
listenOnService → en: "Listen on {service}"
text(.listenOnService, { service: "Spotify" }, "en") = "Listen on Spotify"
text(.listenOnService, { }, "en")                     = "Listen on {service}"   // unfilled token left literal
```

Plural entry and rendering (key `broadcastsCount`):

```
broadcastsCount.one  → en:"{count} broadcast"   de:"{count} Sendung"   fr:"{count} émission"   es:"{count} programa"
broadcastsCount.other→ en:"{count} broadcasts"  de:"{count} Sendungen" fr:"{count} émissions" es:"{count} programas"

text(.broadcastsCount, count:0, "en") = "0 broadcasts"   // EN: 0 → other
text(.broadcastsCount, count:1, "en") = "1 broadcast"
text(.broadcastsCount, count:0, "fr") = "0 émission"     // FR: 0 → one
text(.broadcastsCount, count:2, "fr") = "2 émissions"
text(.broadcastsCount, count:0, "de") = "0 Sendungen"
text(.broadcastsCount, count:3, "xx") = "3 broadcasts"   // unknown lang → en + other
```

## Versioning & evolution

- **Adding a key**: add it to the registry with all four language values in the
  same change. A key with fewer than four values violates full cardinality.
- **Adding a language**: extend the language set, supply every singular and
  plural value, and extend `pluralCategory` if the language needs categories
  beyond `one`/`other`. Until then it falls back to `en` per the lookup rule.
- **Renaming a key**: a breaking change to the cross-platform registry; rename
  in lockstep on every platform. There is no alias layer.
- **The registry has no version field today** (see Open questions). Platforms
  identify keys by name only; there is no compatibility handshake.
- The source-of-truth file format is platform-internal and may change without
  changing this contract, provided the key names, language set, lookup order,
  and plural algebra above are preserved. On iOS the values live in an Xcode
  string catalog (`Localizable.xcstrings`) compiled into per-language bundles;
  the runtime still materializes the registry shape and lookup defined here
  rather than delegating to the OS string runtime.

## Failure & fallback

| Input | Behavior |
|---|---|
| Key missing in resolved language | Fall back to the `en` value. |
| Key missing in resolved language *and* `en` | Emit the raw key name (never crash, never blank). |
| Plural category missing in resolved language | Fall back to `other` in the same language. |
| Plural key missing in resolved language | Fall back to `en` (same category, then `other`). |
| Unknown / unsupported language code | Resolve to `en` by the prefix rule. |
| `{placeholder}` with no replacement supplied | Leave the literal `{token}` in place. |
| `{count}` always substituted | Plural render always replaces `{count}` with the formatted count. |
| OS language changes mid-session | Recompute resolved language only if choice is `system`; otherwise ignore. |
| Missing-key fallback | Silent (no user error). A diagnostic note MAY be recorded; it MUST NOT contain user content. |

The fallback chain guarantees a string is always produced. The worst case (raw
key name) is a visible defect, not a crash.

## Platform obligations

**All platforms**

- Use the same key registry: identical key names, identical language set
  (`en`/`de`/`fr`/`es`), identical lookup and plural algebra above.
- Enforce full cardinality: every supported language carries every singular and
  plural key. This MUST be a build-time or test-time gate, not a manual review.
- Never ship a raw English literal to a non-English locale. Every user-visible
  string — including accessibility labels, alerts, destructive-action copy, and
  strings sent to companion surfaces — MUST flow through the registry.
- Never hand-roll plurals with a `count == 1 ? "X" : "Xs"` ternary; route every
  count-bearing string through a plural key.
- Persist a language *choice* (including `system`), re-apply it on launch, and
  re-render when the resolved language changes.
- Keep diagnostics free of user content; a missing-key event records the key
  name only, never the rendered value or user input.

**iOS** (reference)

- Choice set: `system`, `en`, `de`, `fr`, `es`; persisted in UserDefaults.
- Language choice participates in CloudKit preference sync; the resolved code
  and OS-language changes do not sync.
- Re-render is driven by the resolved language code being part of the view
  identity / snapshot token.

**Web**

- Honor the same registry and fallback; language is browser/content dependent
  (see [Preferences and diagnostics](../features/preferences-diagnostics.md)).
- `system` maps to the browser UI language; no cloud sync of the choice.

**Android**

- Localization is planned, not yet shipped (see the matrix). When implemented,
  honor the same registry, language set, fallback order, and plural algebra;
  map `system` to the device locale; keep the choice local-only.

### Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Shared key registry | Supported | Reference | Planned |
| Supported language set (en/de/fr/es) | Supported | Reference | Planned |
| Full-cardinality enforcement | Supported | Supported (test-gated) | Planned |
| `en` fallback on missing key | Supported | Supported | Planned |
| Two-category plural (`one`/`other`) | Supported | Supported | Planned |
| `{placeholder}` substitution | Supported | Supported | Planned |
| `system` follows OS language | Supported | Supported | Planned |
| Language choice cloud sync | Not planned | Supported | Not planned |

## Open questions

- **No registry version field.** Keys are matched by name with no compatibility
  marker. A shared registry consumed by three platforms eventually needs a
  version (or content hash) so a platform can detect that it is reading a newer
  key set than it understands. Decide whether to add one and where it lives.
- **Two-category plural ceiling.** The algebra hard-codes `one`/`other` and a
  French-only `0→one` rule. Any future language with `zero`/`two`/`few`/`many`
  (Polish, Russian, Arabic, …) needs the category set widened *and* every plural
  key re-authored. Recommended: adopt full CLDR plural categories and a
  per-language category function before the fifth language lands.
- **Single source-of-truth registry across platforms.** Today each platform
  owns its own copy of the key/value tables. Recommended: a single
  platform-neutral registry (e.g. one canonical catalog file or a generated
  artifact) that web, iOS, and Android all consume, so a translation lands once
  and cardinality is enforced centrally rather than per platform.
- **Diacritic / typo guarding.** Cardinality and copy-paste lint are gated, but
  there is no automated check for missing diacritics or wrong capitalization in
  translated values. Decide whether a translator round-trip (xliff/xcloc or an
  external translation system) replaces ad-hoc Swift-side authoring.
- **Substitution is naive string replacement.** `{placeholder}` tokens are
  replaced literally; there is no positional reordering, gendered agreement, or
  locale-aware number/date formatting inside a substituted value. Decide whether
  this is sufficient or whether a format-args model is required.

## Reference

- `rrradio-ios/rrradio/Views/LocaleController.swift` — `LocaleController`
  (`Choice` enum, persistence, resolution, `text(_:)` / `text(_:_:)` /
  `text(_:count:)` overloads), the `L10nKey` and `L10nPluralKey` registries,
  the `L10nPluralCategory` set, and the `L10n` lookup/fallback engine.
- `rrradio-ios/rrradio/Resources/Localizable.xcstrings` — the iOS source of
  truth for translated values (Xcode string catalog; plural keys stored as flat
  `key.one` / `key.other` composites).
- `rrradio-ios/rrradioTests/LocaleControllerTests.swift` — the cardinality,
  no-EN-copy-paste, plural-rule, and choice round-trip gates.
- `rrradio-ios/rrradio/CloudSync/CloudSyncSnapshot.swift`,
  `CloudSync/CloudSyncController.swift`, `CloudSync/CloudSyncStore.swift` — the
  language choice as a synced preference (`locale` field).

## Known deviations

- **Hand-rolled plurals bypass the registry.**
  `rrradio-ios/rrradio/Views/SettingsView.swift` (`cloudSyncSummary` and the
  station-list count row) build `count == 1 ? "X" : "Xs"` strings with
  hardcoded English nouns (`favorite`/`favorites`, `list`/`lists`,
  `station`/`stations`, `preferences`, `Last sync:`), shipping English to every
  locale. The intent above forbids this; the bug is tracked in
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md` (ST4–ST6)
  and `…-slice26.md` (LC3).
- **Historical missing-key / raw-English / diacritic backlog.** The
  LocaleController audit (`…-slice26.md`, findings LC1/LC2/LC11/LC12) recorded
  ~70 missing keys, two keys shipping raw English to DE/FR/ES, and nine
  diacritic typos. The localization sweep (Phase A) has since landed full
  cardinality (every `L10nKey` and `L10nPluralKey` carries all four languages)
  and the LC13 lint gates; treat the audit findings as the historical record of
  intent, not current state.
- **Cross-surface hardcoded English.** Multiple surfaces injected raw English
  a11y labels / companion-surface labels (cross-slice pattern catalogued in
  `…-audit-handover.md` and `…-fixes-prioritized.md`; e.g. slice 28 WR6 sends
  English queue names to the Watch). Each is a violation of the
  "every user-visible string flows through the registry" obligation above.
- **Static-engine vs OS string runtime (LC7).** The iOS engine materializes its
  own registry and routing rather than delegating plural/format handling to the
  OS string runtime (`…-slice26.md` LC7). This is intentional to keep the
  cross-platform `{count}`/`{placeholder}` contract identical everywhere, but it
  means OS-level translation tooling warnings do not apply; cardinality is held
  by the test gate instead.
