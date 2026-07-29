import blessed from 'blessed';
import { formatBytes } from '../../util/resources.js';

const KEYS = [
  ['space', 'pause'], ['←/→', 'prev/next'], ['n', 'skip(-)'], ['↑/↓', 'vote'], ['u', 'undo'], ['l', 'love'],
  ['x', 'ban'], ['b', 'boost'], ['m', 'mood'], ['r', 'refill'],
  ['+/-', 'vol'], ['pgup/dn', 'vol±10'], ['[/]', 'log'], ['tab', 'pick'], ['⏎', 'play'], ['d', 'drop…'], ['t', 'theme'], ['q', 'quit'],
];

/**
 * Number of rows the key list needs at a given width.
 *
 * The layout has to know this before it can place anything, because the footer
 * grows upward: on a narrow terminal the keys wrap onto two or three rows
 * instead of running off the right edge.
 */
export function footerRows(width) {
  const plain = KEYS.map(([k, v]) => `${k} ${v}`).join('   ');
  return Math.max(1, Math.ceil((plain.length + 4) / Math.max(20, width - 2)));
}

const cpuColour = (percent) => {
  if (percent >= 80) return 'red';
  if (percent >= 35) return 'yellow';
  return 'gray';
};

export function createFooter(parent) {
  const box = blessed.box({
    parent,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
  });

  const help = blessed.box({ parent: box, top: 0, left: 1, right: 1, tags: true, content: '' });
  const meter = blessed.text({ parent: box, bottom: 0, right: 1, width: 30, tags: true, content: '' });

  /** Pack the key hints into as many rows as the width requires. */
  function layoutKeys(width, theme) {
    const available = Math.max(20, width - 2);
    const rows = [];
    let line = '';
    let plain = '';

    for (const [key, label] of KEYS) {
      const piece = `${key} ${label}`;
      if (plain.length && plain.length + piece.length + 3 > available) {
        rows.push(line);
        line = '';
        plain = '';
      }
      line += `${line ? '   ' : ''}{${theme.accent}-fg}${key}{/} {gray-fg}${label}{/}`;
      plain += `${plain ? '   ' : ''}${piece}`;
    }
    if (line) rows.push(line);
    return rows;
  }

  function update(state, theme) {
    box.style.border.fg = theme.border;
    help.setContent(layoutKeys(box.width ?? 80, theme).join('\n'));

    const r = state.resources;
    const counts = `{gray-fg}${state.stats.played}▸ ${state.stats.banned}⊘{/}`;
    meter.setContent(
      r
        ? `${counts}  {${cpuColour(r.cpu)}-fg}cpu ${r.cpu.toFixed(0)}%{/} {gray-fg}${formatBytes(r.rss)}{/}`
        : counts,
    );
  }

  return { box, update };
}
