import { asArray } from './client.js';

const toTrack = (t) => ({
  artist: t.artist?.name ?? t.artist?.['#text'] ?? t.artist,
  name: t.name,
  mbid: t.mbid || null,
  url: t.url,
});

/** Your listening spine — what you actually play, over several time horizons. */
export function createUserSource(client, user) {
  const topArtists = async (period = 'overall', limit = 50) => {
    const json = await client.request(
      'user.getTopArtists',
      { user, period, limit },
      { cache: true },
    );
    return asArray(json.topartists?.artist).map((a) => ({
      name: a.name,
      mbid: a.mbid || null,
      playcount: Number(a.playcount) || 0,
    }));
  };

  const topTracks = async (period = 'overall', limit = 100) => {
    const json = await client.request(
      'user.getTopTracks',
      { user, period, limit },
      { cache: true },
    );
    // This endpoint's `playcount` is already *your* playcount, so surface it
    // under the same name the scorer uses instead of making it re-fetch.
    return asArray(json.toptracks?.track).map((t) => ({
      ...toTrack(t),
      userPlaycount: Number(t.playcount) || 0,
    }));
  };

  const lovedTracks = async (limit = 200) => {
    const json = await client.request('user.getLovedTracks', { user, limit }, { cache: true });
    return asArray(json.lovedtracks?.track).map((t) => ({ ...toTrack(t), userLoved: true }));
  };

  /** Not cached — this is the "what did I just hear" signal. */
  const recentTracks = async (limit = 200) => {
    const json = await client.request('user.getRecentTracks', { user, limit });
    return asArray(json.recenttracks?.track)
      .filter((t) => !t['@attr']?.nowplaying)
      .map((t) => ({ ...toTrack(t), playedAt: Number(t.date?.uts) || null }));
  };

  return { topArtists, topTracks, lovedTracks, recentTracks };
}
