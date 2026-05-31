# Spec Style & Authoring Standard

```yaml
id: rrradio-spec-style
status: approved
created: 2026-05-31
applies-to: docs/spec/**
```

This is the authoring contract for everything under `docs/spec/`. It exists so
the spec reads as one document written by one author, even when many people (or
agents) write it in parallel. Read it before adding or deepening any spec file.

The spec has two tiers:

- **Feature specs** (`features/*.md`) — *what the product does*, at the level of
  behavior a user can observe. Terse, declarative, table-driven. Exhaustive in
  coverage (every state, every interaction) but never a transcript of the iOS
  implementation.
- **Contract specs** (`contracts/*.md`) — *the cross-platform invariants every
  platform must match exactly*: schemas, state machines, merge rules, API
  shapes, payload formats. These go field-level and state-level, with real
  examples. `metadata-artwork.md` is the existing model for this depth.

`platforms.md`, `playback.md`, `data-sync.md` are cross-cutting feature specs.

## Voice & format (non-negotiable)

- Title: `# <Thing> Specification` (features) or `# <Thing> Contract` (contracts).
- Declarative present tense: "Pause keeps the current station selected." Not
  "The app will pause and keep…".
- Prefer bullets and tables over paragraphs. One idea per bullet.
- Every spec ends its platform-facing claims with a **Platform Matrix** table
  (`| Behavior | Web | iOS | Android |`) using the status legend in `README.md`.
- Describe **product behavior**, not iOS mechanics. Name an iOS type/file only in
  the **Reference** section. If a behavior is iOS-only, say so with a platform
  note — never let iOS-only mechanics leak into a shared contract (see the
  README principle).
- Don't duplicate catalog/privacy/curation rules from `../operations.md` — link.
- Keep it short *per claim*, exhaustive *in coverage*. A spec is done when every
  state and interaction is covered and nothing can be cut from any single claim.

## Stamp block (under the title)

Every file (new and, in Phase 3, existing) carries a `yaml` stamp directly under
its title so the spec is machine-checkable and its freshness is provable:

```yaml
status: draft | review | approved
platforms: [web, ios, android]      # the platforms this behavior targets
reconciled-against: <ios-commit>    # iOS commit this was last checked against
```

`reconciled-against` is the keep-alive mechanism: it records the exact iOS commit
the doc was verified against, so drift is visible.

## Feature spec template

```
# <Feature> Specification
```yaml
status: …  platforms: […]  reconciled-against: <commit>
```

## Purpose
One paragraph: the user value.

## Entry points
Every way a user reaches this surface.

## Layout
Every visible element, top to bottom. What each shows and does.

## States
empty · loading · loaded · partial · error · offline.
For each: what is shown, and what is actionable.

## Interactions
| Control / gesture | Precondition | Result | Side effects |
Cover every tap, long-press, drag, swipe, and system event.

## Business rules
Invariants, limits, ordering, timing. (e.g. recents dedupe within 60s; 30 cap.)

## Data dependencies
Which `contracts/*` this consumes.

## Edge cases
Failure handling, races, permission-denied, backgrounding, empty/huge inputs.

## Accessibility
VoiceOver/screen-reader labels, Dynamic Type / scaling, contrast, focus order.

## Localization
Which strings this surface owns; any plural/parameter needs.

## Platform Matrix
| Behavior | Web | iOS | Android |

## Open questions
Unresolved product decisions.

## Reference
iOS source files (the only place iOS mechanics are named).

## Known deviations
Links to `rrradio-ios/internal/audit/*` where the shipped code ≠ this intent.
The spec states intent; the audit owns the bug.
```

## Contract spec template

```
# <Contract> Contract
```yaml
status: …  platforms: […]  reconciled-against: <commit>
```

## Purpose
The invariant this pins down and who must honor it.

## Definition
The schema / state machine / merge algebra, stated formally.

## Detail
| Field / State | Type | Optional? | Meaning | Default |
Field-by-field (schema) or state-by-state (state machine).

## Examples
Real payloads, real transitions. Copy-paste-able.

## Versioning & evolution
How it changes; forward/backward compatibility; migration rules.

## Failure & fallback
Behavior on malformed, missing, conflicting, or stale input.

## Platform obligations
What each platform MUST do to honor the contract.

## Open questions

## Reference
iOS source files.

## Known deviations
Audit links.
```

## Reconciliation ritual (keep-alive)

The spec rots unless it is checked against reality on a cadence:

1. **Spec-first for new features** — write/extend the spec before the iOS code,
   then implement to it. (Mirrors the HQ spec-driven-design process.)
2. **Per-release reconciliation** — before each iOS release, walk the features
   that changed, update their specs, and bump `reconciled-against` to the release
   commit. Track coverage in `COVERAGE.md`.
3. **Mirror refresh** — after any spec change, the iOS repo's read-only mirror is
   refreshed via `rrradio-ios/scripts/sync-spec.sh`; `--check` flags staleness.
4. **Deviations, not edits** — when the code is found wrong (not the spec), file
   it in `rrradio-ios/internal/audit/` and link it from the spec's *Known
   deviations*. Don't rewrite the spec to match a bug.

See `COVERAGE.md` for the master tracking matrix and `README.md` "How To Maintain
This Spec" for the higher-level rules this expands on.
