/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** In-memory localStorage stub — matches storage.test.ts's approach.
 *  happy-dom 20 doesn't expose `localStorage` as a global by default
 *  and we want a deterministic per-test surface anyway. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  get length(): number { return this.map.size; }
}

const mem = new MemoryStorage();
vi.stubGlobal('localStorage', mem);

const trackCalls: string[] = [];

// Stub window.goatcounter.count so track() captures events into trackCalls.
beforeEach(() => {
  mem.clear();
  trackCalls.length = 0;
  (window as Window & { goatcounter?: { count: (v: { path?: string }) => void } }).goatcounter = {
    count: (v: { path?: string }) => {
      if (v.path) trackCalls.push(v.path);
    },
  };
});

afterEach(() => {
  document.body.innerHTML = '';
  (window as Window & { goatcounter?: unknown }).goatcounter = undefined;
});

// Import AFTER the localStorage stub is in place so the module-internal
// reference in storage.ts resolves to MemoryStorage.
const { POLL_KEY, getVote, recordVote, initPoll, renderPoll, buildPollRefs } =
  await import('./poll');

describe('recordVote', () => {
  it('persists the choice', () => {
    recordVote('ios');
    expect(getVote()).toBe('ios');
    expect(localStorage.getItem(POLL_KEY)).toBe('ios');
  });

  it('emits a GoatCounter event the first time', () => {
    recordVote('android');
    expect(trackCalls).toEqual(['vote: android']);
  });

  it('is idempotent on the same choice', () => {
    recordVote('ios');
    recordVote('ios');
    expect(trackCalls).toEqual(['vote: ios']);
  });

  it('does not re-emit when switching choice (server dedup owns counts)', () => {
    recordVote('ios');
    recordVote('android');
    expect(trackCalls).toEqual(['vote: ios']);
    expect(getVote()).toBe('android');
  });

  it('ignores unknown values in storage', () => {
    localStorage.setItem(POLL_KEY, 'banana');
    expect(getVote()).toBeNull();
  });
});

describe('initPoll', () => {
  function mount(): HTMLElement {
    const root = document.createElement('div');
    root.id = 'platform-poll';
    document.body.appendChild(root);
    return root;
  }

  it('renders three choice buttons before any vote', () => {
    const root = mount();
    initPoll(root);
    const btns = root.querySelectorAll('.poll-btn');
    expect(btns).toHaveLength(3);
    const choices = Array.from(btns, (b) => (b as HTMLButtonElement).dataset.choice);
    expect(choices).toEqual(['ios', 'android', 'dont-care']);
  });

  it('flips to thanks state after a click and records the vote', () => {
    const root = mount();
    initPoll(root);
    const iosBtn = root.querySelector<HTMLButtonElement>('[data-choice="ios"]');
    expect(iosBtn).toBeTruthy();
    iosBtn!.click();
    expect(getVote()).toBe('ios');
    expect(trackCalls).toEqual(['vote: ios']);
    const thanks = root.querySelector<HTMLElement>('.poll-thanks');
    const buttons = root.querySelector<HTMLElement>('.poll-options');
    expect(thanks?.hidden).toBe(false);
    expect(buttons?.hidden).toBe(true);
    expect(root.querySelector('.poll-thanks__choice')?.textContent).toBe('I want an iOS app');
  });

  it('renders thanks state on mount when a vote was already cast', () => {
    recordVote('dont-care');
    const root = mount();
    initPoll(root);
    expect(root.querySelector<HTMLElement>('.poll-thanks')?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.poll-options')?.hidden).toBe(true);
  });

  it('is idempotent — re-initialising the same root reuses refs', () => {
    const root = mount();
    initPoll(root);
    const firstButtons = root.querySelector('.poll-options');
    initPoll(root);
    const secondButtons = root.querySelector('.poll-options');
    expect(secondButtons).toBe(firstButtons);
    expect(root.querySelectorAll('.poll-btn')).toHaveLength(3);
  });
});

describe('renderPoll', () => {
  it('clears is-chosen + restores button visibility when vote becomes null', () => {
    const root = document.createElement('div');
    const refs = buildPollRefs(root);
    renderPoll(refs, 'ios');
    expect(refs.thanksWrap.hidden).toBe(false);
    renderPoll(refs, null);
    expect(refs.buttonsWrap.hidden).toBe(false);
    expect(refs.thanksWrap.hidden).toBe(true);
  });
});
