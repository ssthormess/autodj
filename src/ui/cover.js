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
/**
 * Hosts whose artwork we will fetch.
 *
 * ffmpeg resolves its input through protocol handlers, so `-i` will happily
 * accept `file:`, `concat:` or `subfile:` and read from disk. The URL here
 * arrives from a remote API response, which is not a strong enough guarantee
 * to hand to something with that reach — so the scheme and host are checked
 * here, and ffmpeg is additionally told which protocols it may use at all.
 */
const ALLOWED_HOSTS = [
  'lastfm.freetls.fastly.net',
  'lastfm-img2.akamaized.net',
  'coverartarchive.org',
  'archive.org',
  'i.scdn.co',
];

function isAllowedArtworkUrl(candidate) {
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
  );
}

export async function fetchCoverCells(url, { columns = 16, rows = 8 } = {}) {
  if (!url) return null;
  if (!isAllowedArtworkUrl(url)) {
    debug(`refusing artwork url outside the allowed hosts: ${String(url).slice(0, 80)}`);
    return null;
  }

  const cacheKey = `${url}@${columns}x${rows}`;
  const cached = readCache('cover', cacheKey, 60 * 60 * 24 * 30);
  if (cached !== null) return cached.cells;

  const height = rows * 2;

  try {
    const { stdout } = await run(
      'ffmpeg',
      [
        '-loglevel', 'error',
        // Never wait on a prompt, and refuse every protocol except the one
        // needed to fetch remote artwork over TLS — belt and braces with the
        // host check above.
        '-nostdin',
        '-protocol_whitelist', 'https,tls,tcp',
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
