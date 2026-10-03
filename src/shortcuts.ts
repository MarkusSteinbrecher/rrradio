/**
 * Desktop keyboard shortcuts (#101). Pure key → action routing so the
 * rules (ignore typing, ignore modified keys, don't steal Space from a
 * focused button) are unit-testable; main.ts maps actions to the same
 * functions the on-screen controls call.
 */

export type ShortcutAction =
  | 'toggle-play'
  | 'focus-search'
  | 'toggle-favorite'
  | 'next'
  | 'previous'
  | 'toggle-mute'
  | 'toggle-help';

/** Shown in the help dialog, in this order. `keys` are display labels. */
export const SHORTCUTS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ['Space'], label: 'Play / pause' },
  { keys: ['/'], label: 'Search' },
  { keys: ['F'], label: 'Favorite the current station' },
  { keys: ['→', 'N'], label: 'Next favorite' },
  { keys: ['←', 'P'], label: 'Previous favorite' },
  { keys: ['M'], label: 'Mute / unmute' },
  { keys: ['?'], label: 'Show these shortcuts' },
];

/** The subset of KeyboardEvent the router reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
}

const KEY_MAP: Record<string, ShortcutAction> = {
  ' ': 'toggle-play',
  '/': 'focus-search',
  f: 'toggle-favorite',
  F: 'toggle-favorite',
  ArrowRight: 'next',
  n: 'next',
  N: 'next',
  ArrowLeft: 'previous',
  p: 'previous',
  P: 'previous',
  m: 'toggle-mute',
  M: 'toggle-mute',
  '?': 'toggle-help',
};

/** Text entry of any kind: inputs (incl. range sliders and radios, which
 *  use arrows), textareas, selects and contenteditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
    return true;
  }
  return false;
}

/** Elements Space/Enter natively activate — Space must keep doing that. */
function isActivatableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('button, a[href], summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])');
}

/**
 * Route a keydown to a shortcut, or null when it should be left alone.
 * `modalOpen`: a sheet / dialog is up — only the help toggle stays live
 * (and only while the help itself is the open dialog).
 */
export function shortcutFor(
  e: KeyLike,
  ctx: { modalOpen: boolean; helpOpen: boolean },
): ShortcutAction | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  const action = KEY_MAP[e.key];
  if (!action) return null;
  if (ctx.helpOpen) return action === 'toggle-help' ? action : null;
  if (ctx.modalOpen) return null;
  if (action === 'toggle-play' && isActivatableTarget(e.target)) return null;
  return action;
}
