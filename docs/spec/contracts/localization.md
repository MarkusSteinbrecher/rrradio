# Localization Contract

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

Pins the shared localization model so the same UI string renders identically
(same key, same fallback, same plural choice) on web, iOS, and Android.

The invariant has three parts every platform must honor:

1. **A shared key registry** — one canonical set of string-key names. A key
   names a slot in the UI, never an English literal.
2. **A fixed supported-language set** — `en`, `de`, `fr`, `es`, `it`, `ru`.
   `en` is the source language and the universal fallback.
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
choice ∈ { system, english, german, french, spanish, italian, russian }   (user preference)
rawCode = choice == system ? OS-language : choice-code   // english→"en", german→"de", … russian→"ru"
resolvedLanguage =
    rawCode startsWith "de" → "de"
    rawCode startsWith "fr" → "fr"
    rawCode startsWith "es" → "es"
    rawCode startsWith "it" → "it"
    rawCode startsWith "ru" → "ru"
    otherwise               → "en"
```

- The user picks a **choice**, not a raw locale. `system` follows the OS UI
  language; the six explicit choices pin a language regardless of OS.
- The choice is a named token (`english`, `german`, …), not the ISO code. The
  code is derived from the choice (`english → en`, `russian → ru`) and only the
  code is collapsed below.
- Resolution collapses any regional variant to one of the six base codes by
  prefix; anything unrecognized resolves to `en`.
- The choice is persisted and re-applied on launch. The resolved language is
  recomputed live when the OS language changes *and* the choice is `system`
  (and a `locale` diagnostic note records the new code).

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

The category set is the CLDR cardinal subset `one`/`few`/`many`/`other`. Each
language uses only the categories its rule can produce:

```
pluralCategory(count, lang):
    lang == "fr" →
        (count == 0 || count == 1) ? one : other            // FR: 0 and 1 are singular
    lang == "ru" →                                           // RU integer cardinals
        (count%10 == 1 && count%100 != 11)               ? one
        (count%10 ∈ 2..4 && count%100 ∉ 12..14)          ? few
        otherwise                                          → many
    otherwise →
        (count == 1) ? one : other                          // EN/DE/ES/IT: only 1 is singular
