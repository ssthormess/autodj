import blessed from 'blessed';
import { formatBytes } from '../../util/resources.js';

const KEYS = [
  ['space', 'pause'], ['→', 'next'], ['n', 'skip(-)'], ['↑/↓', 'vote'], ['l', 'love'],
  ['x', 'ban'], ['b', 'boost'], ['m', 'mood'], ['r', 'refill'], ['+/-', 'vol 1%'], ['pgup/dn', '10%'], ['q', 'quit'],
];

/** Colour the CPU figure once it stops being negligible. */
const cpuColour = (percent) => {
  if (percent >= 80) return 'red';
  if (percent >= 35) return 'yellow';
  return 'gray';
};

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

  // Leave room on the right for the meter rather than letting the two overlap.
  const help = blessed.text({
    parent: box,
    top: 0,
    left: 1,
    right: 34,
    tags: true,
    content: KEYS.map(([k, v]) => `{cyan-fg}${k}{/} {gray-fg}${v}{/}`).join('  '),
  });

  const meter = blessed.text({ parent: box, top: 0, right: 1, width: 32, tags: true, content: '' });

  function update(state) {
    const r = state.resources;
    const counts = `{gray-fg}${state.stats.played}▸ ${state.stats.banned}⊘{/}`;

    if (!r) {
      meter.setContent(counts);
      return;
    }

    // node plus mpv. mpv does the decoding, so it usually dominates both.
    meter.setContent(
      `${counts}  ` +
        `{${cpuColour(r.cpu)}-fg}cpu ${r.cpu.toFixed(0)}%{/} ` +
        `{gray-fg}ram ${formatBytes(r.rss)}{/}`,
    );
  }

  return { box, help, update };
}
