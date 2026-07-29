import blessed from 'blessed';
import { time } from '../ansi.js';
import { plural } from '../../util/format.js';
import { marquee, overflows } from '../marquee.js';

/**
 * Now-playing panel: track, artist, album, seek bar, volume, and provenance.
 *
 * blessed owns the geometry. Nothing here writes cursor escapes or measures
 * string widths by hand, which is what made the previous hand-rolled renderer
 * scatter text across the terminal whenever a line exceeded the width or a
 * colour code threw the length calculation off.
 *
 * Text that doesn't fit its column scrolls rather than being cut off, so a long
 * title is readable without resizing the window.
 */

/**
 * Row positions for the interior height available.
 *
 * The full-height card gives the track its own breathing room — a blank row
 * above it, then track, artist and album on separate lines. As the window
 * shrinks, padding goes first, then the album, rather than letting rows fall
 * off the bottom edge.
 */
function rowsFor(interior) {
  if (interior >= 9) return { title: 1, artist: 2, album: 3, seek: 5, visualizer: 6, volume: 7, badges: 8 };
  if (interior >= 7) return { title: 0, artist: 1, album: 2, seek: 3, visualizer: 4, volume: 5, badges: 6 };
  if (interior >= 5) return { title: 0, artist: 1, album: null, seek: 2, visualizer: null, volume: 3, badges: 4 };
  return { title: 0, artist: 1, album: null, seek: null, visualizer: null, volume: null, badges: null };
}

