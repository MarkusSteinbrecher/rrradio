import { describe, expect, it } from 'vitest';

describe('replaceChildren polyfill', () => {
  it('installs a spec-like shim when the engine lacks it', async () => {
    const proto = Element.prototype as unknown as { replaceChildren?: unknown };
    const native = proto.replaceChildren;
    delete proto.replaceChildren;
    try {
      await import('./polyfills');
      const el = document.createElement('div');
      el.append(document.createElement('span'), 'old');
      el.replaceChildren(document.createElement('b'), 'new');
      expect(el.innerHTML).toBe('<b></b>new');
      el.replaceChildren();
      expect(el.childNodes.length).toBe(0);
    } finally {
      proto.replaceChildren = native;
    }
  });
});
