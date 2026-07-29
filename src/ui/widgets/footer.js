import blessed from 'blessed';

const KEYS = [
  ['space', 'pause'], ['→', 'next'], ['n', 'skip(-)'], ['↑/↓', 'vote'], ['l', 'love'],
  ['b', 'ban'], ['m', 'mood'], ['r', 'refill'], ['+/-', 'vol'], ['q', 'quit'],
];

export function createFooter(parent) {
  const box = blessed.box({
    parent,
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
  });

  const help = blessed.text({
    parent: box,
    top: 0,
    left: 1,
    right: 1,
    tags: true,
    content: KEYS.map(([k, v]) => `{cyan-fg}${k}{/} {gray-fg}${v}{/}`).join('  '),
  });

  const status = blessed.text({ parent: box, top: 0, right: 1, width: 30, tags: true, content: '' });

  const update = (state) => {
    status.setContent(
      `{gray-fg}${state.stats.played} played · ${state.stats.banned} banned{/}`,
    );
  };

  return { box, help, update };
}