export function createNowPlaying(parent) {
  const box = blessed.box({
    parent,
    top: 0,
    left: 0,
    right: 0,
    height: 11,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' } },
    label: ' now playing ',
  });

  // Artwork fills the full interior height at the right edge, flush to the
  // border on three sides. Half-block cells are two pixels tall and one wide,
  // so twice as many columns as rows keeps the image square.
  const cover = blessed.box({ parent: box, top: 0, right: 0, width: 18, height: 9, tags: true, content: '' });

  const title = blessed.text({ parent: box, top: 1, left: 1, tags: true, content: '' });
  const artist = blessed.text({ parent: box, top: 2, left: 1, tags: true, content: '' });
  const album = blessed.text({ parent: box, top: 3, left: 1, tags: true, content: '' });

  const seek = blessed.progressbar({
    parent: box, top: 5, left: 1, height: 1, filled: 0, ch: '━',
    style: { bar: { fg: 'green' }, fg: 'black' },
  });
  const clock = blessed.text({ parent: box, top: 5, width: 11, tags: true, content: '' });

  const volumeLabel = blessed.text({ parent: box, top: 7, left: 1, width: 5, tags: true, content: '{gray-fg}vol{/}' });
  const volumeBar = blessed.progressbar({
    parent: box, top: 7, left: 6, width: 20, height: 1, filled: 0, ch: '▇',
    style: { bar: { fg: 'yellow' }, fg: 'black' },
  });
  const volumeValue = blessed.text({ parent: box, top: 7, left: 27, width: 12, tags: true, content: '' });

  const badges = blessed.text({ parent: box, top: 8, left: 1, tags: true, content: '' });

  /** Interior height of the bordered box, whatever the layout gave us. */
  const interior = () => Math.max(1, (box.height ?? 11) - 2);

  /** Cover geometry for the current card height. */
  const coverSize = () => {
    const rows = interior();
    return { rows, columns: rows * 2 };
  };

  /**
   * Re-place everything for the current card size.
   *
   * Called on every relayout, because both the artwork's size and the width
   * left for text depend on how tall the card ended up.
   */
  function layout() {
    const { rows, columns } = coverSize();
    cover.position.width = columns;
    cover.position.height = rows;
    cover.clearPos?.();

    const gutter = columns + 2;
    const at = rowsFor(rows);

    for (const [element, row] of [[title, at.title], [artist, at.artist], [album, at.album], [badges, at.badges]]) {
      if (row === null) {
        element.hide();
        continue;
      }
      element.show();
      element.position.top = row;
      element.position.right = gutter;
      element.clearPos?.();
    }

    for (const [element, row] of [[seek, at.seek], [clock, at.seek]]) {
      if (row === null) {
        element.hide();
        continue;
      }
      element.show();
      element.position.top = row;
      element.clearPos?.();
    }
    seek.position.right = gutter + 11;
    clock.position.right = gutter;
    seek.clearPos?.();
    clock.clearPos?.();

    for (const [element, row] of [[volumeLabel, at.volume], [volumeBar, at.volume], [volumeValue, at.volume]]) {
      if (row === null) {
        element.hide();
        continue;
      }
      element.show();
      element.position.top = row;
      element.clearPos?.();
    }
  }

  // What the text lines should say, before any scrolling is applied. Kept so
  // the marquee can repaint between state updates without the caller having to
  // push the whole state again on every animation frame.
  let lines = { title: '', artist: '', album: '' };
  let frame = 0;

  /**
   * Paint a line, scrolling it if it is wider than its column.
   *
   * The scroll happens on the raw text and the colour tags go on afterwards —
   * slicing a string that already contains tags would cut one in half.
   */
  function paintLine(element, text, wrap) {
    const width = Math.max(1, (element.width ?? 1));
    if (!text) return element.setContent('');
    const visible = marquee(text, width, frame);
    return element.setContent(wrap(blessed.escape(visible), overflows(text, width)));
  }

  function paintText() {
    paintLine(title, lines.title, (t) => `{bold}${t}{/bold}`);
    paintLine(artist, lines.artist, (t) => `{cyan-fg}${t}{/}`);
    paintLine(album, lines.album, (t) => `{gray-fg}${t}{/}`);
  }

  /** Advance the scroll without needing fresh player state. */
  function tick(nextFrame) {
    frame = nextFrame;
    paintText();
  }

  function update(state) {
    const { track, position, duration, paused, volume, scrobbled, stage } = state;

    cover.setContent(state.cover ?? '');

    if (!track) {
      lines = { title: `◌ ${stage ?? 'starting…'}`, artist: 'the first set can take a moment', album: '' };
      seek.setProgress(0);
      clock.setContent('');
      badges.setContent('');
    } else {
      lines = { title: track.name, artist: track.artist, album: track.album ?? '' };
      seek.setProgress(duration ? Math.min(100, (position / duration) * 100) : 0);
      clock.setContent(`{gray-fg}${time(position)}/${time(duration)}{/}`);

      // With the booster on, show the countdown to the next advance — the one
      // number that explains why a track is about to end early.
      const countdown = state.boostAt
        ? Math.max(0, Math.ceil((state.boostAt - Date.now()) / 1000))
        : null;

      const parts = [
        paused ? '{yellow-fg}paused{/}' : '{green-fg}playing{/}',
        `{gray-fg}${track.curated ? 'llm' : track.source ?? 'lastfm'}{/}`,
        track.userPlaycount
          ? `{gray-fg}${plural(track.userPlaycount, 'play')}{/}`
          : '{green-fg}new to you{/}',
        track.userLoved ? '{red-fg}♥{/}' : null,
        scrobbled ? '{green-fg}scrobbled{/}' : '{gray-fg}not yet scrobbled{/}',
        countdown !== null ? `{magenta-fg}next in ${countdown}s{/}` : null,
      ].filter(Boolean);
      badges.setContent(parts.join(' {gray-fg}·{/} '));
    }

    paintText();

    // Percentage of the configured ceiling, not of an assumed 130.
    const ceiling = state.maxVolume || 100;
    volumeBar.setProgress(Math.min(100, (volume / ceiling) * 100));
    volumeValue.setContent(`{gray-fg}${volume}%{/}`);
  }

  /**
   * Interior row the level meter should occupy, or null when the card is too
   * short to spare one. The card owns the row map, so it answers rather than
   * the layout guessing at an offset that silently collides after an edit.
   */
  const visualizerRow = () => rowsFor(interior()).visualizer;

  return { box, update, layout, tick, coverSize, visualizerRow };
}
