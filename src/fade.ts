/** Animated linear volume fade from `from` to `to` over `durationMs`
 *  (rAF-driven, so it tracks the wall clock). Used by the sleep-timer
 *  fade-out (sleepFade.ts). Returns a cancel function. */
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
