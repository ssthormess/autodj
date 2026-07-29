import { asArray } from './client.js';
import { looseKey } from '../util/track.js';
import { debug } from '../util/log.js';

/**
 * Authoritative name resolution.
 *
 * Rather than guessing canonical titles with regex surgery, we ask Last.fm.
 * `autocorrect=1` maps "the beatles / Hey Jude (Remastered 2015)" onto the
 * catalogue entry Last.fm actually scrobbles against, and hands back the mbid,
 * real duration and the user's own playcount for free.
 *
 * The corrected identity is then reused everywhere: dedupe keys, the YouTube
 * Music search query, and the scrobble payload — so nothing downstream has to
 * re-guess, and the scrobble history stays free of near-duplicate variants.
 */
export function createResolver(client, { user = null } = {}) {
  const memo = new Map();

  async function correctTrack({ artist, name }) {
    if (!artist || !name) return null;
    const memoKey = looseKey({ artist, name });
    if (memo.has(memoKey)) return memo.get(memoKey);

    let resolved = null;
    try {
      const json = await client.request(
        'track.getInfo',
        // `username` is what makes Last.fm return userplaycount/userloved —
        // without it every track looks brand new and familiarity scoring dies.
        { artist, track: name, autocorrect: 1, username: user ?? undefined },
        { cache: true },
      );
      const t = json.track;
      if (t?.name && t?.artist?.name) {
        resolved = {
          artist: t.artist.name,
          name: t.name,
          album: t.album?.title ?? null,
          mbid: t.mbid || null,
          artistMbid: t.artist.mbid || null,
          // Last.fm gives milliseconds; 0 means "unknown", not "zero length".
          duration: Number(t.duration) > 0 ? Math.round(Number(t.duration) / 1000) : null,
          listeners: Number(t.listeners) || 0,
          playcount: Number(t.playcount) || 0,
          userPlaycount: Number(t.userplaycount) || 0,
          userLoved: t.userloved === '1',
          tags: asArray(t.toptags?.tag).map((x) => x.name).filter(Boolean),
          url: t.url ?? null,
          corrected: true,
        };
      }
    } catch (err) {
      // Error 6 = "track not found"; anything else is worth noting but not fatal.
      debug(`correctTrack miss for ${artist} — ${name}: ${err.message}`);
    }

    memo.set(memoKey, resolved);
    return resolved;
  }

  async function correctArtist(name) {
    if (!name) return null;
    const memoKey = `artist:${looseKey({ artist: name, name: '' })}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    let resolved = name;
    try {
      const json = await client.request('artist.getCorrection', { artist: name }, { cache: true });
      const corrected = json.corrections?.correction?.artist?.name;
      if (corrected) resolved = corrected;
    } catch (err) {
      debug(`correctArtist miss for ${name}: ${err.message}`);
    }

    memo.set(memoKey, resolved);
    return resolved;
  }

  /**
   * Merge a raw candidate with its canonical Last.fm entry. Falls back to the
   * raw values (flagged `corrected: false`) when Last.fm has never heard of it,
   * so obscure finds still play — they just don't get a trusted identity.
   */
  async function resolve(candidate) {
    const corrected = await correctTrack(candidate);
    if (!corrected) {
      return { ...candidate, corrected: false, duration: candidate.duration ?? null };
    }
    return { ...candidate, ...corrected };
  }

  return { correctTrack, correctArtist, resolve };
}

/**
 * Stable identity for a resolved track. Prefers the MusicBrainz id, because
 * that survives spelling and punctuation differences entirely.
 */
export const identityOf = (track) =>
  track.mbid ? `mbid:${track.mbid}` : `name:${looseKey(track)}`;
