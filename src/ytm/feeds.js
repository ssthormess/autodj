import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stripYoutubeDecoration } from '../util/track.js';
import { debug, warn } from '../util/log.js';

const run = promisify(execFile);

/**
 * YouTube Music's personalised feeds.
 *
 * The unauthenticated `RDAMVM…` radio we already use is seeded from a single
 * track. These are the account-level mixes the YouTube Music home screen shows
 * — Discover Mix (things outside your history), New Release Mix, and your
 * Replay/Supermix. They need your logged-in session, which yt-dlp can take
 * straight from Firefox.
 */
/**
 * Sources here are limited to things that actually resolve.
 *
 * An earlier version hardcoded `RDTMAK5uy_*` ids for Discover/New Release/
 * Replay/Supermix, described as account-independent. They are not: every one
 * of them returns HTTP 404. Personalised YouTube Music mix ids are per-account
 * and are only obtainable from the authenticated home feed, which yt-dlp does
 * not expose — so no such id is hardcoded any more.
 *
 * What remains are endpoints yt-dlp documents and that survive a real session:
 * your Liked Music playlist, your watch history, and YouTube's recommendation
 * feed. `autodj login --web` reports which of these actually returned tracks,
 * because that is the only way to confirm them on a given account.
 */
const FEEDS = {
  // Standard YouTube Music "Liked Music" auto-playlist.
  liked: 'https://music.youtube.com/playlist?list=LM',
  // yt-dlp aliases for the signed-in feeds.
  recommendations: ':ytrec',
  history: ':ythistory',
};

export function createFeeds(config) {
  const { binary, timeoutMs } = config.resolver;
  const { cookiesFromBrowser } = config.sources;
  let unavailable = false;

  async function playlist(target, limit = 40) {
    if (unavailable) return [];

    const args = [
      target,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '--playlist-end', String(limit),
    ];
    if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser);

    try {
      const { stdout } = await run(binary, args, {
        timeout: timeoutMs * 2,
        maxBuffer: 64 * 1024 * 1024,
      });

      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .map((v) => ({
          artist: v.artist ?? v.uploader?.replace(/ - Topic$/, '') ?? '',
          name: v.track ?? stripYoutubeDecoration(v.title ?? ''),
          videoId: v.id,
          duration: Number(v.duration) || null,
        }))
        .filter((t) => t.artist && t.name);
    } catch (err) {
      const message = String(err.message);
      if (/sign in|cookies|private|not available|login/i.test(message)) {
        unavailable = true;
        warn('YouTube feeds need a logged-in session — see: autodj login --web');
      } else {
        debug(`ytm feed ${target} failed: ${message.split('\n')[0]}`);
      }
      return [];
    }
  }

  const tag = (source, seed) => (tracks) => tracks.map((t) => ({ ...t, source, seed }));

  const liked = (limit) =>
    playlist(FEEDS.liked, limit).then(tag('ytm-liked', 'YouTube Music liked'));

  const recommendations = (limit) =>
    playlist(FEEDS.recommendations, limit).then(tag('ytm-rec', 'YouTube recommendations'));

  const history = (limit) =>
    playlist(FEEDS.history, limit).then(tag('ytm-history', 'YouTube history'));

  const available = () => !unavailable;

  return { liked, recommendations, history, playlist, available, FEEDS };
}
