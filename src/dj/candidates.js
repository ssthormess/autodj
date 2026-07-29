import { predupe } from '../util/track.js';
import { debug } from '../util/log.js';

/**
 * Candidate generation runs several independent lanes and pools the results.
 * Each lane finds things the others structurally cannot, which is the whole
 * defence against a recommender that "misses":
 *
 *  similar-artist  → sideways moves within your taste
 *  similar-track   → track-level neighbours, tighter than artist-level
 *  artist-top      → the songs you'd expect but may never have played
 *  tag             → genre-level exploration, escapes the collaborative bubble
 *  ytm-radio       → YouTube's own co-listening graph, a different data source
 */
export async function gatherCandidates(sources, seeds, config) {
  const { perSeedLimit } = config.dj;
  const { similar, tags: tagSource, searcher, web, feeds, lb, user } = sources;
  const mode = config.mode ?? null;
  const lanes = [];

  // While a mood is steering, only lanes that follow the given seeds may run.
  // The personal feeds recommend from your history by construction, so leaving
  // them on means the direction you asked for competes with everything you
  // already listen to — and loses.
  const STEERED_LANES = [
    'similar-artist', 'artist-top', 'artist-deep', 'tag', 'similar-track', 'ytm-search',
  ];

  // A mode may restrict which lanes run at all; `null` means "everything".
  const laneAllowed = (name) => {
    if (seeds.steered) return STEERED_LANES.includes(name);
    return !mode?.lanes || mode.lanes.includes(name);
  };

  // ---- Last.fm's own recommendation stations (logged-in web session) -------
  if (config.sources.lastfmWeb && web) {
    if (laneAllowed('lastfm-recommended')) {
      lanes.push(web.recommended(40));
    }
    if (laneAllowed('lastfm-mix')) lanes.push(web.mix(40));
    if (laneAllowed('lastfm-library')) lanes.push(web.library(40));
  }

  // ---- YouTube signed-in feeds --------------------------------------------
  if (config.sources.ytmFeeds && feeds) {
    if (laneAllowed('ytm-rec')) lanes.push(feeds.recommendations(30));
    if (laneAllowed('ytm-liked')) lanes.push(feeds.liked(40));
  }

  // ---- ListenBrainz collaborative filtering --------------------------------
  if (config.sources.listenBrainz && lb) {
    if (laneAllowed('lb-cf')) {
      lanes.push(
        (async () => {
          const recs = await lb.recommendations(40).catch(() => []);
          // CF returns MBIDs; resolve a bounded number back to names.
          const resolved = await Promise.all(
            recs.slice(0, 20).map((r) =>
              lb.lookupRecording(r.recordingMbid).then((t) => (t ? { ...t, source: 'lb-cf', seed: 'ListenBrainz CF', match: r.score } : null)),
            ),
          );
          return resolved.filter(Boolean);
        })(),
      );
    }

    if (laneAllowed('lb-similar')) {
      lanes.push(
        ...seeds.tracks
          .filter((t) => t.mbid)
          .slice(0, 3)
          .map(async (seed) => {
            const neighbours = await lb.similarRecordings(seed.mbid, 15).catch(() => []);
            return neighbours
              .filter((n) => n.artist && n.name)
              .map((n) => ({
                artist: n.artist,
                name: n.name,
                album: n.album,
                mbid: n.recordingMbid,
                source: 'lb-similar',
                seed: `${seed.artist} — ${seed.name}`,
                // LB scores are raw co-listen counts (~0..300 for recordings);
                // compress to the 0..1 range the scorer expects.
                match: Math.min(1, Math.log1p(n.score) / 6),
              }));
          }),
      );
    }
  }

  // ---- Your own catalogue (the "hits" lanes) -------------------------------
  if (laneAllowed('user-top') && mode) {
    lanes.push(
      user
        .topTracks('overall', 200)
        .then((t) => t.map((x) => ({ ...x, source: 'user-top', seed: 'your top tracks', rank: 0.9 })))
        .catch(() => []),
    );
  }
  if (laneAllowed('loved') && mode) {
    lanes.push(
      user
        .lovedTracks(200)
        .then((t) => t.map((x) => ({ ...x, source: 'loved', seed: 'your loved tracks', rank: 0.95 })))
        .catch(() => []),
    );
  }

  // ---- Deep cuts: album tracks by artists you already know ------------------
  if (laneAllowed('artist-deep') && mode?.label === 'deep') {
    lanes.push(
      ...seeds.artists.slice(0, 6).map(async (seed) => {
        const top = await similar.artistTopTracks(seed.name, 50).catch(() => []);
        // Skip the singles everyone knows; the tail is the deep cut.
        return top.slice(12).map((t) => ({ ...t, source: 'artist-deep', seed: seed.name }));
      }),
    );
  }

  if (config.sources.similarArtists && laneAllowed('similar-artist')) {
    lanes.push(
      ...seeds.artists.map(async (seed) => {
        const neighbours = await similar.similarArtists(seed.name, 12).catch(() => []);
        const picks = neighbours.slice(0, 6);
        const nested = await Promise.all(
          picks.map(async (n) => {
            const top = await similar.artistTopTracks(n.name, 5).catch(() => []);
            return top.map((t) => ({
              ...t,
              source: 'similar-artist',
              seed: seed.name,
              match: n.match,
            }));
          }),
        );
        return nested.flat();
      }),
    );
  }

  if (config.sources.similarTracks && laneAllowed('similar-track')) {
    lanes.push(
      ...seeds.tracks.map(async (seed) => {
        const neighbours = await similar
          .similarTracks({ artist: seed.artist, name: seed.name }, perSeedLimit)
          .catch(() => []);
        return neighbours.map((t) => ({
          ...t,
          source: 'similar-track',
          seed: `${seed.artist} — ${seed.name}`,
        }));
      }),
    );
  }

  if (config.sources.topTags && laneAllowed('tag')) {
    lanes.push(
      ...seeds.tags.map(async (tag) => {
        const top = await tagSource.tagTopTracks(tag.name, 40).catch(() => []);
        // Normally the head of a tag chart is skipped as too obvious. When a
        // mood picked the tag, that head *is* the answer — it is the canon of
        // the genre that was asked for.
        const body = seeds.steered ? top : top.slice(5);
        return body.map((t) => ({ ...t, source: 'tag', seed: tag.name }));
      }),
    );
  }

  /**
   * Searching the YouTube Music catalogue by name.
   *
   * Only used when a mood is steering, and it is what makes regional scenes
   * reachable at all. Last.fm's tag for "gaitas venezolanas" holds a single
   * track and "changa tuki" almost nothing, while YouTube Music's catalogue
   * has both. Queries are capped because each one costs a search plus a
   * detail fetch.
   */
  if (seeds.steered && laneAllowed('ytm-search') && searcher) {
    const queries = [
      seeds.mood,
      ...seeds.tags.slice(0, 2).map((t) => t.name),
    ].filter(Boolean);

    lanes.push(
      ...[...new Set(queries)].slice(0, 3).map((q) => searcher.searchMusic(q, 25).catch(() => [])),
    );
  }

  if (config.sources.ytmRadio && laneAllowed('ytm-radio') && seeds.tracks.length && searcher) {
    lanes.push(
      (async () => {
        const seed = seeds.tracks[0];
        const resolved = await searcher.resolve(seed).catch(() => null);
        if (!resolved) return [];
        const mix = await searcher.radioFrom(resolved.id, 25);
        return mix.map((t) => ({ ...t, seed: `${seed.artist} — ${seed.name}` }));
      })(),
    );
  }

  const settled = await Promise.allSettled(lanes);
  const all = settled
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((t) => t?.artist && t?.name);

  const unique = predupe(all);
  debug(`candidates: ${all.length} raw → ${unique.length} unique across ${lanes.length} lanes`);
  return unique;
}
