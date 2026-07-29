import { energyOf } from '../acousticbrainz/client.js';
import { debug } from '../util/log.js';

/**
 * Background audio-feature enrichment.
 *
 * Resolving a track to its MusicBrainz recording id costs one rate-limited
 * request (MusicBrainz allows roughly one per second), so doing it inline
 * would add half a minute to every refill. Instead this runs detached: it
 * annotates whatever it can before the track is needed, and permanently caches
 * the result — including misses — so the benefit accrues over sessions rather
 * than stalling the first one.
 *
 * Nothing downstream may require the annotation; `energy` is simply absent
 * until it arrives.
 */
export function createEnricher(acousticBrainz, { enabled = true } = {}) {
  const inFlight = new Set();
  let annotated = 0;
  let missing = 0;

  async function annotate(track) {
    if (!enabled || track.energy !== undefined) return;
    const key = `${track.artist}::${track.name}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);

    try {
      const features = await acousticBrainz.features(track);
      const energy = energyOf(features);
      // Null marks "looked, found nothing" so we never retry within a session.
      track.features = features;
      track.energy = energy;
      if (energy === null) missing += 1;
      else annotated += 1;
    } catch (err) {
      track.energy = null;
      debug(`enrich failed for ${key}: ${err.message}`);
    } finally {
      inFlight.delete(key);
    }
  }

  /** Fire-and-forget over a queue; deliberately not awaited by the caller. */
  function enrich(tracks) {
    if (!enabled) return;
    for (const track of tracks) annotate(track);
  }

  /**
   * Instant, network-free annotation from cache. Run this over the shortlist
   * before sequencing so already-known tracks can influence the running order;
   * `enrich()` then fills the cache for next time.
   */
  function applyCached(tracks) {
    if (!enabled) return 0;
    let applied = 0;
    for (const track of tracks) {
      if (track.energy !== undefined) continue;
      const features = acousticBrainz.featuresCached(track);
      if (!features) continue;
      track.features = features;
      track.energy = energyOf(features);
      applied += 1;
    }
    return applied;
  }

  const stats = () => ({ annotated, missing, pending: inFlight.size });

  return { enrich, applyCached, annotate, stats };
}
