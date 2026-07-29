/**
 * Volume scale conversion.
 *
 * mpv's `volume` property is cubic: the gain it applies is `(volume/100)^3`.
 * Measured against a 440 Hz tone rendered to file, relative to volume=100:
 *
 *     volume  50  ->  -18 dB   (0.5^3  = 0.125)
 *     volume  20  ->  -42 dB   (0.2^3  = 0.008)
 *     volume  10  ->  silence
 *     volume   5  ->  silence
 *
 * So a UI reading of 10% was delivering roughly a thousandth of full
 * amplitude, which is inaudible — exactly the range wanted for background
 * listening. Passing the displayed percentage straight through is therefore
 * wrong, and the number on screen bears no relation to what is heard.
 *
 * The displayed percentage is treated as a fraction of full amplitude and
 * converted with the inverse cube, so 5% really is 5% of full scale (about
 * -26 dB: quiet, but plainly audible), and 100% remains unity gain with no
 * reduction or amplification.
 */

/** Displayed percentage (0..100) to the value mpv wants. */
export function toMpvVolume(displayed, max = 100) {
  const clamped = Math.max(0, Math.min(max, displayed));
  if (clamped <= 0) return 0;
  const amplitude = clamped / 100;
  return Math.min(100, Math.cbrt(amplitude) * 100);
}

/** Inverse, for reading mpv's own value back into the display scale. */
export function fromMpvVolume(mpvVolume) {
  const clamped = Math.max(0, Math.min(100, mpvVolume));
  return (clamped / 100) ** 3 * 100;
}

/** Approximate dB relative to full scale, for display or diagnostics. */
export const toDecibels = (displayed) =>
  displayed <= 0 ? -Infinity : 20 * Math.log10(displayed / 100);
