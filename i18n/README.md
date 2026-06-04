# Translations

Community translations for rrradio's user-interface strings. **You don't need
to code to help** — if you speak one of these languages, you can improve the
wording with a pull request.

These strings currently power the **iOS app**; the web app is English-only for
now but will draw from the same files as it gets localized.

## Languages

| File | Language | Role |
|------|----------|------|
| [`en.yaml`](en.yaml) | English | **Canonical source.** Everything else falls back to this. |
| [`de.yaml`](de.yaml) | Deutsch (German) | translation |
| [`fr.yaml`](fr.yaml) | Français (French) | translation |
| [`es.yaml`](es.yaml) | Español (Spanish) | translation |

Each file holds the same ~360 keys: **352 UI strings** plus **10 plurals**.

## How to propose a change

1. Open the file for your language (e.g. `de.yaml`).
2. Find the line and change **only the text in quotes** — the value, never the
   key on the left.
   ```yaml
   # before
   news: "Nachrichten"
   # after (example)
   news: "Neuigkeiten"
   ```
3. Open a pull request describing what you changed and why. A maintainer
   reviews it and ports merged changes into the app.

That's it. Small PRs (even a single fixed word) are welcome.

## Rules

These keep the files machine-readable and the apps working:

- **Never change the keys** (the part before the `:`). They are stable
  identifiers the code looks up — translating a key breaks the lookup.
- **Keep every `{placeholder}` token exactly** — `{count}`, `{name}`,
  `{service}`, etc. They are replaced with real values at runtime. Move them
  to wherever your language needs them, but don't rename or delete them.
  ```yaml
  listenOnService: "Écouter sur {service}"   # ✅ keeps {service}
  ```
- **Keep the double quotes** around values. If your text contains a `"`,
  escape it as `\"`.
- **Keep the same set of keys** as `en.yaml` — don't add or remove keys. (Add
  new keys only when you're also adding the matching English source.)
- **Don't translate brand/proper names** — `rrradio`, `Spotify`, `iCloud`,
  `Bluetooth`, etc. stay as-is. A value that is intentionally identical to
  English is fine.
- Only edit `en.yaml` to fix the **original English wording**; to translate,
  edit the other files.

## Plurals

Ten keys are plurals. Each needs a `one` form and an `other` form, and
`{count}` is replaced with the number:

```yaml
stationsCount:
  one: "{count} station"
  other: "{count} stations"
```

Use whatever forms your language's grammar needs:

- **French** treats both **0 and 1** as the `one` (singular) form.
- **English, German, Spanish** treat only **1** as `one`; everything else
  (including 0) uses `other`.

If your language has more plural categories than `one`/`other`, note it in your
PR and we'll extend the format.

## Adding a new language

1. Copy `en.yaml` to `<code>.yaml` (ISO 639-1 code, e.g. `it.yaml` for
   Italian).
2. Translate the values, following the rules above.
3. Open a PR and mention the new language — wiring it into the apps' language
   picker is a maintainer step.

## A note on syncing

This folder is the public place to **propose** wording. The iOS app keeps the
authoritative copy in its Xcode string catalog; these YAML files are generated
from it (a maintainer runs `scripts/extract-i18n.cjs` in the app repo to
refresh the snapshot).

That means the round-trip for an accepted change is: your PR is merged here →
a maintainer ports it into the string catalog → the next refresh reproduces it.
So **your merged edit isn't lost** when the snapshot is regenerated, but a
translation may ship a release or two after it lands here. Thanks for helping
rrradio speak your language. 🌍
