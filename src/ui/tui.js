import blessed from 'blessed';
import { createNowPlaying } from './widgets/nowPlaying.js';
import { createQueue } from './widgets/queue.js';
import { createLog } from './widgets/log.js';
import { createFooter } from './widgets/footer.js';

/**
 * The player screen.
 *
 * This replaces a hand-rolled ANSI renderer that positioned text with raw
 * escape sequences and measured widths with `String.length` — which counts
 * colour codes as characters. Any coloured or overlong line therefore wrapped
 * where it should not have, and the frame smeared across the terminal.
 * blessed handles layout, clipping, resize and the alternate screen buffer.
 */
export function createTui({ title = 'autodj', mode, onKey, onSelectTrack }) {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title,
    autoPadding: true,
    // Needed for the clickable queue. Terminal text selection generally needs
    // the modifier key (option/shift) while this is active.
    mouse: true,
    // Never let blessed emit a bell; some terminals flash the whole window.
    warnings: false,
  });

  const header = blessed.text({
    parent: screen,
    top: 0,
    left: 1,
    tags: true,
    content: `{bold}{cyan-fg}autodj{/}  {magenta-fg}${mode}{/}`,
  });

  const body = blessed.box({ parent: screen, top: 1, left: 0, right: 0, bottom: 0 });

  const nowPlaying = createNowPlaying(body);
  const queue = createQueue(body, { onSelect: onSelectTrack });
  const log = createLog(body);
  const footer = createFooter(body);

  // blessed dispatches keys itself; there is no raw-mode bookkeeping to get
  // wrong, and Ctrl-C is registered like any other binding.
  const bind = (keys, name) => screen.key(keys, () => onKey(name));
  bind(['space'], 'pause');
  bind(['n'], 'skip');
  bind(['right'], 'advance');
  bind(['up'], 'voteUp');
  bind(['down'], 'voteDown');
  bind(['l'], 'love');
  bind(['b'], 'ban');
  bind(['r'], 'refill');
  bind(['+', '='], 'volumeUp');
  bind(['-', '_'], 'volumeDown');
  bind(['m'], 'mood');
  bind(['q', 'C-c', 'escape'], 'quit');

  function render(state) {
    nowPlaying.update(state);
    queue.update(state.queue, state.stage);
    log.update(state.messages);
    footer.update(state);
    screen.render();
  }

  /** Modal single-line input, used for the mood prompt. */
  function prompt(question) {
    return new Promise((resolve) => {
      const dialog = blessed.prompt({
        parent: screen,
        top: 'center',
        left: 'center',
        width: '70%',
        height: 8,
        border: { type: 'line' },
        style: { border: { fg: 'magenta' } },
        label: ' direction ',
        tags: true,
      });
      dialog.input(question, '', (err, value) => {
        dialog.destroy();
        screen.render();
        resolve(err ? null : (value || '').trim() || null);
      });
    });
  }

  function destroy() {
    screen.destroy();
  }

  return { screen, render, prompt, destroy };
}
