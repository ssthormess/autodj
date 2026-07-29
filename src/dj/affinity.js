import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR, ensureDirs } from '../config/paths.js';
import { identityOf } from '../lastfm/correct.js';
import { artistKeyOf } from '../util/track.js';

const AFFINITY_FILE = join(CONFIG_DIR, 'affinity.json');

/**
 * Your taste profile, learned from explicit votes.
 *
 * A vote on a track is also weak evidence about its artist, its album and its
 * tags — that propagation is what lets a handful of votes steer whole regions
 * of the catalogue instead of only the exact tracks you rated. Track-level
 * weight is strongest, tags weakest, because a tag covers thousands of songs
 * and would otherwise swamp everything else.
 */
const PROPAGATION = { track: 1.0, artist: 0.35, album: 0.25, tag: 0.12 };

// Votes decay so a profile can change its mind rather than fossilising.
const HALF_LIFE_DAYS = 120;

const decayed = (value, at) => {
  const ageDays = (Date.now() - at) / 86400_000;
  return value * 0.5 ** (ageDays / HALF_LIFE_DAYS);
};

export function createAffinity() {
  const state = load();

  function load() {
    ensureDirs();
    const empty = { tracks: {}, artists: {}, albums: {}, tags: {} };
    if (!existsSync(AFFINITY_FILE)) return empty;
    try {
      return { ...empty, ...JSON.parse(readFileSync(AFFINITY_FILE, 'utf8')) };
    } catch {
      return empty;
    }
  }

  const save = () => {
    ensureDirs();
    writeFileSync(AFFINITY_FILE, JSON.stringify(state));
  };

  const bump = (bucket, key, delta) => {
    if (!key) return;
    const prior = state[bucket][key];
    const base = prior ? decayed(prior.value, prior.at) : 0;
    state[bucket][key] = { value: Math.max(-3, Math.min(3, base + delta)), at: Date.now() };
  };

  /**
   * Record a vote. `direction` is +1 or -1; `weight` lets a love count for
   * more than a thumbs-up without needing a separate code path.
   */
  function vote(track, direction, weight = 1) {
    const delta = direction * weight;
    bump('tracks', identityOf(track), delta * PROPAGATION.track);
    bump('artists', artistKeyOf(track), delta * PROPAGATION.artist);
    if (track.album) bump('albums', `${artistKeyOf(track)}::${track.album.toLowerCase()}`, delta * PROPAGATION.album);
    for (const tag of (track.tags ?? []).slice(0, 5)) {
      bump('tags', tag.toLowerCase(), delta * PROPAGATION.tag);
    }
    save();
  }

  const read = (bucket, key) => {
    const entry = state[bucket][key];
    return entry ? decayed(entry.value, entry.at) : 0;
  };

  /**
   * Net affinity for a candidate, combining every level that has an opinion.
   * Returned on roughly the same scale as the other scoring terms.
   */
  function scoreFor(track) {
    let total = read('tracks', identityOf(track)) + read('artists', artistKeyOf(track));
    if (track.album) total += read('albums', `${artistKeyOf(track)}::${track.album.toLowerCase()}`);
    for (const tag of (track.tags ?? []).slice(0, 5)) total += read('tags', tag.toLowerCase()) * 0.5;
    return Math.max(-4, Math.min(4, total));
  }

  function top(bucket, limit = 10) {
    return Object.entries(state[bucket])
      .map(([key, entry]) => ({ key, value: decayed(entry.value, entry.at) }))
      .filter((x) => Math.abs(x.value) > 0.05)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  const stats = () => ({
    tracks: Object.keys(state.tracks).length,
    artists: Object.keys(state.artists).length,
    albums: Object.keys(state.albums).length,
    tags: Object.keys(state.tags).length,
  });

  return { vote, scoreFor, top, stats };
}
