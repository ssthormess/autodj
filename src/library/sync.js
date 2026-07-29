import { asArray } from '../lastfm/client.js';
import { looseKey } from '../util/track.js';

const PAGE_SIZE = 1000;

/**
 * Pull the complete top-tracks and top-artists lists into the local library.
 *
 * `user.getTopTracks` reports every track you have ever scrobbled along with
 * your playcount, so one pass gives both "what have I heard" and "how much".
 * Pages are fetched in small concurrent groups: sequential would take minutes,
 * and hammering all 45 at once is a good way to get rate-limited.
 */
export async function syncLibrary(client, user, { onProgress = () => {} } = {}) {
  async function fetchAll(method, key, itemKey) {
    const first = await client.request(method, { user, limit: PAGE_SIZE, page: 1 });
    const attr = first[key]?.['@attr'] ?? {};
    const totalPages = Number(attr.totalPages) || 1;
    const total = Number(attr.total) || 0;

    const items = [...asArray(first[key]?.[itemKey])];
    onProgress({ method, page: 1, totalPages, total });

    // Four at a time keeps this well inside Last.fm's tolerance.
    for (let start = 2; start <= totalPages; start += 4) {
      const group = [];
      for (let page = start; page < start + 4 && page <= totalPages; page += 1) {
        group.push(client.request(method, { user, limit: PAGE_SIZE, page }));
      }
      // eslint-disable-next-line no-await-in-loop
      const settled = await Promise.allSettled(group);
      for (const result of settled) {
        if (result.status === 'fulfilled') items.push(...asArray(result.value[key]?.[itemKey]));
      }
      onProgress({ method, page: Math.min(start + 3, totalPages), totalPages, total });
    }

    return { items, total };
  }

  const [tracksResult, artistsResult] = await Promise.all([
    fetchAll('user.getTopTracks', 'toptracks', 'track'),
    fetchAll('user.getTopArtists', 'topartists', 'artist'),
  ]);

  const tracks = {};
  for (const t of tracksResult.items) {
    const artist = t.artist?.name ?? t.artist?.['#text'] ?? t.artist;
    if (!artist || !t.name) continue;
    tracks[looseKey({ artist, name: t.name })] = Number(t.playcount) || 0;
  }

  const artists = {};
  for (const a of artistsResult.items) {
    if (!a.name) continue;
    artists[looseKey({ artist: a.name, name: '' })] = Number(a.playcount) || 0;
  }

  return {
    tracks,
    artists,
    syncedAt: Date.now(),
    totals: {
      tracks: tracksResult.total,
      artists: artistsResult.total,
      fetchedTracks: Object.keys(tracks).length,
      fetchedArtists: Object.keys(artists).length,
    },
  };
}
