import blessed from 'blessed';
import { time } from '../ansi.js';
import { plural } from '../../util/format.js';

/**
 * Now-playing panel: title, artist, seek bar, volume, and provenance.
 *
 * blessed owns the geometry. Nothing here writes cursor escapes or measures
 * string widths by hand, which is what made the previous hand-rolled renderer
 * scatter text across the terminal whenever a line exceeded the width or a
 * colour code threw the length calculation off.
 */
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

  // Artwork sits at the right edge; everything else is laid out to its left.
  // A bordered box of height 11 has nine interior rows. The art was eight,
  // which left a blank line under it. Nine rows of half-blocks is eighteen
  // pixels tall, so the width matches it to stay square.
  const COVER_COLS = 18;
  const COVER_ROWS = 9;
  const cover = blessed.box({
    parent: box,
    top: 0,
    right: 0,
    width: COVER_COLS,
    height: COVER_ROWS,
    tags: true,
    content: '',
  });
  const gutter = COVER_COLS + 2;

  const title = blessed.text({ parent: box, top: 0, left: 1, right: gutter, tags: true, content: '' });
  const artist = blessed.text({ parent: box, top: 1, left: 1, right: gutter, tags: true, content: '' });

  const seek = blessed.progressbar({
    parent: box,
    top: 3,
    left: 1,
    right: gutter + 11,
    height: 1,
    filled: 0,
    ch: '━',
    style: { bar: { fg: 'green' }, fg: 'black' },
  });
  const clock = blessed.text({ parent: box, top: 3, right: gutter, width: 11, tags: true, content: '' });

  const volumeBar = blessed.progressbar({
    parent: box,
    top: 5,
    left: 6,
    width: 20,
    height: 1,
    filled: 0,
    ch: '▇',
    style: { bar: { fg: 'yellow' }, fg: 'black' },
  });
  const volumeLabel = blessed.text({ parent: box, top: 5, left: 1, width: 5, tags: true, content: '{gray-fg}vol{/}' });
  const volumeValue = blessed.text({ parent: box, top: 5, left: 27, width: 12, tags: true, content: '' });

  const badges = blessed.text({ parent: box, top: 6, left: 1, right: gutter, tags: true, content: '' });

  function update(state) {
    const { track, position, duration, paused, volume, scrobbled, stage } = state;

    // Null while the thumbnail is still being fetched, or when the release has
    // no artwork; an empty box is better than a placeholder pretending to be one.
    cover.setContent(state.cover ?? '');

    if (!track) {
      title.setContent(`{yellow-fg}◌{/} ${stage ?? 'starting…'}`);
      artist.setContent('{gray-fg}the first set can take a moment{/}');
      seek.setProgress(0);
      clock.setContent('');
      badges.setContent('');
    } else {
      title.setContent(`{bold}${blessed.escape(track.name)}{/bold}`);
      artist.setContent(
        `{cyan-fg}${blessed.escape(track.artist)}{/}` +
          (track.album ? ` {gray-fg}· ${blessed.escape(track.album)}{/}` : ''),
      );
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

    // Percentage of the configured ceiling, not of an assumed 130.
    const ceiling = state.maxVolume || 100;
    volumeBar.setProgress(Math.min(100, (volume / ceiling) * 100));
    volumeValue.setContent(`{gray-fg}${volume}%{/}`);
  }

  return { box, update };
}
