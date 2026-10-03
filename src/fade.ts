/** Animated volume fade (sleep-timer fade-out, sleepFade.ts). RAF-driven so it tracks the wall clock, not
 *  setTimeout drift. Returns a cancel function. */
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
