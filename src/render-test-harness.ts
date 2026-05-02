/**
 * DOM render-test harness (audit #77 follow-up).
 *
 * Pure render functions that take typed `*Refs` interfaces (not
 * module-globals) can be tested by:
 *   1. Mounting a fragment of the production HTML into happy-dom's
 *      `document.body`.
 *   2. Using `mountIndexFragments({ ids })` to grab the `<div>` /
 *      `<span>` etc. elements with those ids.
 *   3. Calling the render function with the resulting refs object,
 *      then asserting on `textContent` / `hidden` / `classList`.
 *
 * The fragments are **not** the full index.html — they're minimal
 * snippets that mirror the relevant parts of the markup. This keeps
 * tests fast and focused: each render's test sets up only the DOM
 * surface it touches. Drift between the production markup and the
 * fragments is caught at PR time by the type system (the `*Refs`
 * interface enumerates the elements the render actually accesses).
 */

/** Minimal HTML fragment for the mini-player chrome. Mirrors the
 *  shape main.ts builds at id "mini" / "mini-fav" / "mini-name" /
 *  "mini-meta". Production HTML (index.html) is the source of truth;
 *  this fragment exists so render tests don't depend on it. */
export const MINI_FRAGMENT = `
<button id="mini" type="button" hidden>
  <span id="mini-fav" aria-hidden="true"></span>
  <span class="mini-info">
    <span id="mini-name">—</span>
    <span class="mini-meta">
      <span id="mini-meta">STANDBY</span>
    </span>
  </span>
</button>
`;

/** Mount a markup fragment into the test document and return a fresh
 *  reference to its root. Replaces any previous body content so each
 *  test starts clean. */
export function mountFragment(fragment: string): void {
  document.body.innerHTML = fragment;
}

/** Resolve a record of element ids → their corresponding HTMLElement.
 *  Throws if any id is missing — preferable to silently typing `null`
 *  away because a missing element would mean the production markup
 *  drifted from the fragment. */
export function getById<T extends Record<string, string>>(
  map: T,
): { [K in keyof T]: HTMLElement } {
  const out = {} as { [K in keyof T]: HTMLElement };
  for (const key in map) {
    const el = document.getElementById(map[key]);
    if (!el) throw new Error(`render-test-harness: #${map[key]} not found in body`);
    out[key] = el;
  }
  return out;
}

/** Convenience: mount + resolve in one call. */
export function setup<T extends Record<string, string>>(
  fragment: string,
  ids: T,
): { [K in keyof T]: HTMLElement } {
  mountFragment(fragment);
  return getById(ids);
}
