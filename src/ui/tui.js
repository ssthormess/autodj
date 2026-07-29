import blessed from 'blessed';
import { createNowPlaying } from './widgets/nowPlaying.js';
import { createQueue } from './widgets/queue.js';
import { createLog } from './widgets/log.js';
import { createFooter } from './widgets/footer.js';
import { createFeatures } from './widgets/features.js';
import { createVisualizer } from './widgets/visualizer.js';
import { createLyrics } from './widgets/lyrics.js';
import { computeLayout, applyRect } from './layout.js';
import { footerRows } from './widgets/footer.js';
import { resolveTheme, nextTheme } from './theme.js';

/**
 * The player screen.
 *
 * This replaces a hand-rolled ANSI renderer that positioned text with raw
 * escape sequences and measured widths with `String.length` — which counts
 * colour codes as characters. Any coloured or overlong line therefore wrapped
 * where it should not have, and the frame smeared across the terminal.
 * blessed handles layout, clipping, resize and the alternate screen buffer.
 */
export function createTui({
  title = 'autodj', mode, theme: themeName = 'midnight',
  onKey, onSelectTrack, onContextAction,
}) {
  let themeKey = themeName;
  let theme = resolveTheme(themeKey);
  // blessed parses the terminfo database on construction and writes a
  // "Error on xterm-256color.Setulc" line to stderr for capabilities it cannot
  // handle. It is harmless, but it lands in the middle of the display, so it
  // is swallowed for the duration of setup only.
  const realStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  let screen;
  try {
    screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title,
      autoPadding: true,
      // Needed for the clickable queue. Terminal text selection generally
      // needs the modifier key (option/shift) while this is active.
      mouse: true,
      // Never let blessed emit a bell; some terminals flash the whole window.
      warnings: false,
    });
  } finally {
    process.stderr.write = realStderrWrite;
  }

  const header = blessed.text({
    parent: screen, top: 0, left: 1, tags: true, content: '',
  });
  const setHeader = (boostOn) => {
    header.setContent(
      `{bold}{cyan-fg}autodj{/}  {magenta-fg}${mode}{/}` +
        (boostOn ? '  {yellow-fg}⚡boost{/}' : ''),
    );
  };
  setHeader(false);

  const body = blessed.box({ parent: screen, top: 1, left: 0, right: 0, bottom: 0 });

  const nowPlaying = createNowPlaying(body);
  const queue = createQueue(body, {
    onSelect: onSelectTrack,
    onContext: (index, at) => showContextMenu(index, at),
  });
  const features = createFeatures(body);
  const lyrics = createLyrics(body);
  const visualizer = createVisualizer(body, { columns: 24 });
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
  bind(['b'], 'boost');
  bind(['x'], 'ban');
  bind(['r'], 'refill');
  // Fine steps on +/-, coarse ones on page up/down: 1% at a time is right for
  // settling on a level, and useless for crossing the whole range.
  bind(['+', '='], 'volumeUp');
  bind(['-', '_'], 'volumeDown');
  bind(['pageup'], 'volumeUpCoarse');
  bind(['pagedown'], 'volumeDownCoarse');
  bind(['m'], 'mood');
  // Queue navigation, and the reject menu without needing the mouse.
  bind(['tab'], 'queueDown');
  bind(['S-tab'], 'queueUp');
  bind(['enter'], 'queuePlay');
  bind(['d'], 'queueMenu');
  bind(['t'], 'theme');
  bind(['['], 'logUp');
  bind([']'], 'logDown');
  bind(['q', 'C-c', 'escape'], 'quit');

  /**
   * Place every panel for the current terminal size. Called on start and on
   * every resize, so a window that changes shape re-flows instead of leaving
   * panels overlapping or running off the edge.
   */
  function relayout() {
    const rows = footerRows(screen.width);
    const l = computeLayout(screen.width, screen.height, { keyRows: rows });

    applyRect(nowPlaying.box, l.nowPlaying);
    applyRect(queue.box, l.queue);
    applyRect(features.box, l.features);
    // Hidden rather than squashed when the window is too short for it.
    if (l.features.hidden) features.box.hide();
    else features.box.show();
    applyRect(lyrics.box, l.lyrics);
    if (l.lyrics.hidden) lyrics.box.hide();
    else lyrics.box.show();
    applyRect(log.box, l.log);
    if (l.log.hidden) log.box.hide();
    else log.box.show();
    applyRect(footer.box, l.footer);

    // The meter lives on the now-playing card, under the badges. It goes
    // through applyRect like everything else: assigning width directly leaves
    // blessed computing NaN, which is what scrambled the display before.
    applyRect(visualizer.box, {
      top: l.nowPlaying.top + 8,
      left: 1,
      width: Math.max(8, Math.min(28, screen.width - 22)),
      height: 1,
    });

    for (const el of [nowPlaying.box, queue.box, features.box, lyrics.box, log.box, footer.box]) {
      el.style.border.fg = theme.border;
    }
  }

  screen.on('resize', () => {
    relayout();
    screen.render();
  });

  /** Cycle to the next theme; returns its name for the caller to report. */
  function cycleTheme() {
    themeKey = nextTheme(themeKey);
    theme = resolveTheme(themeKey);
    relayout();
    screen.render();
    return themeKey;
  }

  /**
   * Set the terminal window/tab title. blessed emits the OSC sequence for us;
   * iTerm2, Terminal.app and most others pick it up (unless the profile has
   * "terminal may set tab title" turned off).
   */
  function setTitle(text) {
    if (screen.title !== text) screen.title = text;
  }

  function render(state) {
    setHeader(state.boost);
    setTitle(
      state.track ? `${state.track.artist} - ${state.track.name}` : `autodj · ${mode}`,
    );
    nowPlaying.update(state);
    queue.update(state.queue, state.stage);
    features.update(state.track);
    lyrics.update(state.lyrics, state.position, theme);
    visualizer.update(state.levels, theme);
    log.update(state.messages);
    footer.update(state, theme);
    screen.render();
  }

  /**
   * Right-click menu for a queued track.
   *
   * The three actions differ sharply in consequence — dropping one track from
   * this queue, teaching the profile you dislike it, and refusing it forever —
   * so they are offered separately rather than bundled into a single click.
   */
  const CONTEXT_ACTIONS = [
    { label: 'Remove from queue', action: 'remove', hint: 'this set only, no opinion recorded' },
    { label: 'Downvote', action: 'downvote', hint: 'removes it and marks down the artist too' },
    { label: 'Ban', action: 'ban', hint: 'never queue this track again' },
  ];

  let contextMenu = null;

  function showContextMenu(index, at) {
    if (contextMenu) {
      contextMenu.destroy();
      contextMenu = null;
    }

    contextMenu = blessed.list({
      parent: screen,
      // Keep the menu on screen when the click lands near an edge.
      top: Math.max(0, Math.min(at.y, screen.height - 7)),
      left: Math.max(0, Math.min(at.x, screen.width - 40)),
      width: 38,
      height: 5,
      tags: true,
      mouse: true,
      keys: true,
      vi: false,
      border: { type: 'line' },
      style: {
        border: { fg: 'red' },
        selected: { bg: 'red', fg: 'white' },
        item: { hover: { bg: 'gray' } },
      },
      items: CONTEXT_ACTIONS.map((a) => ` ${a.label}  {gray-fg}${a.hint}{/}`),
    });

    const close = () => {
      contextMenu?.destroy();
      contextMenu = null;
      screen.render();
    };

    contextMenu.on('select', (_item, choice) => {
      const picked = CONTEXT_ACTIONS[choice];
      close();
      if (picked) onContextAction(index, picked.action);
    });
    contextMenu.key(['escape', 'q'], close);
    contextMenu.on('cancel', close);

    contextMenu.focus();
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

  relayout();

  return {
    screen, render, prompt, setTitle, destroy, cycleTheme, relayout,
    moveQueueSelection: (delta, length) => {
      const index = queue.moveSelection(delta, length);
      screen.render();
      return index;
    },
    selectedQueueIndex: () => queue.selectedIndex(),
    openContextMenu: (index) => showContextMenu(index, { x: 4, y: 8 }),
    scrollLog: (lines) => log.scrollBy(lines),
    logToBottom: () => log.toBottom(),
    themeName: () => themeKey,
  };
}
