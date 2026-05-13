/**
 * Platform-interest poll — a one-shot question shown in the About
 * sheet: "I want an iOS app", "I want an Android app", "I don't care".
 *
 * Vote storage: GoatCounter event (`vote: ios` / `vote: android` /
 * `vote: dont-care`) via track(). GoatCounter dedupes by an 8h
 * session hash on the server side, so we get directional signal
 * without storing anything that could identify a voter.
 *
 * Local state: a single localStorage flag (`rrradio.poll.platform.v1`)
 * remembers the user's choice so the UI flips to a thank-you state
 * after voting. Trivially bypassable (incognito / clear storage),
 * which is fine — the cosmetic dedup just stops accidental
 * double-clicks. Server-side dedup is GoatCounter's job.
 */

import { getString, setString } from './storage';
import { track } from './telemetry';

export const POLL_KEY = 'rrradio.poll.platform.v1';

export type PollChoice = 'ios' | 'android' | 'dont-care';

const CHOICE_LABELS: Record<PollChoice, string> = {
  ios: 'I want an iOS app',
  android: 'I want an Android app',
  'dont-care': "I don't care",
};

const CHOICES: PollChoice[] = ['ios', 'android', 'dont-care'];

function isChoice(v: string | null): v is PollChoice {
  return v === 'ios' || v === 'android' || v === 'dont-care';
}

export function getVote(): PollChoice | null {
  const v = getString(POLL_KEY);
  return isChoice(v) ? v : null;
}

/** Records a vote. Idempotent — re-voting with the same choice is a
 *  no-op; switching choice updates local state but does NOT re-emit
 *  the event (server-side dedup would discard the duplicate anyway,
 *  and we don't want to bias counts toward people who hesitate). */
export function recordVote(choice: PollChoice): void {
  const prior = getVote();
  if (prior === choice) return;
  setString(POLL_KEY, choice);
  if (prior === null) track(`vote: ${choice}`);
}

export interface PollRefs {
  root: HTMLElement;
  buttonsWrap: HTMLElement;
  thanksWrap: HTMLElement;
  thanksChoice: HTMLElement;
}

export function buildPollRefs(root: HTMLElement): PollRefs {
  const buttonsWrap = document.createElement('div');
  buttonsWrap.className = 'poll-options';
  buttonsWrap.setAttribute('role', 'group');
  buttonsWrap.setAttribute('aria-label', 'Native-app interest poll');

  for (const c of CHOICES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'poll-btn';
    btn.dataset.choice = c;
    btn.textContent = CHOICE_LABELS[c];
    buttonsWrap.appendChild(btn);
  }

  const thanksWrap = document.createElement('div');
  thanksWrap.className = 'poll-thanks';
  thanksWrap.hidden = true;
  const thanksMsg = document.createElement('span');
  thanksMsg.className = 'poll-thanks__msg';
  thanksMsg.textContent = 'Thanks — your vote: ';
  const thanksChoice = document.createElement('strong');
  thanksChoice.className = 'poll-thanks__choice';
  thanksWrap.append(thanksMsg, thanksChoice);

  root.appendChild(buttonsWrap);
  root.appendChild(thanksWrap);

  return { root, buttonsWrap, thanksWrap, thanksChoice };
}

export function renderPoll(refs: PollRefs, vote: PollChoice | null): void {
  if (vote === null) {
    refs.buttonsWrap.hidden = false;
    refs.thanksWrap.hidden = true;
    for (const btn of refs.buttonsWrap.querySelectorAll<HTMLButtonElement>('.poll-btn')) {
      btn.classList.remove('is-chosen');
      btn.setAttribute('aria-pressed', 'false');
    }
    return;
  }
  refs.buttonsWrap.hidden = true;
  refs.thanksWrap.hidden = false;
  refs.thanksChoice.textContent = CHOICE_LABELS[vote];
}

/** Mount the poll inside `root` (a container provided by index.html)
 *  and wire click handlers. Idempotent — repeat calls reuse the same
 *  refs by stashing them on the root element. */
export function initPoll(root: HTMLElement): PollRefs {
  const existing = (root as HTMLElement & { __pollRefs?: PollRefs }).__pollRefs;
  if (existing) {
    renderPoll(existing, getVote());
    return existing;
  }
  const refs = buildPollRefs(root);
  (root as HTMLElement & { __pollRefs?: PollRefs }).__pollRefs = refs;

  refs.buttonsWrap.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('.poll-btn');
    if (!btn) return;
    const choice = btn.dataset.choice;
    if (!isChoice(choice ?? null)) return;
    recordVote(choice as PollChoice);
    renderPoll(refs, getVote());
  });

  renderPoll(refs, getVote());
  return refs;
}