```

- `en`/`de`/`es`/`it` and `fr` only ever resolve to `one` or `other`; their
  tables carry only those two categories.
- `ru` resolves to `one`/`few`/`many`; its table carries those three (its
  `other` slot is fraction-only and unreachable for integer counts, so it is
  the table fallback, not a produced category).
- The set omits `zero`/`two`. Adding a language whose CLDR rule needs `two`
  (or that uses `other` for integers) requires extending `pluralCategory`.

## Detail

### Language choice

| State | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `system` | choice | — | Follow the OS UI language; resolved code recomputed on OS-language change. | yes (default) |
| `english` | choice | — | Force English (code `en`). | — |
| `german` | choice | — | Force German (code `de`). | — |
| `french` | choice | — | Force French (code `fr`). | — |
| `spanish` | choice | — | Force Spanish (code `es`). | — |
| `italian` | choice | — | Force Italian (code `it`). | — |
| `russian` | choice | — | Force Russian (code `ru`). | — |

- Persisted as the choice token (`system` / `english` / `german` / `french` /
  `spanish` / `italian` / `russian`), not the resolved code, so a `system` user
  keeps following the OS after a relaunch.
- The choice is a syncable preference (see [Data and sync](../data-sync.md));
  the resolved code and any OS-language change are never synced.

### Singular key entry

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| key | identifier | no | Stable slot name; identical across platforms. | — |
| `en` value | string | no | Source-language text; also the fallback value. | — |
| `de`/`fr`/`es`/`it`/`ru` value | string | no (full cardinality) | Translated text. | — |
| `{placeholder}` tokens | inline | yes | Named substitutions filled at render. Unfilled tokens are left literal. | left intact |

### Plural key entry

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| key | identifier | no | Stable plural slot name. | — |
| `one` value | string | no | Singular-category template; contains `{count}`. | — |
| `other` value | string | no | Plural-category template; contains `{count}`. | — |
| `few`/`many` value | string | only where the rule produces it (currently `ru`) | CLDR `few`/`many` templates; contain `{count}`. | — |
| per language | category templates | no (full cardinality) | Each supported language carries at minimum `one` + `other`; `ru` additionally carries `few` + `many`. | — |

### Plural keys (registry)

The plural namespace is small and fixed; every entry is a count-prefixed noun:

`broadcastsCount` · `stationsCount` · `favoritesCount` · `listsCount` ·
`customStationsCount` · `recentsCount` · `catalogStationsLoaded` ·
`cloudSyncRestored` · `cloudSyncSynced` · `cloudSyncPushed` ·
`stationsRemovedToast` · `deleteListStationsKept`.

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
broadcastsCount.one  → en:"{count} broadcast"   de:"{count} Sendung"   fr:"{count} émission"   es:"{count} programa"   it:"{count} trasmissione"   ru:"{count} передача"
broadcastsCount.other→ en:"{count} broadcasts"  de:"{count} Sendungen" fr:"{count} émissions" es:"{count} programas"  it:"{count} trasmissioni"  ru:"{count} передачи"
broadcastsCount.few  → ru:"{count} передачи"     // RU only
broadcastsCount.many → ru:"{count} передач"      // RU only

text(.broadcastsCount, count:0, "en") = "0 broadcasts"   // EN: 0 → other
text(.broadcastsCount, count:1, "en") = "1 broadcast"
text(.broadcastsCount, count:0, "fr") = "0 émission"     // FR: 0 → one
text(.broadcastsCount, count:2, "fr") = "2 émissions"
text(.broadcastsCount, count:0, "de") = "0 Sendungen"
text(.broadcastsCount, count:1, "ru") = "1 передача"     // RU: 1,21,31… → one (not 11)
text(.broadcastsCount, count:2, "ru") = "2 передачи"     // RU: 2-4,22-24… → few (not 12-14)
text(.broadcastsCount, count:5, "ru") = "5 передач"      // RU: 0,5-20,11-14… → many
text(.broadcastsCount, count:11, "ru") = "11 передач"    // RU: 11 → many (not one)
text(.broadcastsCount, count:3, "xx") = "3 broadcasts"   // unknown lang → en + other
```

## Versioning & evolution

- **Adding a key**: add it to the registry with all six language values in the
  same change. A key with fewer than six values violates full cardinality.
- **Adding a language**: extend the language set, supply every singular and
  plural value, and extend `pluralCategory` if the language needs categories
  beyond `one`/`other`/`few`/`many`. Until the choice and prefix-collapse rule
  recognize its code it falls back to `en` per the lookup rule.
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
  (`en`/`de`/`fr`/`es`/`it`/`ru`), identical lookup and plural algebra above.
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

- Choice set: `system`, `english`, `german`, `french`, `spanish`, `italian`,
  `russian`; persisted in UserDefaults as the choice token (not the code).
- Language choice participates in CloudKit preference sync, carried as the same
  choice token; the resolved code and OS-language changes do not sync. A
  cloud-applied choice that equals the local one is a silent no-op.
- Re-render is driven by the resolved language code being part of the view
  identity / snapshot token.
