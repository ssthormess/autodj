import blessed from 'blessed';
import { createNowPlaying } from '/Users/simon/Scratchpad/autodj/src/ui/widgets/nowPlaying.js';
import { computeLayout, applyRect } from '/Users/simon/Scratchpad/autodj/src/ui/layout.js';

/**
 * The card at every plausible window size: does the artwork sit flush to the
 * card's border on top, bottom and right, and does any visible row collide?
 */
process.env.TERM = 'xterm-256color';
const screen = blessed.screen({ smartCSR: false, warnings: false });

const card = createNowPlaying(screen);
// children[0] is the box blessed creates for the panel's label, which sits on
// the border row; the artwork is the first child we made ourselves.
const [labelBox, coverBox] = card.box.children;
const track = {
  artist: 'Bob Marley & The Wailers',
  name: 'Rebel Music (3 O’Clock Roadblock)',
  album: 'A Rebel’s Dream',
  source: 'lastfm',
  userPlaycount: 3,
};

const SIZES = [[80, 24], [90, 30], [100, 40], [120, 50], [200, 60], [70, 20], [60, 16], [86, 15], [110, 55], [40, 12]];
let failures = 0;

for (const [width, height] of SIZES) {
  // `screen.width` is a getter over the program's terminal size.
  screen.program.cols = width;
  screen.program.rows = height;
  screen.alloc();
  const l = computeLayout(width, height, { keyRows: 1 });
  applyRect(card.box, l.nowPlaying);
  card.layout();
  card.update({ track, position: 30, duration: 200, volume: 10, maxVolume: 130, cover: '' });

  const interior = card.box.height - 2;
  const size = card.coverSize();
  const problems = [];

  // Flush on three sides: top row 0, right offset 0, height == interior.
  if (coverBox.position.top !== 0) problems.push(`art top ${coverBox.position.top}`);
  if (coverBox.position.right !== 0) problems.push(`art right gap ${coverBox.position.right}`);
  if (coverBox.position.height !== interior) {
    problems.push(`art height ${coverBox.position.height} vs interior ${interior}`);
  }
  if (size.columns !== size.rows * 2) problems.push('art not square');

  // Text must have a usable column beside the artwork.
  const textWidth = card.box.width - 2 - size.columns - 2;
  if (textWidth < 4) problems.push(`text column ${textWidth}`);

  // No two visible rows may share a row index.
  const rows = card.box.children
    .filter((el) => el !== coverBox && el !== labelBox && !el.hidden && typeof el.position.top === 'number')
    .map((el) => `${el.position.top}@${el.position.left ?? 'r'}`);
  if (new Set(rows).size !== rows.length) problems.push(`row collision: ${rows.join(' ')}`);

  // Nothing may extend past the interior.
  const tops = card.box.children.filter((el) => el !== labelBox && !el.hidden).map((el) => el.position.top);
  if (tops.some((t) => t >= interior)) problems.push(`row past interior (${tops.join(',')} vs ${interior})`);

  if (problems.length) failures += 1;
  console.log(
    `${String(width).padStart(3)}x${String(height).padEnd(3)} card=${String(card.box.height).padStart(2)} ` +
      `art=${size.columns}x${size.rows} text=${String(textWidth).padStart(3)} meter=${card.visualizerRow() ?? '-'}  ` +
      (problems.length ? `✗ ${problems.join('; ')}` : 'ok'),
  );
}

console.log(failures ? `\n${failures} size(s) failed` : '\nall sizes ok');
screen.destroy();
process.exit(failures ? 1 : 0);
