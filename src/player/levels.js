/**
 * Real audio levels, read from mpv.
 *
 * mpv can attach an ffmpeg filter and expose its metadata over IPC, so the
 * meter reflects the actual signal rather than being animated from the clock.
 * The `ebur128` filter publishes momentary loudness in LUFS and true peak per
 * channel, which is what a level meter needs.
 *
 * This is a level meter, not a spectrum analyser: mpv exposes no FFT, and
 * running a second decoder purely to compute one would double the bandwidth
 * for every track. Bars are per-channel peaks, not frequency bands.
 */
const FILTER_LABEL = 'autodjvis';

export const VIS_FILTER = `@${FILTER_LABEL}:lavfi=[ebur128=metadata=1:peak=true]`;

/** LUFS is roughly -70 (silence) to 0 (full). Map onto 0..1 for display. */
const loudnessToUnit = (lufs) => {
  if (!Number.isFinite(lufs)) return 0;
  const floor = -50;
  return Math.max(0, Math.min(1, (lufs - floor) / (0 - floor)));
};

export function createLevelReader(ipcGet, { smoothing = 0.35 } = {}) {
  let left = 0;
  let right = 0;
  let loudness = 0;
  let available = true;

  // Peaks jump around far faster than the eye can follow; a decay keeps the
  // meter readable while still dropping quickly on a real cut.
  const smooth = (previous, next) =>
    next > previous ? next : previous * (1 - smoothing) + next * smoothing;

  async function sample() {
    if (!available) return { left, right, loudness, available };
    try {
      const data = await ipcGet(`af-metadata/${FILTER_LABEL}`);
      if (!data) return { left, right, loudness, available };

      const peakL = Number(data['lavfi.r128.true_peaks_ch0']);
      const peakR = Number(data['lavfi.r128.true_peaks_ch1']);
      const m = Number(data['lavfi.r128.M']);

      left = smooth(left, Math.max(0, Math.min(1, peakL || 0)));
      right = smooth(right, Math.max(0, Math.min(1, peakR || 0)));
      loudness = smooth(loudness, loudnessToUnit(m));
    } catch {
      // The filter is absent (older mpv, or disabled) — stop asking.
      available = false;
    }
    return { left, right, loudness, available };
  }

  const reset = () => {
    left = 0;
    right = 0;
    loudness = 0;
  };

  return { sample, reset, isAvailable: () => available };
}
