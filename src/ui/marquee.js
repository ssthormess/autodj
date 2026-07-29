/**
 * Horizontal scrolling for text that doesn't fit its column.
 *
 * A terminal can't scroll by half a character, so "smooth" here means an even
 * cadence rather than sub-cell motion: the text slides one column at a time,
 * pauses at each end long enough to read, then travels back. Ping-pong rather
 * than a wrapping loop, because a wrap splits the title across the join and is
 * briefly unreadable exactly when you are trying to read it.
 *
 * Pure and stateless — the caller owns the frame counter, so every marquee on
 * screen stays in step instead of drifting apart.
 */

/** Frames spent stationary at each end, at the caller's frame rate. */
const DWELL = 14;

/** Frames per column of travel. Two is legible; one reads as a twitch. */
const FRAMES_PER_STEP = 2;

export function marquee(text, width, frame, { dwell = DWELL, framesPerStep = FRAMES_PER_STEP } = {}) {
  const value = String(text ?? '');
  if (!Number.isFinite(width) || width <= 0) return '';

  // Code points, not UTF-16 units, or an accented artist name loses its tail.
  const characters = [...value];
  if (characters.length <= width) return value;

  const travel = characters.length - width;
  const step = Math.floor(frame / framesPerStep);
  const period = travel * 2 + dwell * 2;
  const phase = ((step % period) + period) % period;

  let offset;
  if (phase < dwell) offset = 0;
  else if (phase < dwell + travel) offset = phase - dwell;
  else if (phase < dwell * 2 + travel) offset = travel;
  else offset = travel - (phase - dwell * 2 - travel);

  return characters.slice(offset, offset + width).join('');
}

/** Whether `text` would scroll at this width — useful for a hint marker. */
export const overflows = (text, width) => [...String(text ?? '')].length > width;
