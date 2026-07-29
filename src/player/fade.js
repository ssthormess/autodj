/**
 * Volume ramps.
 *
 * A fade must not overwrite the level you chose. The player therefore keeps
 * two numbers: the base volume, which is yours and is what gets persisted, and
 * a fade gain between 0 and 1 that is applied on top. Fading only ever moves
 * the gain, so the displayed percentage stays put and the level is restored
 * exactly when the ramp finishes.
 */
export function createFader({ apply, intervalMs = 50 }) {
  let timer = null;
  let gain = 1;

  const clear = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  /** Current multiplier, 0..1. */
  const current = () => gain;

  /** Jump without ramping (used when a fade is cancelled). */
  function set(value) {
    clear();
    gain = Math.max(0, Math.min(1, value));
    return apply(gain);
  }

  /**
   * Ramp to `target` over `seconds`. Resolves when the ramp completes; a new
   * ramp started meanwhile cancels this one, which resolves immediately rather
   * than leaving a caller waiting forever.
   */
  function to(target, seconds) {
    clear();
    const goal = Math.max(0, Math.min(1, target));
    const steps = Math.max(1, Math.round((seconds * 1000) / intervalMs));
    const start = gain;
    let step = 0;

    return new Promise((resolve) => {
      const mine = setInterval(() => {
        step += 1;
        const progress = Math.min(1, step / steps);
        // Ease along the perceptual curve rather than linearly: a linear ramp
        // in amplitude sounds like it lurches at the quiet end.
        gain = start + (goal - start) * progress ** 2;
        apply(gain);

        if (progress >= 1) {
          if (timer === mine) clear();
          gain = goal;
          apply(gain);
          resolve(gain);
        }
      }, intervalMs);
      timer = mine;
    });
  }

  return { to, set, current, clear };
}
