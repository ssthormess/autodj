import { asArray } from './client.js';

/**
 * The similarity graph. `match` is Last.fm's 0..1 confidence and is carried
 * through to scoring, so a 0.9 neighbour outranks a 0.2 one.
 */
export function createSimilarSource(client) {
  const similarArtists = async (artist, limit = 25) => {
    const json = await client.request(
      'artist.getSimilar',
      { artist, autocorrect: 1, limit },
      { cache: true },
    );
    return asArray(json.similarartists?.artist).map((a) => ({
      name: a.name,
      mbid: a.mbid || null,
      match: Number(a.match) || 0,
    }));
  };

  const similarTracks = async ({ artist, name }, limit = 25) => {
    const json = await client.request(
      'track.getSimilar',
      { artist, track: name, autocorrect: 1, limit },
      { cache: true },
    );
    return asArray(json.similartracks?.track).map((t) => ({
      artist: t.artist?.name,
      name: t.name,
      mbid: t.mbid || null,
      match: Number(t.match) || 0,
      duration: Number(t.duration) || null,
    }));
  };

  const artistTopTracks = async (artist, limit = 12) => {
    const json = await client.request(
      'artist.getTopTracks',
      { artist, autocorrect: 1, limit },
      { cache: true },
    );
    return asArray(json.toptracks?.track).map((t, i) => ({
      artist: t.artist?.name ?? artist,
      name: t.name,
      mbid: t.mbid || null,
      // Rank within the artist's catalogue, normalised to a 0..1 signal.
      rank: 1 - i / Math.max(1, limit),
      listeners: Number(t.listeners) || 0,
    }));
  };

  return { similarArtists, similarTracks, artistTopTracks };
}
