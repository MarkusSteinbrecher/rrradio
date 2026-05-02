import type { WakeTo } from './types';

/**
 * Wake-to-radio scheduler.
 *
 * Web alarms are constrained — a backgrounded silent tab gets suspended
 * (especially on iOS Safari) and a setTimeout for "fire at 7am tomorrow"
 * won't fire on time. So we belt-and-brace:
 *  - Schedule a single setTimeout for the precise fire moment.
 *  - Plus a 30-second heartbeat that re-checks the wall clock against
 *    the target so a missed setTimeout (or a tab that just woke up)
 *    still fires within ~30s.
 *  - Plus a visibilitychange handler that re-checks immediately when
 *    the tab regains focus.
 *
 * The page must be open for any of this to work — we tell the user as
 * much in the UI. There is no service-worker fallback in v1.
 */

export type WakeFireHandler = (wake: WakeTo) => void;

const HEARTBEAT_MS = 30_000;

/** Compute the next fire time (epoch ms) for a wake setting.
 *  - If `time` (HH:MM) is later today than `armedAt`, fire today.
 *  - Otherwise fire tomorrow.
 *  Returns NaN if `time` doesn't parse. */
export function nextFireTime(wake: WakeTo, now = Date.now()): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(wake.time);
  if (!m) return NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN;
  const armedAt = wake.armedAt || now;
  const target = new Date(armedAt);
  target.setHours(hh, mm, 0, 0);
  // If the configured time is at-or-before the moment we armed, the user
  // means "tomorrow morning" — bump by one day.
  if (target.getTime() <= armedAt) target.setDate(target.getDate() + 1);
  return target.getTime();
}

/** Window during which a missed wake is still considered "fresh enough"
 *  to fire on app boot. Past this, the wake is treated as stale and
 *  silently cleared.
 *
 *  60 seconds catches the realistic case (laptop closed momentarily
 *  past the wake time, reopened seconds later → fire it) without
 *  surprising the user with a wake from hours or days ago. */
export const STALE_WAKE_GRACE_MS = 60_000;

/** Decide what to do with a stored wake when the app boots.
 *  - `'invalid'` — the stored time doesn't parse; clear.
 *  - `'fire'`    — fire time is in the future, or in the past but
 *                  within {@link STALE_WAKE_GRACE_MS}. Arm normally.
 *  - `'stale'`   — fire time is past the grace window. Clear without
 *                  firing. */
export function classifyStoredWake(
  wake: WakeTo,
  now = Date.now(),
): 'invalid' | 'fire' | 'stale' {
  const fire = nextFireTime(wake, now);
  if (!Number.isFinite(fire)) return 'invalid';
  if (fire - now < -STALE_WAKE_GRACE_MS) return 'stale';
  return 'fire';
}

/** Human-readable countdown like "in 8h 12m" or "in 4m" or "now".
 *  Used by the topbar pill while armed. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return 'soon';
  if (totalMin < 60) return `in ${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

export class WakeScheduler {
  private wake: WakeTo | null = null;
  private timer: number | undefined;
  private heartbeat: number | undefined;
  private wakeLock: WakeLockSentinel | null = null;
  private fired = false;
  private onFire: WakeFireHandler | null = null;
  private onTickHandler: (() => void) | null = null;

  /** Start scheduling for `wake`. Replaces any existing schedule. */
  arm(wake: WakeTo, onFire: WakeFireHandler): void {
    this.disarm();
    this.wake = wake;
    this.onFire = onFire;
    this.fired = false;
    this.scheduleNextCheck();
    this.heartbeat = window.setInterval(() => this.checkFire(), HEARTBEAT_MS);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    void this.acquireWakeLock();
  }

  /** Cancel any pending fire and release resources. */
  disarm(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    if (this.heartbeat !== undefined) window.clearInterval(this.heartbeat);
    this.timer = undefined;
    this.heartbeat = undefined;
    this.wake = null;
    this.fired = false;
    this.onFire = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    void this.releaseWakeLock();
    this.notifyTick();
  }

  /** Subscribe to "something changed, re-render the pill" events. The
   *  scheduler doesn't render anything itself — it only computes time. */
  onTick(handler: () => void): void {
    this.onTickHandler = handler;
  }

  current(): WakeTo | null {
    return this.wake;
  }

  /** ms until fire, or NaN if not armed. */
  remaining(): number {
    if (!this.wake) return NaN;
    return nextFireTime(this.wake) - Date.now();
  }

  private scheduleNextCheck(): void {
    if (!this.wake) return;
    const remain = this.remaining();
    if (!Number.isFinite(remain)) return;
    // Clamp setTimeout to a max of 60s so a long sleep can't drift more
    // than a minute past the target if the tab gets suspended.
    const wait = Math.max(0, Math.min(remain, 60_000));
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.checkFire();
      // Re-arm the next tick if we haven't fired (still waiting).
      if (this.wake && !this.fired) this.scheduleNextCheck();
    }, wait);
  }

  private checkFire(): void {
    if (!this.wake || this.fired) return;
    const remain = this.remaining();
    if (Number.isNaN(remain)) return;
    if (remain <= 0) {
      this.fired = true;
      const wake = this.wake;
      const handler = this.onFire;
      // Clear the schedule before firing so a re-entrant arm() inside
      // the handler (e.g. after the user immediately arms a new wake)
      // doesn't get clobbered.
      if (this.timer !== undefined) window.clearTimeout(this.timer);
      if (this.heartbeat !== undefined) window.clearInterval(this.heartbeat);
      this.timer = undefined;
      this.heartbeat = undefined;
      this.wake = null;
      this.onFire = null;
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      void this.releaseWakeLock();
      handler?.(wake);
    }
    this.notifyTick();
  }

  private notifyTick(): void {
    this.onTickHandler?.();
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') this.checkFire();
  };

  private async acquireWakeLock(): Promise<void> {
    // Wake Lock keeps the screen from sleeping while armed. Best-effort —
    // the API is unavailable in some browsers (e.g. older Safari) and
    // requires the page to be visible at the moment of request.
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await (navigator.wakeLock as { request: (t: 'screen') => Promise<WakeLockSentinel> }).request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      // User denied, or document not visible — silently move on. We
      // still have setTimeout + heartbeat as the actual scheduler.
    }
  }

  private async releaseWakeLock(): Promise<void> {
    if (!this.wakeLock) return;
    try {
      await this.wakeLock.release();
    } catch {
      // ignore
    }
    this.wakeLock = null;
  }
}

interface WakeLockSentinel extends EventTarget {
  release(): Promise<void>;
}

/** Animated volume fade — used at fire time so the user is woken
 *  gradually instead of by a sudden full-volume blast. Returns a
 *  cancel function. */
export function fadeVolume(
  setVolume: (v: number) => void,
  from: number,
  to: number,
  durationMs: number,
): () => void {
  const start = performance.now();
  let raf = 0;
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / durationMs);
    setVolume(from + (to - from) * t);
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    if (raf) cancelAnimationFrame(raf);
  };
}
