import { readCache, writeCache } from '../util/cache.js';
import { recordingCandidates } from './mbid.js';
import { debug } from '../util/log.js';

const AB_ROOT = 'https://acousticbrainz.org/api/v1';
const TTL = 60 * 60 * 24 * 30;

/**
 * AcousticBrainz — free acoustic analysis keyed on MusicBrainz recording ids.
 *
 * The project stopped accepting new submissions in 2022, but the accumulated
 * dataset is still served, and it is the only free source of measured audio
 * features here: tempo, key, loudness, plus trained classifiers for mood,
 * danceability and timbre.
 *
 * Coverage is partial, so nothing may depend on it — every consumer has to
 * work when `features()` returns null.
 */
export function createAcousticBrainz() {
  /** Batch lookup by recording mbid. The API takes semicolon-separated ids. */
  async function highLevelBatch(mbids) {
    if (!mbids.length) return {};
    const fresh = [];
    const out = {};

    for (const mbid of mbids) {
      const hit = readCache('ab', mbid, TTL);
      if (hit !== null) out[mbid] = hit.features;
      else fresh.push(mbid);
    }
    if (!fresh.length) return out;

    // The endpoint caps how many ids it will accept at once.
    for (let i = 0; i < fresh.length; i += 20) {
      const batch = fresh.slice(i, i + 20);
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(
          `${AB_ROOT}/high-level?recording_ids=${batch.join(';')}`,
        );
        if (!response.ok) continue;
        // eslint-disable-next-line no-await-in-loop
        const json = await response.json();

        for (const mbid of batch) {
          // The response carries an extra `mbid_mapping` key that is not a
          // recording, and each recording nests its submissions under "0".
          const highlevel = mbid === 'mbid_mapping' ? null : json[mbid]?.['0']?.highlevel;
          const features = highlevel ? parseHighLevel(highlevel) : null;
          writeCache('ab', mbid, { features });
          out[mbid] = features;
        }
      } catch (err) {
        debug(`acousticbrainz batch failed: ${err.message}`);
      }
    }
    return out;
  }

  function parseHighLevel(hl) {
    const p = (name, positive) =>
      hl[name] ? (hl[name].value === positive ? hl[name].probability : 1 - hl[name].probability) : null;

    return {
      danceability: p('danceability', 'danceable'),
      aggressive: p('mood_aggressive', 'aggressive'),
      happy: p('mood_happy', 'happy'),
      relaxed: p('mood_relaxed', 'relaxed'),
      sad: p('mood_sad', 'sad'),
      party: p('mood_party', 'party'),
      acoustic: p('mood_acoustic', 'acoustic'),
      electronic: p('mood_electronic', 'electronic'),
      dark: p('timbre', 'dark'),
      instrumental: p('voice_instrumental', 'instrumental'),
      genre: hl.genre_dortmund?.value ?? null,
    };
  }

  /**
   * Features for one track, resolving its recording id first when needed.
   * Returns null whenever anything in the chain is unavailable.
   */
  async function features(track) {
    const mbids = track.recordingMbid
      ? [track.recordingMbid]
      : await recordingCandidates(track);
    if (!mbids.length) return null;

    // One batch call covers every pressing; take the first that was analysed.
    const batch = await highLevelBatch(mbids);
    for (const mbid of mbids) {
      if (batch[mbid]) return batch[mbid];
    }
    return null;
  }

  /**
   * Cache-only lookup: never touches the network, so it is safe to call on a
   * whole shortlist synchronously during a refill.
   *
   * This is what makes the audio features actually reach the sequencer.
   * Background enrichment populates the cache, and this pass reads it on
   * subsequent refills — so energy-aware ordering switches on progressively as
   * coverage accumulates, instead of stalling every refill on a rate-limited
   * MusicBrainz lookup.
   */
  function featuresCached(track) {
    const cachedIds = readCache('mb-recording', `${track.artist} ${track.name}`, TTL);
    const mbids = track.recordingMbid ? [track.recordingMbid] : cachedIds?.mbids ?? [];
    for (const mbid of mbids) {
      const entry = readCache('ab', mbid, TTL);
      if (entry?.features) return entry.features;
    }
    return null;
  }

  return { features, featuresCached, highLevelBatch, recordingCandidates };
}

/**
 * Collapse the classifier set into a single 0..1 energy value.
 *
 * Used for transition smoothing: consecutive tracks with wildly different
 * energy are what make a generated set feel stitched together rather than
 * sequenced.
 */
export function energyOf(features) {
  if (!features) return null;
  const terms = [
    [features.aggressive, 1.0],
    [features.party, 0.8],
    [features.danceability, 0.7],
    [features.relaxed, -0.9],
    [features.acoustic, -0.5],
    [features.sad, -0.4],
  ].filter(([value]) => typeof value === 'number');

  if (!terms.length) return null;
  const weighted = terms.reduce((sum, [value, weight]) => sum + value * weight, 0);
  const total = terms.reduce((sum, [, weight]) => sum + Math.abs(weight), 0);
  // Map the signed sum onto 0..1.
  return Math.max(0, Math.min(1, 0.5 + weighted / (2 * total)));
}
