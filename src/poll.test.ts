/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { POLL_KEY, POLL_CHOICE_LABELS, getVote, recordVote, buildPollBanner } =
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

describe('buildPollBanner — pre-vote', () => {
  it('renders eyebrow + title + three choice buttons', () => {
    const banner = buildPollBanner();
    expect(banner.classList.contains('poll-banner')).toBe(true);
    expect(banner.querySelector('.poll-banner__eyebrow')?.textContent).toBe('USER POLL');
    expect(banner.querySelector('.poll-banner__title')?.textContent).toBe(
      'ANYBODY WANT AN APP FOR THIS?',
    );
    const btns = banner.querySelectorAll('.poll-banner__btn');
    expect(btns).toHaveLength(3);
    const choices = Array.from(btns, (b) => (b as HTMLButtonElement).dataset.choice);
    expect(choices).toEqual(['ios', 'android', 'dont-care']);
    expect(banner.classList.contains('poll-banner--voted')).toBe(false);
  });

  it('switches to the voted panel after a click and persists the vote', () => {
    const banner = buildPollBanner();
    document.body.appendChild(banner);
    const iosBtn = banner.querySelector<HTMLButtonElement>('[data-choice="ios"]')!;
    iosBtn.click();
    expect(getVote()).toBe('ios');
    expect(trackCalls).toEqual(['vote: ios']);
    expect(banner.classList.contains('poll-banner--voted')).toBe(true);
    expect(banner.querySelector('.poll-banner__voted-choice')?.textContent).toBe(
      POLL_CHOICE_LABELS.ios,
    );
  });

  it('treats invalid data-choice values as a no-op', () => {
    const banner = buildPollBanner();
    document.body.appendChild(banner);
    const btn = banner.querySelector<HTMLButtonElement>('[data-choice="ios"]')!;
    btn.dataset.choice = 'maybe';
    btn.click();
    expect(getVote()).toBeNull();
    expect(trackCalls).toEqual([]);
  });
});

describe('buildPollBanner — post-vote', () => {
  it('mounts directly into the voted state when a prior vote exists', () => {
    recordVote('android');
    const banner = buildPollBanner();
    expect(banner.classList.contains('poll-banner--voted')).toBe(true);
    expect(banner.querySelector('.poll-banner__voted-choice')?.textContent).toBe(
      POLL_CHOICE_LABELS.android,
    );
  });

  it('invokes onSeeResults when the Stats button is clicked', () => {
    recordVote('ios');
    const onSeeResults = vi.fn();
    const banner = buildPollBanner({ onSeeResults });
    document.body.appendChild(banner);
    banner.querySelector<HTMLButtonElement>('.poll-banner__stats-btn')!.click();
    expect(onSeeResults).toHaveBeenCalledTimes(1);
  });

  it('still wires Stats button after voting from a pre-vote banner', () => {
    const onSeeResults = vi.fn();
    const banner = buildPollBanner({ onSeeResults });
    document.body.appendChild(banner);
    banner.querySelector<HTMLButtonElement>('[data-choice="dont-care"]')!.click();
    banner.querySelector<HTMLButtonElement>('.poll-banner__stats-btn')!.click();
    expect(onSeeResults).toHaveBeenCalledTimes(1);
  });
});
