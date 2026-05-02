import { describe, expect, it } from 'vitest';
import {
  ICON_EMPTY,
  ICON_FAV,
  ICON_GRIP,
  ICON_HEART_FILL,
  ICON_HEART_LINE_CLASSED,
  ICON_RECENT,
  STAR_SVG,
  svg,
} from './icons';

describe('svg factory', () => {
  it('builds a stroke-style icon by default', () => {
    const out = svg('<path d="M0 0"/>');
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('fill="none"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('<path d="M0 0"/>');
  });

  it('opts.fill switches to a filled glyph', () => {
    const out = svg('<path/>', { fill: true });
    expect(out).toContain('fill="currentColor"');
    expect(out).not.toContain('stroke="currentColor"');
  });

  it('opts.viewBox overrides the default', () => {
    expect(svg('<path/>', { viewBox: '0 0 16 16' })).toContain('viewBox="0 0 16 16"');
  });
});

describe('icon constants', () => {
  // The icons render as `<a href>` siblings via `innerHTML` writes —
  // a malformed string would break the row layout. Cheap regression
  // guard against accidental edits.
  const all = {
    ICON_HEART_FILL,
    ICON_HEART_LINE_CLASSED,
    ICON_FAV,
    ICON_RECENT,
    ICON_EMPTY,
    ICON_GRIP,
    STAR_SVG,
  };

  it.each(Object.entries(all))('%s is a self-contained <svg>', (_, html) => {
    expect(html.startsWith('<svg')).toBe(true);
    expect(html.endsWith('</svg>')).toBe(true);
    expect(html).toContain('viewBox=');
  });

  it.each(Object.entries(all))('%s is aria-hidden', (_, html) => {
    expect(html).toContain('aria-hidden="true"');
  });
});
