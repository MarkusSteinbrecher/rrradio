/// <reference lib="dom" />
import { describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutFor, type KeyLike } from './shortcuts';

const idle = { modalOpen: false, helpOpen: false };

function key(k: string, over: Partial<KeyLike> = {}): KeyLike {
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    target: document.body,
    ...over,
  };
}

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host.firstElementChild as Element;
}

describe('shortcutFor', () => {
  it('maps the documented keys', () => {
    expect(shortcutFor(key(' '), idle)).toBe('toggle-play');
    expect(shortcutFor(key('/'), idle)).toBe('focus-search');
    expect(shortcutFor(key('f'), idle)).toBe('toggle-favorite');
    expect(shortcutFor(key('ArrowRight'), idle)).toBe('next');
    expect(shortcutFor(key('n'), idle)).toBe('next');
    expect(shortcutFor(key('ArrowLeft'), idle)).toBe('previous');
    expect(shortcutFor(key('P'), idle)).toBe('previous');
    expect(shortcutFor(key('m'), idle)).toBe('toggle-mute');
    expect(shortcutFor(key('?'), idle)).toBe('toggle-help');
    expect(shortcutFor(key('x'), idle)).toBeNull();
  });

  it('ignores typing in inputs, textareas, selects and contenteditable', () => {
    for (const html of [
      '<input type="search">',
      '<input type="range">',
      '<textarea></textarea>',
      '<select><option>a</option></select>',
      '<div contenteditable="true"><span>x</span></div>',
    ]) {
      const target = el(html);
      const inner = target.querySelector('span') ?? target;
      expect(isTypingTarget(inner)).toBe(true);
      expect(shortcutFor(key('f', { target: inner }), idle)).toBeNull();
      expect(shortcutFor(key(' ', { target: inner }), idle)).toBeNull();
      expect(shortcutFor(key('/', { target: inner }), idle)).toBeNull();
    }
  });

  it('ignores modified keys and already-handled events', () => {
    expect(shortcutFor(key('f', { metaKey: true }), idle)).toBeNull();
    expect(shortcutFor(key('n', { ctrlKey: true }), idle)).toBeNull();
    expect(shortcutFor(key('m', { altKey: true }), idle)).toBeNull();
    expect(shortcutFor(key(' ', { defaultPrevented: true }), idle)).toBeNull();
  });

  it('leaves Space to a focused button / link / row, other keys still work', () => {
    const button = el('<button type="button">x</button>');
    expect(shortcutFor(key(' ', { target: button }), idle)).toBeNull();
    expect(shortcutFor(key('n', { target: button }), idle)).toBe('next');
    const row = el('<div role="button" tabindex="0">row</div>');
    expect(shortcutFor(key(' ', { target: row }), idle)).toBeNull();
  });

  it('stays out of the way while a sheet / dialog is open', () => {
    const modal = { modalOpen: true, helpOpen: false };
    expect(shortcutFor(key(' '), modal)).toBeNull();
    expect(shortcutFor(key('?'), modal)).toBeNull();
    const help = { modalOpen: true, helpOpen: true };
    expect(shortcutFor(key('?'), help)).toBe('toggle-help');
    expect(shortcutFor(key('f'), help)).toBeNull();
  });
});
