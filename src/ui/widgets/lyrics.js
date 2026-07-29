import blessed from 'blessed';
import { activeLineIndex } from '../../lyrics/lrclib.js';

/**
 * Synced lyrics, scrolling with playback.
 *
 * The current line is centred and highlighted, with the surrounding lines
 * dimmed either side, so the panel reads like a karaoke display rather than a
 * static block of text. Coverage is partial and a miss is unremarkable, so the
 * panel says plainly when a track has no transcription instead of sitting
 * blank and looking broken.
 */
export function createLyrics(parent) {
  const box = blessed.box({
    parent,
    top: 0,
    left: 0,
    right: 0,
    height: 7,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
    label: ' lyrics ',
    align: 'center',
  });

  const content = blessed.box({
    parent: box,
    top: 0,
    left: 1,
    right: 1,
    tags: true,
    align: 'center',
    content: '',
  });

  function update(lyrics, position, theme) {
    const rows = Math.max(1, (box.height ?? 7) - 2);

    if (!lyrics) {
      box.setLabel(' lyrics ');
      content.setContent('{gray-fg}looking…{/}');
      return;
    }
    if (lyrics.instrumental) {
      box.setLabel(' lyrics ');
      content.setContent('{gray-fg}instrumental{/}');
      return;
    }
    if (!lyrics.synced?.length) {
      box.setLabel(lyrics.plain ? ' lyrics {gray-fg}(not synced){/} ' : ' lyrics ');
      content.setContent(
        lyrics.plain
          ? '{gray-fg}no timed transcription for this track{/}'
          : '{gray-fg}no lyrics found{/}',
      );
      return;
    }

    const current = activeLineIndex(lyrics.synced, position);
    box.setLabel(` lyrics {gray-fg}${Math.max(0, current + 1)}/${lyrics.synced.length}{/} `);

    // Keep the active line in the middle of whatever height we were given.
    const above = Math.floor((rows - 1) / 2);
    const start = Math.max(0, Math.min(current - above, lyrics.synced.length - rows));

    const painted = [];
    for (let i = start; i < start + rows && i < lyrics.synced.length; i += 1) {
      const line = lyrics.synced[i].text || '♪';
      painted.push(
        i === current
          ? `{bold}{${theme.accent}-fg}${blessed.escape(line)}{/}`
          : `{gray-fg}${blessed.escape(line)}{/}`,
      );
    }
    content.setContent(painted.join('\n'));
  }

  return { box, update };
}
