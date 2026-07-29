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

  /** Your playcount for a track, or 0. Never null — absence *is* zero here. */
  const playcountOf = (track) => state.tracks[looseKey(track)] ?? 0;

  const artistPlaycountOf = (track) => state.artists[artistKeyOf(track)] ?? 0;

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

  return { load, save, playcountOf, artistPlaycountOf, hasHeard, knowsArtist, isReady, stats };
}
