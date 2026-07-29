import blessed from 'blessed';

/**
 * Upcoming tracks, clickable.
 *
 * A plain box could only display the queue; selecting an entry with the mouse
 * needs a real list widget. `keys: false` keeps the list from swallowing the
 * global shortcuts — it handles the mouse only, and the screen keeps the
 * keyboard.
 */
export function createQueue(parent, { onSelect }) {
  const box = blessed.box({
    parent,
    top: 9,
    left: 0,
    right: 0,
    height: 9,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
    label: ' up next ',
  });

  const list = blessed.list({
    parent: box,
    top: 0,
    left: 1,
    right: 1,
    bottom: 0,
    tags: true,
    mouse: true,
    keys: false,
    vi: false,
    interactive: true,
    style: {
      selected: { bg: 'blue', fg: 'white' },
      item: { hover: { bg: 'gray' } },
    },
    items: [],
  });

  list.on('select', (_item, index) => onSelect(index));

  function update(queue, stage) {
    box.setLabel(` up next (${queue.length}) — click to play${stage ? ` · ${stage}` : ''} `);

    const rows = queue.slice(0, 6).map((t) => {
      const tag = t.curated ? 'llm' : t.source ?? '?';
      const plays = t.userPlaycount ? `${t.userPlaycount}p` : 'new';
      return `${blessed.escape(t.artist)} {gray-fg}—{/} ${blessed.escape(t.name)}  {gray-fg}${tag} · ${plays}{/}`;
    });

    list.setItems(rows.length ? rows : ['{gray-fg}building…{/}']);
  }

  return { box, list, update };
}
