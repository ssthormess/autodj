import blessed from 'blessed';

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Level meter for the current signal.
 *
 * Bars are drawn from mpv's own loudness metadata, so an idle or paused track
 * reads as silence rather than continuing to wiggle. The columns are a decayed
 * spread around the measured level rather than frequency bands — mpv exposes
 * no FFT, and decoding the stream a second time purely to compute one would
 * double the bandwidth of every track.
 */
export function createVisualizer(parent, { columns = 24 } = {}) {
  const box = blessed.box({ parent, tags: true, content: '' });

  // Each column keeps its own falling value so the display has motion without
  // inventing signal that is not there.
  const heights = new Array(columns).fill(0);

  function update(levels, theme) {
    if (!levels?.available) {
      box.setContent('');
      return;
    }

    const { left, right, loudness } = levels;
    const centre = (columns - 1) / 2;

    for (let i = 0; i < columns; i += 1) {
      // Weight the stereo channels by which side of the display the column is
      // on, so a hard-panned mix visibly leans.
      const pan = i / Math.max(1, columns - 1);
      const channel = left * (1 - pan) + right * pan;
      // Falls off towards the edges, giving the familiar centre-weighted shape.
      const shape = 1 - Math.abs(i - centre) / (centre + 1) ** 1.15;
      const target = Math.max(0, Math.min(1, (channel * 0.55 + loudness * 0.75) * shape));

      heights[i] = target > heights[i] ? target : heights[i] * 0.82;
    }

    const colours = theme.vis;
    const line = heights
      .map((h) => {
        const level = Math.max(0, Math.min(BLOCKS.length - 1, Math.round(h * (BLOCKS.length - 1))));
        const colour = colours[Math.min(colours.length - 1, Math.floor(h * colours.length))];
        return `{${colour}-fg}${BLOCKS[level]}{/}`;
      })
      .join('');

    box.setContent(line);
  }

  return { box, update };
}
