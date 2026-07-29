import blessed from 'blessed';

const COLOUR = { error: 'red', warn: 'yellow', info: 'cyan', debug: 'gray' };

/**
 * Captured log output, rendered inside the UI.
 *
 * Background lanes emit warnings at arbitrary moments. Letting those reach
 * stdout directly is what made the display appear to repeat itself: the write
 * interleaved with the repaint and scrolled the frame away.
 */
export function createLog(parent) {
  const box = blessed.box({
    parent,
    top: 20,
    left: 0,
    right: 0,
    bottom: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
    label: ' activity ',
    scrollable: true,
    alwaysScroll: true,
  });

  const content = blessed.box({ parent: box, top: 0, left: 1, right: 1, tags: true, content: '' });

  function update(messages) {
    const height = Math.max(1, box.height - 2);
    content.setContent(
      messages
        .slice(-height)
        .map(({ level, text }) => `{${COLOUR[level] ?? 'gray'}-fg}${blessed.escape(text)}{/}`)
        .join('\n'),
    );
  }

  return { box, update };
}
