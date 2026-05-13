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
 * remembers the user's choice so the banner switches to a
 * "You voted: X" panel after voting (instead of disappearing) with a
 * link to live results in the Stats sheet. Trivially bypassable
 * (incognito / clear storage), which is fine — server-side dedup is
 * GoatCounter's job.
 */

import { getString, setString } from './storage';
import { track } from './telemetry';

export const POLL_KEY = 'rrradio.poll.platform.v1';

export type PollChoice = 'ios' | 'android' | 'dont-care';

export const POLL_CHOICE_LABELS: Record<PollChoice, string> = {
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
 *  the event (server-side dedup would discard the duplicate anyway). */
export function recordVote(choice: PollChoice): void {
  const prior = getVote();
  if (prior === choice) return;
  setString(POLL_KEY, choice);
  if (prior === null) track(`vote: ${choice}`);
}

export interface PollBannerOptions {
  onSeeResults?: () => void;
}

interface PollBannerRefs {
  banner: HTMLElement;
  prompt: HTMLElement;
  voted: HTMLElement;
  votedChoice: HTMLElement;
  options: HTMLElement;
  statsBtn: HTMLButtonElement;
}

function buildBannerSkeleton(): PollBannerRefs {
  const banner = document.createElement('section');
  banner.className = 'poll-banner';
  banner.setAttribute('aria-label', 'User poll: native app interest');

  const eyebrow = document.createElement('div');
  eyebrow.className = 'poll-banner__eyebrow';
  eyebrow.textContent = 'USER POLL';

  const prompt = document.createElement('div');
  prompt.className = 'poll-banner__prompt';

  const title = document.createElement('h2');
  title.className = 'poll-banner__title';
  title.textContent = 'ANYBODY WANT AN APP FOR THIS?';

  const subtitle = document.createElement('p');
  subtitle.className = 'poll-banner__subtitle';
  subtitle.textContent = 'One tap, anonymous — helps me decide whether to build native apps.';

  const options = document.createElement('div');
  options.className = 'poll-banner__options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', 'Native-app interest poll');
  for (const c of CHOICES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'poll-banner__btn';
    btn.dataset.choice = c;
    btn.textContent = POLL_CHOICE_LABELS[c];
    options.appendChild(btn);
  }

  prompt.append(title, subtitle, options);

  const voted = document.createElement('div');
  voted.className = 'poll-banner__voted';

  const votedLine = document.createElement('p');
  votedLine.className = 'poll-banner__voted-line';
  const votedPre = document.createElement('span');
  votedPre.textContent = 'You voted: ';
  const votedChoice = document.createElement('strong');
  votedChoice.className = 'poll-banner__voted-choice';
  votedLine.append(votedPre, votedChoice);

  const votedNote = document.createElement('p');
  votedNote.className = 'poll-banner__voted-note';
  votedNote.textContent = 'See live results in the Stats panel.';

  const statsBtn = document.createElement('button');
  statsBtn.type = 'button';
  statsBtn.className = 'poll-banner__stats-btn';
  statsBtn.textContent = 'See results in Stats →';

  voted.append(votedLine, votedNote, statsBtn);

  banner.append(eyebrow, prompt, voted);

  return { banner, prompt, voted, votedChoice, options, statsBtn };
}

function applyVotedState(refs: PollBannerRefs, vote: PollChoice): void {
  refs.banner.classList.add('poll-banner--voted');
  refs.votedChoice.textContent = POLL_CHOICE_LABELS[vote];
}

/** Build a fresh banner element for the top of the browse view.
 *  Always returns an element — pre-vote shows the choices, post-vote
 *  shows the user's vote + a link into the Stats sheet. */
export function buildPollBanner(opts: PollBannerOptions = {}): HTMLElement {
  const refs = buildBannerSkeleton();

  const initial = getVote();
  if (initial !== null) applyVotedState(refs, initial);

  refs.options.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('.poll-banner__btn');
    if (!btn) return;
    const choice = btn.dataset.choice;
    if (!isChoice(choice ?? null)) return;
    recordVote(choice as PollChoice);
    applyVotedState(refs, choice as PollChoice);
  });

  refs.statsBtn.addEventListener('click', () => {
    opts.onSeeResults?.();
  });

  return refs.banner;
}
