import { artistKeyOf } from '../util/track.js';

/**
 * Final sequencing pass over an already-ranked list.
 *
 * Ranking gives the best tracks; flow decides the order they're heard in.
 * Two rules do most of the work: never stack an artist, and interleave the
 * familiar with the unfamiliar so a set neither bores nor exhausts.
 */
export function sequence(primary, config, { recentArtists = [], backfill = [] } = {}) {
  const { queueTarget, artistCooldown, familiarRatio } = config.dj;
  // Deep-cut sets are built from few artists by definition, so a cap of one
  // would starve them; modes may raise it.
  const artistMaxPerSet = config.mode?.artistMaxPerSet ?? config.dj.artistMaxPerSet;

  // `primary` is the preferred order (the LLM's, when it ran). `backfill` is
  // the wider ranked pool, used only once the diversity guards have exhausted
  // the primary list — otherwise a curated set with repeated artists comes out
  // half the requested length.
  const seenInPrimary = new Set(primary);
  const pool = [...primary, ...backfill.filter((t) => !seenInPrimary.has(t))];

  const familiar = pool.filter((t) => (t.userPlaycount ?? 0) > 0);
  const fresh = pool.filter((t) => (t.userPlaycount ?? 0) === 0);

  const wantFamiliar = Math.round(queueTarget * familiarRatio);
  const out = [];
  const artistWindow = [...recentArtists];
  const perArtist = new Map();

  /**
   * Two separate guards. The cooldown stops back-to-back repeats; the per-set
   * cap stops an artist bookending the same set, which the cooldown alone
   * happily allows and which is what makes a "radio" feel thin.
   */
  const canPlace = (track) => {
    const key = artistKeyOf(track);
    if ((perArtist.get(key) ?? 0) >= artistMaxPerSet) return false;
    return !artistWindow.slice(0, artistCooldown).includes(key);
  };

  /**
   * Among the placeable candidates, prefer the one whose energy is closest to
   * the outgoing track. Audio features come from AcousticBrainz and are often
   * absent, so this only reorders within the top of the pool and degrades to
   * plain rank order when nothing has features.
   */
  const take = (pool, previous) => {
    const placeable = [];
    for (let i = 0; i < pool.length && placeable.length < 6; i += 1) {
      if (canPlace(pool[i])) placeable.push(i);
    }
    if (!placeable.length) return null;

    let chosen = placeable[0];
    const previousEnergy = previous?.energy;
    if (typeof previousEnergy === 'number') {
      let best = Infinity;
      for (const i of placeable) {
        const energy = pool[i].energy;
        if (typeof energy !== 'number') continue;
        // Rank position still matters; energy distance only breaks near-ties.
        const cost = Math.abs(energy - previousEnergy) + placeable.indexOf(i) * 0.04;
        if (cost < best) {
          best = cost;
          chosen = i;
        }
      }
    }

    const [track] = pool.splice(chosen, 1);
    const key = artistKeyOf(track);
    artistWindow.unshift(key);
    perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
    return track;
  };

  while (out.length < queueTarget && (familiar.length || fresh.length)) {
    const familiarSoFar = out.filter((t) => (t.userPlaycount ?? 0) > 0).length;
    const preferFamiliar = familiarSoFar < wantFamiliar && familiar.length > 0;

    const track = preferFamiliar
      ? take(familiar, out.at(-1)) ?? take(fresh, out.at(-1))
      : take(fresh, out.at(-1)) ?? take(familiar, out.at(-1));

    if (!track) break;
    out.push(track);
  }

  return out;
}
