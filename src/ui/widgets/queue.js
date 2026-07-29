import blessed from 'blessed';

/** Upcoming tracks. blessed clips overlong rows rather than wrapping them. */
export function createQueue(parent) {
  const box = blessed.box({
    parent,
    top: 9,
    left: 0,
    right: 0,
    height: 9,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
    label: ' up next ',
  });

  const list = blessed.box({ parent: box, top: 0, left: 1, right: 1, tags: true, content: '' });

  function update(queue, stage) {
    box.setLabel(` up next (${queue.length})${stage ? ` — ${stage}` : ''} `);
    if (!queue.length) {
      list.setContent('{gray-fg}building…{/}');
      return;
    }
    list.setContent(
      queue
        .slice(0, 6)
        .map((t) => {
          const tag = t.curated ? 'llm' : t.source ?? '?';
          const plays = t.userPlaycount ? `${t.userPlaycount}p` : 'new';
          return `{gray-fg}·{/} ${blessed.escape(t.artist)} {gray-fg}—{/} ${blessed.escape(t.name)}  {gray-fg}${tag} · ${plays}{/}`;
        })
        .join('\n'),
    );
  }

  return { box, update };
}
