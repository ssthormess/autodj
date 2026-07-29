import { predupe } from '../util/track.js';

/** Weighted pick without replacement. */
function sample(items, count, weightOf = () => 1) {
  const pool = [...items];
  const picked = [];
  while (pool.length && picked.length < count) {
    const total = pool.reduce((sum, item) => sum + Math.max(0.0001, weightOf(item)), 0);
    let roll = Math.random() * total;
    let index = 0;
    for (; index < pool.length; index += 1) {
      roll -= Math.max(0.0001, weightOf(pool[index]));
      if (roll <= 0) break;
    }
    picked.push(pool.splice(Math.min(index, pool.length - 1), 1)[0]);
  }
  return picked;
}

/**
 * Seeds decide where the next batch of music comes from. We deliberately mix
 * time horizons so a set doesn't collapse into whatever you played yesterday:
 *
 *  - overall top artists  → your durable taste
 *  - 3-month top artists  → what you're into right now
 *  - loved tracks         → the explicit signal
 *  - recent tracks        → immediate context, so the set flows from here
 */
export async function buildSeeds(sources, config, { steer = null } = {}) {
  const { seedCount } = config.dj;
  const { user } = sources;

  if (steer) {
    // Flagged so candidate generation can shut off the personal-history lanes.
    // A mood that still pulls your Last.fm stations and YouTube feeds is a
    // mood that gets drowned out by your existing taste.
    return {
      artists: steer.artists ?? [],
      tracks: steer.tracks ?? [],
      tags: steer.tags ?? [],
      mood: steer.mood ?? null,
      steered: true,
    };
  }

  const [overall, recent3m, loved, recent] = await Promise.all([
    config.sources.topArtists ? user.topArtists('overall', 60) : [],
    config.sources.topArtists ? user.topArtists('3month', 40) : [],
    config.sources.lovedTracks ? user.lovedTracks(200) : [],
    config.sources.recentTracks ? user.recentTracks(100) : [],
  ]);

  // Genre profile is inferred from the artists you play, not from personal
  // tags — see lastfm/tags.js#profileTags for why.
  const tags = config.sources.topTags
    ? await sources.tags.profileTags([...recent3m, ...overall].slice(0, 20))
    : [];

  // Recency-weighted: the last hour of listening matters more than last month.
  const artistPool = [
    ...overall.map((a) => ({ ...a, weight: Math.log1p(a.playcount) })),
    ...recent3m.map((a) => ({ ...a, weight: Math.log1p(a.playcount) * 1.8 })),
    ...recent.slice(0, 25).map((t) => ({ name: t.artist, weight: 2.5 })),
  ].filter((a) => a.name);

  const trackPool = predupe([
    ...loved.map((t) => ({ ...t, weight: 2 })),
    ...recent.slice(0, 40).map((t) => ({ ...t, weight: 1.2 })),
  ]);

  return {
    artists: sample(artistPool, seedCount, (a) => a.weight),
    tracks: sample(trackPool, Math.ceil(seedCount / 2), (t) => t.weight),
    tags: sample(tags, 3, (t) => Math.log1p(t.count)),
  };
}
