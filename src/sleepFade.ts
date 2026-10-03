import { fadeVolume } from './fade';

/** How long the sleep timer fades the volume down before it stops (#103). */
export const SLEEP_FADE_MS = 20_000;

export interface SleepFadeDeps {
  getVolume(): number;
  /** Raw player volume (0..1) — not persisted, no slider update. */
  setVolume(v: number): void;
  /** The actual sleep stop (a plain pause). */
  stop(): void;
}

/** Sleep-timer fade-out: ramps the volume to 0 over `durationMs`, then
 *  calls `stop()` and puts the volume back where it was, so the next play
 *  isn't silent. `cancel()` aborts a running fade (manual pause, station
 *  change, sleep timer changed) and restores the volume immediately.
 *  On iOS Safari audio.volume is read-only, so the fade is inaudible
 *  there; the stop is a separate timer, so it lands after `durationMs`
 *  even when the ramp can't run (rAF is paused in hidden tabs). */
export class SleepFade {
  private cancelRamp: (() => void) | undefined;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private restoreTo: number | undefined;

  constructor(
    private readonly deps: SleepFadeDeps,
    private readonly durationMs = SLEEP_FADE_MS,
  ) {}

  get active(): boolean {
    return this.restoreTo !== undefined;
  }

  start(): void {
    this.cancel();
    const from = this.deps.getVolume();
    this.restoreTo = from;
    this.cancelRamp = fadeVolume((v) => this.deps.setVolume(v), from, 0, this.durationMs);
    this.stopTimer = setTimeout(() => this.finish(), this.durationMs);
  }

  /** Abort a running fade and restore the pre-fade volume. No-op when idle. */
  cancel(): void {
    const restoreTo = this.clear();
    if (restoreTo !== undefined) this.deps.setVolume(restoreTo);
  }

  private finish(): void {
    const restoreTo = this.clear();
    this.deps.stop();
    if (restoreTo !== undefined) this.deps.setVolume(restoreTo);
  }

  private clear(): number | undefined {
    if (this.stopTimer !== undefined) clearTimeout(this.stopTimer);
    this.cancelRamp?.();
    const restoreTo = this.restoreTo;
    this.stopTimer = undefined;
    this.cancelRamp = undefined;
    this.restoreTo = undefined;
    return restoreTo;
  }
}
