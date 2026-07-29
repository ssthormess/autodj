import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { debug } from '../util/log.js';

const run = promisify(execFile);

const FIREFOX_PROFILES = join(homedir(), 'Library', 'Application Support', 'Firefox', 'Profiles');

/**
 * Last.fm's own recommendations are not exposed by the public API — the
 * `user.getRecommendedArtists` method was withdrawn and now returns HTTP 400.
 * They are still generated and served, but only to a logged-in session on the
 * website. Reading the browser's existing session cookie is the same approach
 * yt-dlp takes with `--cookies-from-browser`, and it never leaves this machine.
 *
 * Firefox holds cookies in SQLite and keeps the file locked while running, so
 * we work on a copy. macOS ships the sqlite3 binary, which keeps this
 * dependency-free.
 */
function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function profileCandidates() {
  if (!existsSync(FIREFOX_PROFILES)) return [];
  return readdirSync(FIREFOX_PROFILES)
    .map((name) => join(FIREFOX_PROFILES, name, 'cookies.sqlite'))
    .filter((path) => existsSync(path))
    // Most-recently written profile first — that's the one in active use.
    .sort((a, b) => mtime(b) - mtime(a));
}

async function readCookiesFrom(dbPath, hostPattern) {
  const scratch = join(tmpdir(), `autodj-cookies-${process.pid}.sqlite`);
  try {
    copyFileSync(dbPath, scratch);
    const { stdout } = await run(
      'sqlite3',
      [
        scratch,
        `SELECT name || '=' || value FROM moz_cookies WHERE host LIKE '${hostPattern}';`,
      ],
      { timeout: 15000 },
    );
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } finally {
    rmSync(scratch, { force: true });
  }
}

/**
 * Returns a Cookie header string for last.fm, or null when the browser has no
 * usable session. The value is passed straight to fetch and never logged.
 */
export async function lastfmCookieHeader() {
  for (const dbPath of profileCandidates()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const pairs = await readCookiesFrom(dbPath, '%last.fm');
      const hasSession = pairs.some((p) => p.startsWith('sessionid='));
      if (hasSession) {
        debug(`using last.fm session from ${dbPath}`);
        return pairs.join('; ');
      }
    } catch (err) {
      debug(`cookie read failed for ${dbPath}: ${err.message}`);
    }
  }
  return null;
}

export async function hasSqlite() {
  try {
    await run('sqlite3', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
