/**
 * Screen layout.
 *
 * Positions were previously hardcoded, which assumed a wide terminal: on a
 * tall narrow window the side-by-side panels overlapped and the footer's key
 * list ran off the edge. Everything is computed from the actual screen size
 * instead, and the panels stack once there isn't width for two columns.
 */

// Below this the analysis panel cannot sit beside the queue.
const TWO_COLUMN_MIN_WIDTH = 88;
const SIDE_PANEL_WIDTH = 30;
const COVER_WIDTH = 16;

export function computeLayout(width, height, { keyRows = 1 } = {}) {
  const twoColumn = width >= TWO_COLUMN_MIN_WIDTH;
  const footerHeight = keyRows + 2;

  // The card needs to be tall enough for the artwork it contains.
  const nowPlayingHeight = 11;
  const top = 1;

  const middleTop = top + nowPlayingHeight;
  // Whatever is left after the card and footer, shared by the middle panels
  // and the activity log.
  const remaining = Math.max(6, height - middleTop - footerHeight);

  if (twoColumn) {
    const middleHeight = Math.max(7, Math.min(11, Math.round(remaining * 0.45)));
    return {
      twoColumn,
      coverWidth: COVER_WIDTH,
      nowPlaying: { top, left: 0, right: 0, height: nowPlayingHeight },
      queue: { top: middleTop, left: 0, right: SIDE_PANEL_WIDTH, height: middleHeight },
      features: { top: middleTop, right: 0, width: SIDE_PANEL_WIDTH, height: middleHeight },
      log: { top: middleTop + middleHeight, left: 0, right: 0, bottom: footerHeight },
      footer: { bottom: 0, left: 0, right: 0, height: footerHeight },
    };
  }

  // Narrow: stack the panels and give the queue and log a share each.
  const queueHeight = Math.max(6, Math.round(remaining * 0.4));
  const featuresHeight = Math.max(6, Math.round(remaining * 0.3));
  return {
    twoColumn,
    coverWidth: COVER_WIDTH,
    nowPlaying: { top, left: 0, right: 0, height: nowPlayingHeight },
    queue: { top: middleTop, left: 0, right: 0, height: queueHeight },
    features: { top: middleTop + queueHeight, left: 0, right: 0, height: featuresHeight },
    log: { top: middleTop + queueHeight + featuresHeight, left: 0, right: 0, bottom: footerHeight },
    footer: { bottom: 0, left: 0, right: 0, height: footerHeight },
  };
}

/** Apply a rect to a blessed element, clearing whichever edge is unused. */
export function applyRect(element, rect) {
  element.top = rect.top;
  element.height = rect.height;

  if (rect.width !== undefined) {
    element.width = rect.width;
    element.left = undefined;
  } else {
    element.width = undefined;
  }
  if (rect.left !== undefined) element.left = rect.left;
  if (rect.right !== undefined) element.right = rect.right;
  if (rect.bottom !== undefined) {
    element.bottom = rect.bottom;
    element.height = undefined;
  }
}
