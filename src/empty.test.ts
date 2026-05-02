/// <reference lib="dom" />
import { describe, expect, it } from 'vitest';
import { emptyState, statusLine } from './empty';

describe('statusLine', () => {
  it('renders the message as text', () => {
    const el = statusLine('Off air');
    expect(el.textContent).toBe('Off air');
  });

  it('escapes HTML — no markup smuggling via dynamic message', () => {
    // The audit specifically calls out that statusLine receives error
    // text (`Off air · ${err.message}`) and a malicious / library-leaked
    // error string with markup must NOT inject DOM.
    const payload = '<img src=x onerror="alert(1)">';
    const el = statusLine(payload);
    // textContent reads the literal payload back verbatim.
    expect(el.textContent).toBe(payload);
    // No <img> child element materialized.
    expect(el.querySelector('img')).toBeNull();
    // Sanity check the safe inner DOM shape.
    expect(el.children.length).toBe(1);
    expect(el.firstElementChild?.className).toBe('s');
  });

  it('escapes HTML even from a multi-tag payload', () => {
    const payload = '</div><script>alert(1)</script>';
    const el = statusLine(payload);
    expect(el.textContent).toBe(payload);
    expect(el.querySelector('script')).toBeNull();
  });
});

describe('emptyState', () => {
  it('renders icon, title, and subtitle', () => {
    const el = emptyState('<svg></svg>', 'No favorites yet', 'Tap the heart');
    expect(el.querySelector('.t')?.textContent).toBe('No favorites yet');
    expect(el.querySelector('.s')?.textContent).toBe('Tap the heart');
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('escapes HTML in title (defense-in-depth — current callers pass static text)', () => {
    const el = emptyState('<svg></svg>', '<b>x</b>', 'sub');
    expect(el.querySelector('.t')?.textContent).toBe('<b>x</b>');
    // No <b> tag materialized.
    expect(el.querySelector('.t b')).toBeNull();
  });

  it('escapes HTML in sub', () => {
    const el = emptyState('<svg></svg>', 'title', '<script>alert(1)</script>');
    expect(el.querySelector('.s')?.textContent).toBe('<script>alert(1)</script>');
    expect(el.querySelector('.s script')).toBeNull();
  });

  it('renders the icon as actual markup (trusted SVG constant)', () => {
    // The icon arg is intentionally HTML — caller passes a known SVG
    // constant from the icon registry. Splitting it from the text means
    // we can render it via innerHTML on its own wrapper while still
    // using textContent for the dynamic strings.
    const el = emptyState(
      '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>',
      'title',
      'sub',
    );
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('svg path')).not.toBeNull();
  });
});
