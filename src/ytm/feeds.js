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

/**
 * Accept an entry only when YouTube itself says it is music.
 *
 * `:ytrec` is the YouTube-wide recommendation feed, not a YouTube Music one —
 * it happily returns news, vlogs and podcasts. Treating the uploader as the
 * artist (the obvious-looking fallback) lets every one of those through: a
 * political news upload arrives as artist "Some Channel", title "…", and looks
 * exactly like a track.
 *
 * So there is no uploader fallback here. An entry qualifies only if YouTube
 * tagged it with real music metadata, or it comes from an auto-generated
 * artist channel, which is always suffixed "- Topic".
 */
export function toMusicTrack(v) {
  const topicChannel = /\s-\sTopic$/.test(v.uploader ?? v.channel ?? '');
  const artist = v.artist ?? (topicChannel ? (v.uploader ?? v.channel).replace(/\s-\sTopic$/, '') : null);
  const name = v.track ?? (topicChannel ? stripYoutubeDecoration(v.title ?? '') : null);

  if (!artist || !name) return null;

  // Anything much longer than a song is a set, a mix or a podcast.
  const duration = Number(v.duration) || null;
  if (duration && (duration < 45 || duration > 900)) return null;

  return { artist, name, videoId: v.id, duration };
}

export function createFeeds(config) {
  const { binary, timeoutMs } = config.resolver;
  const { cookiesFromBrowser } = config.sources;
  let unavailable = false;
  // How many entries each feed returned versus how many survived the music
  // filter. Surfaced by `autodj login --web`, so an over-aggressive filter is
  // visible as "40 entries, 0 kept" rather than an inexplicably empty lane.
  const lastStats = new Map();

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

      const entries = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const kept = entries.map(toMusicTrack).filter(Boolean);
      lastStats.set(target, { raw: entries.length, kept: kept.length });
      if (entries.length && !kept.length) {
        debug(`${target}: ${entries.length} entries, none matched the music filter`);
      }
      return kept;
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
  const statsFor = (target) => lastStats.get(target) ?? null;

  return { liked, recommendations, history, playlist, available, statsFor, FEEDS };
}
