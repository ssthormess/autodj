import blessed from 'blessed';

const COLOUR = { error: 'red', warn: 'yellow', info: 'cyan', debug: 'gray' };

/**
 * Activity log: pinned to the newest line, scrollable back through history.
 *
 * The previous version wrote a slice of the messages into a plain box, which
 * could not scroll and clipped from whichever end blessed felt like — so as
 * the log grew, the newest lines were the ones that disappeared. A scrollable
 * widget that is explicitly scrolled to the bottom on each append fixes both:
 * the latest line is always visible, and the history is still reachable.
 */
export function createLog(parent, { onScrollAway } = {}) {
  const box = blessed.box({
    parent,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
    label: ' activity ',
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: false,
    scrollbar: { ch: '│', style: { fg: 'gray' } },
    padding: { left: 1, right: 1 },
  });

  // True while the user has scrolled back; auto-follow pauses until they
  // return to the bottom, so reading history is not yanked away by new lines.
  let following = true;
  let lastCount = 0;

  box.on('scroll', () => {
    const atBottom = box.getScrollPerc() >= 99;
    if (atBottom !== following) {
      following = atBottom;
      onScrollAway?.(!following);
    }
  });

  function update(messages) {
    if (messages.length !== lastCount) {
      lastCount = messages.length;
      box.setContent(
        messages
          .map(({ level, text }) => `{${COLOUR[level] ?? 'gray'}-fg}${blessed.escape(text)}{/}`)
          .join('\n'),
      );
      if (following) box.setScrollPerc(100);
    }
    box.setLabel(following ? ' activity ' : ' activity {yellow-fg}[scrolled back]{/} ');
  }

  const scrollBy = (lines) => {
    box.scroll(lines);
    following = box.getScrollPerc() >= 99;
  };

  const toBottom = () => {
    box.setScrollPerc(100);
    following = true;
  };

  return { box, update, scrollBy, toBottom };
}
