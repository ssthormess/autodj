import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stripYoutubeDecoration, looseKey } from '../util/track.js';
import { debug } from '../util/log.js';

const run = promisify(execFile);

/**
 * Resolve a canonical Last.fm track to a playable YouTube Music stream.
 *
 * We search YouTube Music (not plain YouTube) because its catalogue is already
 * track-shaped: fewer live bootlegs, fewer hour-long compilations, and the
 * uploader is usually the artist channel.
 */
export function createSearcher(config) {
  const { binary, timeoutMs } = config.resolver;

  async function ytdlp(args) {
    const { stdout } = await run(binary, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  }

  /** Query YouTube Music's search page and return parsed candidates. */
  async function search(query, limit = 6) {
    const stdout = await ytdlp([
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '--flat-playlist',
      '--default-search', 'ytsearch',
      '--extractor-args', 'youtube:player_client=web_music',
    ]);

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
        id: v.id,
        title: v.title ?? '',
        uploader: v.uploader ?? v.channel ?? '',
        duration: Number(v.duration) || null,
        url: v.url ?? `https://music.youtube.com/watch?v=${v.id}`,
      }));
  }

  /**
   * Score a YouTube result against the canonical track.
   *
   * Duration is the strongest signal we have — if Last.fm says 3:42 and the
   * result is 12 minutes, it's a mix, not the song. Title/artist overlap and
   * a penalty for live/cover/remix variants do the rest.
   */
  function scoreResult(result, track) {
    const cleanTitle = stripYoutubeDecoration(result.title).toLowerCase();
    const wantTrack = track.name.toLowerCase();
    const wantArtist = track.artist.toLowerCase();

    let score = 0;
    if (cleanTitle.includes(wantTrack)) score += 3;
    if (cleanTitle.includes(wantArtist) || result.uploader.toLowerCase().includes(wantArtist)) {
      score += 2;
    }
    // Official artist channels on YT Music are suffixed "- Topic".
    if (/- topic$/i.test(result.uploader)) score += 2;

    if (track.duration && result.duration) {
      const drift = Math.abs(track.duration - result.duration);
      if (drift <= 3) score += 4;
      else if (drift <= 10) score += 2;
      else if (drift > 90) score -= 5;
    }

    // Reject things that are a different recording unless we asked for one.
    const variantPattern = /\b(live|cover|remix|karaoke|instrumental|sped up|slowed|reverb|8d|nightcore|reaction|tutorial)\b/i;
    if (variantPattern.test(cleanTitle) && !variantPattern.test(wantTrack)) score -= 4;
    if (/\b(full album|mix|compilation|playlist|megamix|\d+\s*hours?)\b/i.test(cleanTitle)) score -= 6;

    return score;
  }

  /** Best playable match, or null when nothing clears the bar. */
  async function resolve(track) {
    const query = `${track.artist} ${track.name}`;
    let results = [];
    try {
      results = await search(query);
    } catch (err) {
      debug(`yt-dlp search failed for ${query}: ${err.message}`);
      return null;
    }
    if (!results.length) return null;

    const ranked = results
      .map((r) => ({ ...r, score: scoreResult(r, track) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    debug(`resolved "${query}" → ${best.title} (score ${best.score})`);
    // A negative score means every candidate looked wrong; skip rather than
    // play an hour-long mix into the user's scrobble history.
    return best.score > 0 ? best : null;
  }

  /** YouTube Music's own radio mix, seeded from a video id. */
  async function radioFrom(videoId, limit = 25) {
    try {
      const stdout = await ytdlp([
        `https://music.youtube.com/watch?v=${videoId}&list=RDAMVM${videoId}`,
        '--dump-json',
        '--flat-playlist',
        '--no-warnings',
        '--playlist-end', String(limit),
      ]);
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
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
          source: 'ytm-radio',
        }))
        .filter((t) => t.artist && t.name && looseKey(t).trim());
    } catch (err) {
      debug(`ytm radio failed for ${videoId}: ${err.message}`);
      return [];
    }
  }

  /** Direct audio stream URL for mpv. */
  async function streamUrl(videoId) {
    const stdout = await ytdlp([
      `https://music.youtube.com/watch?v=${videoId}`,
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--get-url',
      '--no-warnings',
    ]);
    return stdout.trim().split('\n')[0] || null;
  }

  return { search, resolve, radioFrom, streamUrl, scoreResult };
}
