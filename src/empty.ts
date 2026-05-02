/**
 * Empty / status state renderers.
 *
 * Pulled out of `src/main.ts` so the text-injection paths flagged by
 * audit #75 can be unit-tested without spinning up the full app DOM.
 *
 * Both functions deliberately use `textContent` for any string the
 * caller passes (titles, subs, error messages). They accept an `iconHtml`
 * string only when the caller is passing a known-trusted SVG constant
 * (the icon registry in main.ts) — that surface is rendered via
 * `innerHTML` on a wrapper element. Future callers passing user-derived
 * text into the text fields can't smuggle markup.
 */

export function statusLine(message: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.style.padding = '40px 32px';
  const inner = document.createElement('div');
  inner.className = 's';
  inner.textContent = message;
  wrap.append(inner);
  return wrap;
}

export function emptyState(iconHtml: string, title: string, sub: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const icon = document.createElement('span');
  icon.innerHTML = iconHtml;
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = title;
  const s = document.createElement('div');
  s.className = 's';
  s.textContent = sub;
  wrap.append(icon, t, s);
  return wrap;
}
