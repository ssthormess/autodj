import blessed from 'blessed';

/**
 * Acoustic analysis for the current track, when AcousticBrainz has any.
 *
 * These are trained-classifier probabilities, not measurements of taste, so
 * they are shown as short bars with the raw value rather than dressed up as
 * verdicts. Coverage is partial; the panel simply says so when a track has no
 * analysis rather than showing zeros, which would read as "not danceable"
 * instead of "unknown".
 */
const ROWS = [
  ['energy', 'energy', 'yellow'],
  ['danceability', 'dance', 'magenta'],
  ['happy', 'happy', 'green'],
  ['aggressive', 'aggr', 'red'],
  ['relaxed', 'relax', 'cyan'],
  ['acoustic', 'acous', 'white'],
  ['electronic', 'elec', 'blue'],
  ['instrumental', 'instr', 'gray'],
];

const miniBar = (value, width = 10) => {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return '▇'.repeat(filled) + '·'.repeat(width - filled);
};

export function createFeatures(parent) {
  const box = blessed.box({
    parent,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
    label: ' analysis ',
  });

  const content = blessed.box({ parent: box, top: 0, left: 1, right: 1, tags: true, content: '' });

  function update(track) {
    const f = track?.features;
    const energy = track?.energy;

    if (!f && typeof energy !== 'number') {
      content.setContent(
        track
          ? '{gray-fg}no acoustic analysis\nfor this recording{/}'
          : '{gray-fg}—{/}',
      );
      return;
    }

    const values = { ...f, energy };
    const lines = ROWS.filter(([key]) => typeof values[key] === 'number').map(
      ([key, label, colour]) => {
        const v = values[key];
        return `{${colour}-fg}${label.padEnd(6)}{/}{${colour}-fg}${miniBar(v)}{/} {gray-fg}${v.toFixed(2)}{/}`;
      },
    );

    if (f?.genre) lines.push(`{gray-fg}genre ${f.genre}{/}`);
    content.setContent(lines.join('\n'));
  }

  return { box, update };
}
