import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR, ensureDirs } from '../config/paths.js';
import { looseKey, artistKeyOf } from '../util/track.js';

const LIBRARY_FILE = join(CONFIG_DIR, 'library.json');

/**
 * A local mirror of the entire Last.fm library.
 *
 * Without this, "have I heard this?" costs one `track.getInfo` call per
 * candidate, and any track the API didn't return a playcount for looks
 * unplayed — which is exactly the question `--discover` and `--hits` turn on.
 * With 44k unique tracks in this account, sampling a few hundred per refill
 * could never answer it correctly.
 *
 * The full set is ~45 requests and answers every lookup instantly and
 * completely thereafter.
 */
export function createLibrary() {
  let state = load();

  function load() {
    ensureDirs();
    const empty = { tracks: {}, artists: {}, syncedAt: null, totals: {} };
    if (!existsSync(LIBRARY_FILE)) return empty;
    try {
      return { ...empty, ...JSON.parse(readFileSync(LIBRARY_FILE, 'utf8')) };
    } catch {
      return empty;
    }
  }

  function save(next) {
    ensureDirs();
    state = next;
    writeFileSync(LIBRARY_FILE, JSON.stringify(state));
    return state;
  }

  /**
   * Entries are `[artist, name, playcount]`. Earlier versions stored a bare
   * playcount, which made the library useless for anything but lookups: the
   * key folds artist and title into one string, so a playable pair could not
   * be recovered from it. Both shapes are accepted so an existing sync keeps
   * working until it is refreshed.
   */
  const entryPlaycount = (entry) => (Array.isArray(entry) ? entry[2] : entry) ?? 0;

  /** Your playcount for a track, or 0. Never null — absence *is* zero here. */
  const playcountOf = (track) => entryPlaycount(state.tracks[looseKey(track)]);

  const artistPlaycountOf = (track) => entryPlaycount(state.artists[artistKeyOf(track)]);

  /** True when entries carry names, i.e. the library can be sampled from. */
  const isSamplable = () => {
    const first = Object.values(state.tracks)[0];
    return Array.isArray(first);
  };

  /**
   * Random tracks from your own library, weighted toward what you play most.
   * Used to start playback instantly while the real queue is still building.
   */
  function sample(count = 1, { minPlaycount = 1 } = {}) {
    const entries = Object.values(state.tracks).filter(
      (e) => Array.isArray(e) && e[2] >= minPlaycount,
    );
    if (!entries.length) return [];

    const picked = [];
    const seen = new Set();
    // Rejection sampling against the max playcount: cheap, and avoids building
    // a cumulative weight table over 40k+ entries on every call.
    const max = entries.reduce((m, e) => Math.max(m, e[2]), 1);
    for (let tries = 0; tries < count * 200 && picked.length < count; tries += 1) {
      const e = entries[Math.floor(Math.random() * entries.length)];
      if (seen.has(e[0] + e[1])) continue;
      if (Math.random() > Math.log1p(e[2]) / Math.log1p(max)) continue;
      seen.add(e[0] + e[1]);
      picked.push({ artist: e[0], name: e[1], userPlaycount: e[2], source: 'library' });
    }
    return picked;
  }

  /** True only when the library is populated enough for absence to mean zero. */
  const isReady = () => Object.keys(state.tracks).length > 0;

  const hasHeard = (track) => playcountOf(track) > 0;

  const knowsArtist = (track) => artistPlaycountOf(track) > 0;

  const stats = () => ({
    tracks: Object.keys(state.tracks).length,
    artists: Object.keys(state.artists).length,
    syncedAt: state.syncedAt,
    totals: state.totals,
  });

  return {
    load, save, playcountOf, artistPlaycountOf, hasHeard, knowsArtist,
    isReady, isSamplable, sample, stats,
  };
}
