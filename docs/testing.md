# rrradio — Testing

Three stacks live in this web repo, each owning its slice of the pipeline. Native app tests live in their app repos. CI runs the unit stacks on every push; the e2e job gates the GitHub Pages deploy.

| Stack | Where | Runs | What |
|---|---|---|---|
| **Vitest (web)** | `src/*.test.ts` | `npm test` | Pure logic + DOM-render harness tests with happy-dom. Co-located with subjects (`src/foo.ts` ↔ `src/foo.test.ts`). |
| **Vitest (worker)** | `worker/src/*.test.ts` | `cd worker && npm test` | Calls the worker's default export's `fetch()` directly with stub Request + Env; intercepts upstream fetches via `globalThis.fetch` stub. |
| **Playwright (e2e)** | `e2e/smoke.spec.ts` | `npm run test:e2e` | Cold-boot Chromium against `vite preview` of the built `dist/`. CSP regression + add-custom HTTPS-only + catalog renders + search filters. |

Cumulative count today in this repo: ~280 web, 32 worker, 8 e2e ≈ ~320 cases.

## DOM render-test harness (audit #77 pattern)

When extracting a DOM-touching render function out of `main.ts`, follow the established pattern:

1. **Define a typed `*Refs` interface** that enumerates every element the render writes to. Tests get static checking that the HTML fragment has the right ids; production gets a clean dependency list.
2. **Pure inputs only.** No `wakeScheduler.current()` etc. inside the render — pass non-DOM dependencies through a `*Context` interface alongside refs. main.ts wires production refs/ctx once at boot; tests pass fixtures.
3. **Add a fragment to `src/render-test-harness.ts`** — a minimal HTML snippet that mirrors the production markup the render touches. Drift between fragment and `index.html` is caught at PR time by the type system (the refs interface enumerates ids that must exist in the fragment).
4. **Test pattern:**
   ```ts
   import { mountFragment, getById } from './render-test-harness';
   import { MY_FRAGMENT } from './render-test-harness';

   beforeEach(() => mountFragment(MY_FRAGMENT));
   afterEach(() => { document.body.innerHTML = ''; });

   it('writes the title', () => {
     const refs = getById({ title: 'foo-title' }) as MyRefs;
     myRender(refs, { ...fixture });
     expect(refs.title.textContent).toBe('—');
   });
   ```

Renders that touch 20+ elements (`renderNowPlaying`, dashboard map) get their fragments named in the harness file. Smaller renders can inline a fragment string in the test.

## What's tested vs. not

**Tested at unit level:**
- Pure helpers (format / np-labels / np-display / station-display / country / dashboard reducers / wake math / search / storage)
- Render functions via the harness
- Storage failure modes (privacy-mode getItem throws, quota errors)
- AudioPlayer state machine + race conditions (audit #74)
- Worker CORS / auth / allowlist / GC error handling
- Catalog tooling: check-catalog (URL safety + HTTPS-only), check-duplicates (CI gate)

**Tested at e2e level:**
- Catalog renders (>20 rows visible)
- Search filters surface a known station
- Whitespace-insensitive search (WDR5 → WDR 5)
- About sheet open/close
- Add-custom rejects http:// (audit #71 regression)
- CSP meta tag has hashes + no `'unsafe-inline'` (audit #75 regression)
- Click row → no thrown error (audio fetch mocked away)

**Deliberately NOT tested** (out of scope or harness-cost too high):
- Live broadcaster fetcher impls — most need real upstream hits

The iOS XCTest suite and its remaining native test gaps live in
<https://github.com/MarkusSteinbrecher/rrradio-ios>.