- **Time formatting is independent of the language choice.** Time pickers and
  time labels (e.g. the wake alarm) follow the device 24-Hour Time setting, not
  the chosen app language: an English-language user on a 24-hour device sees
  24-hour times, never AM/PM (issue #57). Only the hour cycle is grafted from
  the device onto the app language; the rest of the locale stays language-only.

**Web**

- The web app ships no localization layer today: there is no key registry, no
  language choice, and no plural engine. Every user-visible string is a
  hardcoded English literal, so the registry/fallback/plural obligations above
  are **not implemented** on web (see the matrix).
- Language is effectively English-only. There is no `system`/language preference
  and no cloud sync of a choice; the only locale-aware behavior is incidental
  browser formatting (`Intl.DisplayNames` for country names, `toLocaleTimeString`
  for schedule times), which follows the browser locale, not an in-app choice.

**Android**

- Localization is planned, not yet shipped (see the matrix). Today the app is
  English-only: a single `res/values/strings.xml` carries two app-chrome strings
  (`app_name`, `playback_channel_name`) and there are no `values-de`/`-fr`/`-es`/
  `-it`/`-ru` resource folders, no key registry, no language choice, and no
  plural engine. The only locale-aware behavior is incidental device-locale
  formatting (`Locale.displayCountry` for country names — the Android analogue of
  web's `Intl.DisplayNames`), which follows the device locale, not an in-app
  choice.
- When implemented, honor the same registry, language set, fallback order, and
  plural algebra; map `system` to the device locale; keep the choice local-only.
  The natural Android mechanic is the resource framework (`values-<lang>/`
  string + `plurals` resources, or a parallel in-app registry) with the engine
  still materializing the registry shape, lookup order, and plural algebra
  defined here rather than delegating to the OS string runtime — matching iOS's
  static-engine approach (LC7) for an identical cross-platform contract.
- Language-choice cloud sync is not applicable: the first Android port has no
  cloud-sync transport, and the iOS choice rides CloudKit (Apple-only). The
  choice stays a local preference.

### Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Shared key registry | Not planned | Reference | Planned |
| Supported language set (en/de/fr/es/it/ru) | Not planned (English-only) | Reference | Planned |
| Full-cardinality enforcement | Not planned | Supported (test-gated) | Planned |
| `en` fallback on missing key | Not planned | Supported | Planned |
| CLDR plural (`one`/`few`/`many`/`other`) | Not planned | Supported | Planned |
| `{placeholder}` substitution | Not planned | Supported | Planned |
| `system` follows OS language | Not planned | Supported | Planned |
| Time format follows device 24-Hour setting | Partial (browser-locale, no in-app choice) | Supported | Planned |
| Language choice cloud sync | Not planned | Supported | Not applicable (no cloud-sync transport; iOS rides CloudKit) |

## Open questions

- **No registry version field.** Keys are matched by name with no compatibility
  marker. A shared registry consumed by three platforms eventually needs a
  version (or content hash) so a platform can detect that it is reading a newer
  key set than it understands. Decide whether to add one and where it lives.
- **Plural rules are per-language hard-codes, not a general CLDR engine.** The
  category set is `one`/`few`/`many`/`other`, but `pluralCategory` switches on
  the language string with bespoke arithmetic per case (a French `0→one` rule, a
  Russian mod-10/mod-100 rule, an `else` of `1→one`). It still omits `zero` and
  `two`, so a language needing those (Polish, Arabic, Welsh, …) requires both a
  new category and a new hand-written branch, plus re-authoring every plural key
  to carry the added categories. Recommended: replace the per-language switch
  with a data-driven CLDR plural-rules table before the next language lands.
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
  (`Choice` enum incl. `italian`/`russian`, persistence, resolution, `text(_:)`
  / `text(_:_:)` / `text(_:count:)` overloads, `timeLocale` 24-hour grafting),
  the `L10nKey` and `L10nPluralKey` registries, the `L10nPluralCategory` set
  (`one`/`few`/`many`/`other`), and the `L10n` lookup/fallback engine
  (incl. `pluralCategory(forCount:language:)` per-language rules).
- `rrradio-ios/rrradio/Resources/Localizable.xcstrings` — the iOS source of
  truth for translated values (Xcode string catalog; six localizations; plural
  keys stored as flat `key.one` / `key.few` / `key.many` / `key.other`
  composites and re-assembled at load).
- `rrradio-ios/rrradioTests/LocaleControllerTests.swift` — the cardinality,
  no-EN-copy-paste, plural-rule (incl. the Russian one/few/many cases), and
  choice round-trip gates.
- `rrradio-ios/rrradio/CloudSync/CloudSyncSnapshot.swift`,
  `CloudSync/SettingsBackup.swift`, `CloudSync/CloudSyncController.swift`,
  `CloudSync/CloudSyncStore.swift` — the language choice as a synced preference
  (`locale` field, carrying the choice token).

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
  cardinality (every `L10nKey` carries all six languages, and every
  `L10nPluralKey` carries `one`/`other` per language plus `few`/`many` for `ru`)
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
