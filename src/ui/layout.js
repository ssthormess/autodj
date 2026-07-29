/**
 * Screen layout.
 *
 * Positions used to be baked into each widget, which assumed a wide, short
 * terminal. In a tall window the activity log swallowed all the spare rows
 * while the queue stayed tiny, and the footer's key list ran past its own
 * border. Everything is computed from the real screen size instead.
 */

// Below this there isn't room for the queue and analysis side by side.
const TWO_COLUMN_MIN_WIDTH = 86;
const SIDE_PANEL_WIDTH = 30;

const NOW_PLAYING_HEIGHT = 11;
const HEADER_HEIGHT = 1;

// The log is useful, but it is a log: it should not inherit every spare row
// just because the window is tall. The queue gets the slack instead.
const LOG_MIN = 7;
const LOG_MAX = 14;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function computeLayout(width, height, { keyRows = 1 } = {}) {
  const twoColumn = width >= TWO_COLUMN_MIN_WIDTH;
  const footerHeight = keyRows + 2;
  const top = HEADER_HEIGHT;

  // The card is the one panel with a natural height, but on a very short
  // window even it has to give ground — otherwise it alone can be taller than
  // the terminal and everything below is pushed off the bottom.
  const cardHeight = clamp(height - top - footerHeight - 4, 5, NOW_PLAYING_HEIGHT);
  const middleTop = top + cardHeight;

  // Everything below is carved out of what is genuinely left. Flooring the
  // panel heights independently of this is how the layout came to overflow a
  // short terminal: each panel was individually reasonable and the total was
  // taller than the screen.
  const spare = height - middleTop - footerHeight;

  // On a very short window the log gives up its minimum before the queue does.
  const logHeight = spare < 8
    ? Math.max(0, Math.min(3, spare - 3))
    : clamp(Math.round(spare * 0.3), LOG_MIN, LOG_MAX);
  const middleHeight = Math.max(3, spare - logHeight);
  const logTop = middleTop + middleHeight;

  const base = {
    twoColumn,
    nowPlaying: { top, left: 0, right: 0, height: cardHeight },
    log: logHeight >= 3
      ? { top: logTop, left: 0, right: 0, height: logHeight }
      : { top: logTop, left: 0, right: 0, height: 1, hidden: true },
    footer: { bottom: 0, left: 0, right: 0, height: footerHeight },
  };

  if (twoColumn) {
    return {
      ...base,
      queue: { top: middleTop, left: 0, right: SIDE_PANEL_WIDTH, height: middleHeight },
      features: { top: middleTop, right: 0, width: SIDE_PANEL_WIDTH, height: middleHeight },
    };
  }

  // Stacked. Both panels are carved out of `middleHeight` rather than sized
  // independently — giving each a minimum without checking they fit together
  // is what pushed the analysis panel off the bottom of a short window.
  // Below a usable size the analysis panel steps aside entirely rather than
  // being drawn as a squashed, useless border.
  const roomForBoth = middleHeight >= 11;
  const featuresHeight = roomForBoth
    ? clamp(Math.round(middleHeight * 0.4), 5, 11)
    : 0;
  const queueHeight = middleHeight - featuresHeight;

  return {
    ...base,
    queue: { top: middleTop, left: 0, right: 0, height: queueHeight },
    features: roomForBoth
      ? { top: middleTop + queueHeight, left: 0, right: 0, height: featuresHeight }
      : { top: middleTop, left: 0, right: 0, height: 1, hidden: true },
  };
}

/**
 * Apply a rect to a blessed element.
 *
 * Writes into `element.position` rather than assigning `element.top` and
 * friends. The element-level properties are computed accessors, and clearing
 * one by assigning `undefined` leaves blessed deriving geometry from a missing
 * value — which is how the previous attempt produced a scrambled screen. The
 * position object is the thing blessed actually reads at render time, so it is
 * rebuilt wholesale and no stale edge survives.
 */
export function applyRect(element, rect) {
  const position = element.position;
  for (const key of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
    delete position[key];
  }
  Object.assign(position, rect);
  // Cached coordinates must be dropped or blessed keeps drawing the old box.
  element.clearPos?.();
}
