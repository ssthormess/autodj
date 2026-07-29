import blessed from 'blessed';

/**
 * Upcoming tracks, clickable.
 *
 * A plain box could only display the queue; selecting an entry with the mouse
 * needs a real list widget. `keys: false` keeps the list from swallowing the
 * global shortcuts — it handles the mouse only, and the screen keeps the
 * keyboard.
 */
export function createQueue(parent, { onSelect, onContext }) {
  const box = blessed.box({
    parent,
    top: 11,
    left: 0,
    right: 30,
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

  /**
   * Right-click opens the reject menu for the row under the cursor.
   *
   * blessed reports a raw mouse event with absolute screen coordinates, so the
   * row has to be derived from the list's own top edge plus its scroll offset;
   * there is no built-in "which item was right-clicked".
   */
  list.on('mouse', (data) => {
    if (data.action !== 'mousedown' || data.button !== 'right') return;
    const row = data.y - list.atop + (list.childBase ?? 0);
    if (row < 0 || row >= list.items.length) return;
    onContext(row, { x: data.x, y: data.y });
  });

  function update(queue, stage) {
    box.setLabel(` up next (${queue.length}) — click to play${stage ? ` · ${stage}` : ''} `);

    // Show as many as the panel can hold rather than a fixed six. The count
    // in the label is the real queue length, so a hardcoded slice made the
    // header and the list disagree — and wasted every row of a tall window.
    const visible = Math.max(1, (list.height ?? 6) - (list.border ? 2 : 0));

    const rows = queue.slice(0, visible).map((t) => {
      const tag = t.curated ? 'llm' : t.source ?? '?';
      const plays = t.userPlaycount ? `${t.userPlaycount}p` : 'new';
      return `${blessed.escape(t.artist)} {gray-fg}—{/} ${blessed.escape(t.name)}  {gray-fg}${tag} · ${plays}{/}`;
    });

    list.setItems(rows.length ? rows : ['{gray-fg}building…{/}']);
  }

  /**
   * Keyboard access to the same actions the mouse offers.
   *
   * iTerm2 answers a right-click with its own context menu and never forwards
   * the event, so a mouse-only path is unreachable there however correct the
   * handler is. Moving a highlight with the keyboard and acting on it works
   * in every terminal.
   */
  const moveSelection = (delta, length) => {
    if (!length) return 0;
    const next = Math.max(0, Math.min(length - 1, (list.selected ?? 0) + delta));
    list.select(next);
    return next;
  };

  const selectedIndex = () => list.selected ?? 0;

  return { box, list, update, moveSelection, selectedIndex };
}
