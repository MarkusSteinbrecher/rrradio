# Manual UAT scripts — rrradio

> Per [HQ testing convention](https://github.com/MarkusSteinbrecher/HQ/blob/main/wiki/conventions/testing.md). Markdown scripts a non-engineer (or the sponsor) can follow without reading code. Self-contained: open the file, follow the steps, tick the boxes.

## How to run a UAT cycle

1. **Open a cycle issue** in this repo using the `UAT cycle` issue template (`.github/ISSUE_TEMPLATE/uat-cycle.yml`). Fill in build, environment, tester. The template seeds the per-flow checklist.
2. **Walk each script** in `tests/manual/<surface>/` listed in the cycle's scope. Tick the cycle's checkbox when a flow passes.
3. **On failure:** open a child bug issue with `Found in #<cycle>` in the body, and `Per tests/manual/<flow>.md` referencing the script. Update the cycle issue's checklist row to `tests/manual/<flow>.md — failed, see #<bug>`.
4. **Close the cycle issue** when every flow is accounted for (passed, failed-and-handed-off, or skipped-with-reason). The closing comment fills the **Result** block.

## Surfaces

- **iOS native app** — moved to <https://github.com/MarkusSteinbrecher/rrradio-ios>.
- **`web/`** — Web PWA. *(Not yet populated; web has automated coverage in `tests/e2e/` for now.)*

## Discipline

- **Update scripts when you touch the feature.** Same PR. If you don't have time to update the script, you don't have time to ship the change.
- **Empty `[?]` slots in scripts are honest signals**, not blockers. Filling them precisely is the discipline.
- **Stale scripts get pruned** during the wiki/portfolio audit (HQ improvement-loop). If a flow no longer exists, delete its script — confused testers cause more rework than missing scripts.

## Related

- [HQ testing convention](https://github.com/MarkusSteinbrecher/HQ/blob/main/wiki/conventions/testing.md) — authority for this folder.
- [`tests/e2e/`](../e2e/) — automated counterparts (Playwright + Vitest).
- [`docs/testing.md`](../../docs/testing.md) — how rrradio's four test stacks fit together.
- Issue template: [`.github/ISSUE_TEMPLATE/uat-cycle.yml`](../../.github/ISSUE_TEMPLATE/uat-cycle.yml).
