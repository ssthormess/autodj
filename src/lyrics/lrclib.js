import { readCache, writeCache } from '../util/cache.js';
import { debug } from '../util/log.js';

const API = 'https://lrclib.net/api/get';
const TTL = 60 * 60 * 24 * 30;

/**
 * Time-synced lyrics from LRCLIB.
 *
 * LRCLIB is a free, open, community-contributed database built specifically
 * for LRC files. It needs no API key and no account, which makes it the only
 * practical option here — Musixmatch requires a commercial licence for synced
 * lyrics, and the alternatives are unofficial endpoints that break.
 *
 * Nothing is stored beyond the local cache, and a miss is as common as a hit:
 * plenty of tracks simply have no contributed transcription.
 */

/** Parse an LRC body into ordered `{ at, text }`, dropping metadata tags. */
export function parseLrc(body) {
  if (!body) return [];
  const lines = [];

  for (const raw of body.split('\n')) {
    // A line may carry several timestamps for a repeated refrain.
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;

    const text = raw.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, '').trim();
    for (const [, minutes, seconds] of stamps) {
      lines.push({ at: Number(minutes) * 60 + Number(seconds), text });
    }
  }

  return lines.sort((a, b) => a.at - b.at);
}

export function createLyricsSource() {
  async function fetchFor(track) {
    if (!track?.artist || !track?.name) return null;

    const key = `${track.artist}|${track.name}|${track.album ?? ''}|${track.duration ?? ''}`;
    const cached = readCache('lyrics', key, TTL);
    if (cached !== null) return cached.lyrics;

    const params = new URLSearchParams({
      artist_name: track.artist,
      track_name: track.name,
    });
    if (track.album) params.set('album_name', track.album);
    if (track.duration) params.set('duration', String(Math.round(track.duration)));

    try {
      const response = await fetch(`${API}?${params}`, {
        headers: { 'user-agent': 'autodj (personal listening tool)' },
      });

      // 404 simply means nobody has contributed this track.
      if (!response.ok) {
        writeCache('lyrics', key, { lyrics: null });
        return null;
      }

      const json = await response.json();
      if (json.instrumental) {
        const instrumental = { instrumental: true, synced: [], plain: null };
        writeCache('lyrics', key, { lyrics: instrumental });
        return instrumental;
      }

      const lyrics = {
        instrumental: false,
        synced: parseLrc(json.syncedLyrics),
        // Kept as a fallback so a track with only an unsynced transcription
        // still shows something, just without following along.
        plain: json.plainLyrics ?? null,
      };

      writeCache('lyrics', key, { lyrics });
      return lyrics;
    } catch (err) {
      debug(`lyrics lookup failed for ${track.artist} - ${track.name}: ${err.message}`);
      return null;
    }
  }

  return { fetchFor };
}

/**
 * Index of the line that should be current at `position` seconds.
 *
 * Returns -1 before the first line, which is the usual state during an intro.
 */
export function activeLineIndex(synced, position) {
  if (!synced?.length) return -1;
  let low = 0;
  let high = synced.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (synced[mid].at <= position) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
