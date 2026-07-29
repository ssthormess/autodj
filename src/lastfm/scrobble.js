import { label } from '../util/track.js';
import { debug, warn } from '../util/log.js';

/**
 * Scrobbling, to Last.fm's stated rules:
 *  - announce with updateNowPlaying at track start
 *  - submit once past half the track, or 4 minutes, whichever comes first
 *  - never submit anything under 30 seconds long
 *
 * Everything submitted uses the *corrected* names from src/lastfm/correct.js,
 * so a 109k-scrobble history doesn't accumulate near-duplicate variants.
 */
export function createScrobbler(client, config) {
  const { minPercent, minSeconds, minTrackLength, enabled } = config.scrobble;
  const failed = [];

  const payloadFor = (track, extra = {}) => ({
    artist: track.artist,
    track: track.name,
    album: track.album || undefined,
    duration: track.duration || undefined,
    mbid: track.mbid || undefined,
    ...extra,
  });

  async function nowPlaying(track) {
    if (!enabled) return false;
    try {
      await client.request('track.updateNowPlaying', payloadFor(track), {
        signed: true,
        post: true,
      });
      return true;
    } catch (err) {
      debug(`nowPlaying failed: ${err.message}`);
      return false;
    }
  }

  /** True once the track has been played long enough to count. */
  function isEligible(track, playedSeconds) {
    if (!enabled) return false;
    const length = track.duration ?? 0;
    if (length && length < minTrackLength) return false;
    const threshold = length ? Math.min(length * minPercent, minSeconds) : minSeconds;
    return playedSeconds >= threshold;
  }

  async function scrobble(track, startedAt) {
    if (!enabled) return false;
    const body = payloadFor(track, {
      timestamp: Math.floor(startedAt / 1000),
      // The DJ picked it, not the user — Last.fm's radio flag.
      chosenByUser: track.chosenByUser ? 1 : 0,
    });
    try {
      await client.request('track.scrobble', body, { signed: true, post: true });
      return true;
    } catch (err) {
      warn(`scrobble failed for ${label(track)} — queued for retry (${err.message})`);
      failed.push({ track, startedAt });
      return false;
    }
  }

  /** Re-send anything that failed while the network was down. */
  async function flush() {
    if (!failed.length) return 0;
    const pending = failed.splice(0, failed.length);
    let sent = 0;
    for (const item of pending) {
      // eslint-disable-next-line no-await-in-loop
      if (await scrobble(item.track, item.startedAt)) sent += 1;
    }
    return sent;
  }

  async function love(track) {
    await client.request(
      'track.love',
      { artist: track.artist, track: track.name },
      { signed: true, post: true },
    );
  }

  return { nowPlaying, isEligible, scrobble, flush, love, pending: () => failed.length };
}
