import { asArray } from './client.js';

/** Tag-driven exploration — the lane that finds things the graph won't. */
export function createTagSource(client) {
  const tagTopTracks = async (tag, limit = 50) => {
    const json = await client.request('tag.getTopTracks', { tag, limit }, { cache: true });
    return asArray(json.tracks?.track).map((t, i) => ({
      artist: t.artist?.name,
      name: t.name,
      mbid: t.mbid || null,
      tag,
      rank: 1 - i / Math.max(1, limit),
    }));
  };

  const tagTopArtists = async (tag, limit = 50) => {
    const json = await client.request('tag.getTopArtists', { tag, limit }, { cache: true });
    return asArray(json.topartists?.artist).map((a) => ({ name: a.name, tag }));
  };

  const artistTopTags = async (artist) => {
    const json = await client.request(
      'artist.getTopTags',
      { artist, autocorrect: 1 },
      { cache: true },
    );
    return asArray(json.toptags?.tag)
      .map((t) => ({ name: t.name, count: Number(t.count) || 0 }))
      // Below ~10 the tag is one person's private joke, not a genre.
      .filter((t) => t.count >= 10);
  };

  /**
   * Your genre profile, inferred from the artists you actually play.
   *
   * `user.getTopTags` only returns tags *you* personally applied, which for
   * almost every account is an empty list — so we aggregate the community tags
   * of your top artists instead, weighted by how much you play them.
   */
  const profileTags = async (artists, limit = 12) => {
    const results = await Promise.allSettled(artists.map((a) => artistTopTags(a.name)));
    const weights = new Map();

    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const artistWeight = Math.log1p(artists[index].playcount ?? 1);
      for (const tag of result.value) {
        const key = tag.name.toLowerCase();
        weights.set(key, (weights.get(key) ?? 0) + (tag.count / 100) * artistWeight);
      }
    });

    return [...weights.entries()]
      .map(([name, count]) => ({ name, count }))
      // "seen live" and decade tags say nothing about how music sounds.
      .filter((t) => !/^(seen live|favou?rites?|awesome|good|cool|\d{2,4}s?)$/i.test(t.name))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  };

  return { tagTopTracks, tagTopArtists, artistTopTags, profileTags };
}
