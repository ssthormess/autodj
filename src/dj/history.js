import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { HISTORY_FILE, ensureDirs } from '../config/paths.js';
import { identityOf } from '../lastfm/correct.js';
import { artistKeyOf } from '../util/track.js';

const DAY = 86400_000;

/**
 * Persistent memory of what the DJ has already served and how you reacted.
 * This is what stops the "same twelve songs forever" failure mode.
 */
export function createHistory() {
  const state = load();

  function load() {
    ensureDirs();
    if (!existsSync(HISTORY_FILE)) return { played: {}, skipped: {}, loved: {}, banned: {} };
    try {
      return { played: {}, skipped: {}, loved: {}, banned: {}, ...JSON.parse(readFileSync(HISTORY_FILE, 'utf8')) };
    } catch {
      return { played: {}, skipped: {}, loved: {}, banned: {} };
    }
  }

  function save() {
    ensureDirs();
    writeFileSync(HISTORY_FILE, JSON.stringify(state));
  }

  const recordPlayed = (track) => {
    const id = identityOf(track);
    state.played[id] = { at: Date.now(), count: (state.played[id]?.count ?? 0) + 1 };
    save();
  };

  const recordSkipped = (track, atSeconds) => {
    const id = identityOf(track);
    const prior = state.skipped[id] ?? { count: 0 };
    state.skipped[id] = { at: Date.now(), count: prior.count + 1, atSeconds };
    // Skipped twice inside 10 seconds means you really don't want it.
    if (prior.count + 1 >= 2 && atSeconds < 10) state.banned[id] = Date.now();
    save();
  };

  const recordLoved = (track) => {
    state.loved[identityOf(track)] = Date.now();
    save();
  };

  /** Explicit "never again" — stronger than an accumulated skip. */
  const ban = (track) => {
    state.banned[identityOf(track)] = Date.now();
    save();
  };

  const unban = (track) => {
    delete state.banned[identityOf(track)];
    save();
  };

  const playedRecently = (track, days) => {
    const entry = state.played[identityOf(track)];
    return Boolean(entry) && Date.now() - entry.at < days * DAY;
  };

  const isBanned = (track) => Boolean(state.banned[identityOf(track)]);

  const skipCount = (track) => state.skipped[identityOf(track)]?.count ?? 0;

  /** Artists you've skipped repeatedly get down-weighted, not banned outright. */
  function artistPenalty(track) {
    const key = artistKeyOf(track);
    let skips = 0;
    for (const [id, entry] of Object.entries(state.skipped)) {
      if (id.includes(key)) skips += entry.count;
    }
    return Math.min(0.6, skips * 0.15);
  }

  const stats = () => ({
    played: Object.keys(state.played).length,
    skipped: Object.keys(state.skipped).length,
    banned: Object.keys(state.banned).length,
    loved: Object.keys(state.loved).length,
  });

  return {
    recordPlayed,
    recordSkipped,
    recordLoved,
    ban,
    unban,
    playedRecently,
    isBanned,
    skipCount,
    artistPenalty,
    stats,
  };
}
