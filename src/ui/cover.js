import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readCache, writeCache } from '../util/cache.js';
import { debug } from '../util/log.js';

const run = promisify(execFile);

/**
 * Album art as terminal cells.
 *
 * True inline images do exist — iTerm2's OSC 1337, kitty's graphics protocol —
 * but they draw outside the character grid, and this UI repaints every second,
 * so blessed would erase the image on the next frame and leave it flickering.
 *
 * Drawing with half-blocks keeps the artwork inside the grid where blessed can
 * own it. The upper-half block character renders its foreground colour in the
 * top half of the cell and its background colour in the bottom, so one row of
 * characters carries two rows of pixels and a cell becomes square-ish.
 *
 * ffmpeg does the fetch, scale and decode in one pass, which avoids pulling in
 * an image library for a 16×16 thumbnail.
 */
/** Deterministic 32-bit hash, so one artist always gets the same artwork. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const hslToRgb = (h, s, l) => {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
};

const toHex = ([r, g, b]) =>
  `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

/**
 * Placeholder artwork for releases that have none.
 *
 * Drawn with the same half-block technique as real covers so the card keeps
 * its shape, rather than leaving a hole whenever Last.fm has no image. The
 * design is a level-bar motif over a gradient, with the hue and the bar
 * heights both derived from the artist name — so it is stable for a given
 * artist and visibly different between them, which makes it read as "this
 * release has no art" rather than "the art failed to load".
 *
 * Deliberately abstract: it is not a logo and does not imitate anyone's
 * artwork.
 */
export function defaultCoverCells(seed = '', { columns = 16, rows = 8 } = {}) {
  const height = rows * 2;
  const h = hash(seed || 'autodj');
  const hue = h % 360;

  const barHeights = Array.from({ length: columns }, (_, i) => {
    const n = (h >>> (i % 24)) ^ Math.imul(i + 1, 2654435761);
    return 0.25 + ((n >>> 8) % 1000) / 1000 * 0.6;
  });

  const pixel = (x, y) => {
    // Background: vertical gradient, dark at the bottom.
    const depth = y / (height - 1);
    const bg = hslToRgb(hue, 0.45, 0.10 + (1 - depth) * 0.16);

    const barTop = Math.round((1 - barHeights[x]) * height);
    if (y >= barTop) {
      // Bars brighten toward their tops.
      const within = (y - barTop) / Math.max(1, height - barTop);
      return hslToRgb((hue + 20) % 360, 0.55, 0.62 - within * 0.28);
    }
    return bg;
  };

  const lines = [];
  for (let row = 0; row < rows; row += 1) {
    let line = '';
    for (let x = 0; x < columns; x += 1) {
      line += `{${toHex(pixel(x, row * 2))}-fg}{${toHex(pixel(x, row * 2 + 1))}-bg}▀{/}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export async function fetchCoverCells(url, { columns = 16, rows = 8 } = {}) {
  if (!url) return null;

  const cacheKey = `${url}@${columns}x${rows}`;
  const cached = readCache('cover', cacheKey, 60 * 60 * 24 * 30);
  if (cached !== null) return cached.cells;

  const height = rows * 2;

  try {
    const { stdout } = await run(
      'ffmpeg',
      [
        '-loglevel', 'error',
        '-i', url,
        '-vf', `scale=${columns}:${height}:flags=lanczos`,
        '-frames:v', '1',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        '-',
      ],
      { encoding: 'buffer', timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
    );

    const expected = columns * height * 3;
    if (!stdout || stdout.length < expected) {
      writeCache('cover', cacheKey, { cells: null });
      return null;
    }

    const pixel = (x, y) => {
      const i = (y * columns + x) * 3;
      return [stdout[i], stdout[i + 1], stdout[i + 2]];
    };
    const hex = ([r, g, b]) =>
      `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

    const lines = [];
    for (let row = 0; row < rows; row += 1) {
      let line = '';
      for (let x = 0; x < columns; x += 1) {
        const top = hex(pixel(x, row * 2));
        const bottom = hex(pixel(x, row * 2 + 1));
        // Foreground paints the top half, background the bottom half.
        line += `{${top}-fg}{${bottom}-bg}▀{/}`;
      }
      lines.push(line);
    }

    const cells = lines.join('\n');
    writeCache('cover', cacheKey, { cells });
    return cells;
  } catch (err) {
    debug(`cover render failed for ${url}: ${err.message.split('\n')[0]}`);
    writeCache('cover', cacheKey, { cells: null });
    return null;
  }
}
