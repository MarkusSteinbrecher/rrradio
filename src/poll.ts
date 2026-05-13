/**
 * Platform-interest poll — a highlighted banner above the station list:
 * "USER POLL — ANYBODY WANT AN APP FOR THIS?" with three choices
 * ("I want an iOS app", "I want an Android app", "I don't care").
 *
 * Vote storage: GoatCounter event (`vote: ios` / `vote: android` /
 * `vote: dont-care`) via track(). GoatCounter dedupes by an 8h
 * session hash on the server side, so we get directional signal
 * without storing anything that could identify a voter.
 *
 * Local state: a single localStorage flag (`rrradio.poll.platform.v1`)
 * remembers the user's choice so the banner hides after voting (and
 * doesn't reappear). Trivially bypassable (incognito / clear storage),
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

/** Build a fresh banner element for the top of the browse view.
 *  Returns `null` once the user has voted (the caller skips append).
 *  A new DOM is built per call — renderContent() wipes #content on
 *  every view change, so there's nothing to reuse. */
export function buildPollBanner(): HTMLElement | null {
  if (getVote() !== null) return null;

  const banner = document.createElement('section');
  banner.className = 'poll-banner';
  banner.setAttribute('aria-label', 'User poll: native app interest');

  const eyebrow = document.createElement('div');
  eyebrow.className = 'poll-banner__eyebrow';
  eyebrow.textContent = 'USER POLL';

  const title = document.createElement('h2');
  title.className = 'poll-banner__title';
  title.textContent = 'ANYBODY WANT AN APP FOR THIS?';

  const subtitle = document.createElement('p');
  subtitle.className = 'poll-banner__subtitle';
  subtitle.textContent = 'One tap, anonymous — helps me decide whether to build native apps.';

  const buttonsWrap = document.createElement('div');
  buttonsWrap.className = 'poll-banner__options';
  buttonsWrap.setAttribute('role', 'group');
  buttonsWrap.setAttribute('aria-label', 'Native-app interest poll');

  for (const c of CHOICES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'poll-banner__btn';
    btn.dataset.choice = c;
    btn.textContent = CHOICE_LABELS[c];
    buttonsWrap.appendChild(btn);
  }

  const thanks = document.createElement('div');
  thanks.className = 'poll-banner__thanks';
  thanks.hidden = true;
  thanks.textContent = 'Thanks for voting — your input is recorded.';

  banner.append(eyebrow, title, subtitle, buttonsWrap, thanks);

  buttonsWrap.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('.poll-banner__btn');
    if (!btn) return;
    const choice = btn.dataset.choice;
    if (!isChoice(choice ?? null)) return;
    recordVote(choice as PollChoice);
    buttonsWrap.hidden = true;
    subtitle.hidden = true;
    thanks.hidden = false;
    setTimeout(() => {
      banner.classList.add('is-leaving');
      setTimeout(() => banner.remove(), 600);
    }, 1400);
  });

  return banner;
}
