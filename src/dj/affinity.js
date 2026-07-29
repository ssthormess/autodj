import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
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

const decayFactor = (age) => 0.5 ** (age / 86400_000 / HALF_LIFE_DAYS);

const decayed = (value, at) => value * decayFactor(Date.now() - at);

// How many votes to keep reversible. Long enough to cover a mis-press noticed
// later in a session, short enough that the profile stays a small file.
const JOURNAL_LIMIT = 200;

const albumKeyOf = (track) => `${artistKeyOf(track)}::${track.album.toLowerCase()}`;

export function createAffinity() {
  const state = load();

  function load() {
    ensureDirs();
    const empty = { tracks: {}, artists: {}, albums: {}, tags: {}, votes: [] };
    if (!existsSync(AFFINITY_FILE)) return empty;
    try {
      return { ...empty, ...JSON.parse(readFileSync(AFFINITY_FILE, 'utf8')) };
    } catch {
      return empty;
    }
  }

  let seenMtime = mtimeOf();

  function mtimeOf() {
    try {
      return statSync(AFFINITY_FILE).mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * Pick up anything written since we last touched the file.
   *
   * A radio session runs for hours holding this profile in memory, and writes
   * it whole on every vote. Without this, `autodj unvote` in another terminal
   * is silently undone the next time the running session votes — the very
   * thing the undo exists to prevent. Cheap to avoid: the file is a few kB, so
   * re-read it before any change rather than trusting a stale copy.
   */
  let checkedAt = 0;
  function refresh({ force = false } = {}) {
    // Scoring calls this once per candidate, so reads throttle the stat — a
    // profile edited in another terminal is worth picking up promptly, not
    // hundreds of times a second. Anything about to *write* must never skip
    // it, or it writes a stale copy over the newer file.
    const now = Date.now();
    if (!force && now - checkedAt < 500) return;
    checkedAt = now;

    const mtime = mtimeOf();
    if (mtime === seenMtime) return;
    const fresh = load();
    for (const bucket of ['tracks', 'artists', 'albums', 'tags']) state[bucket] = fresh[bucket];
    state.votes = fresh.votes;
    seenMtime = mtime;
  }

  const save = () => {
    ensureDirs();
    writeFileSync(AFFINITY_FILE, JSON.stringify(state));
    seenMtime = mtimeOf();
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
    refresh({ force: true });
    const delta = direction * weight;
    const changes = [];
    const apply = (bucket, key, amount) => {
      if (!key) return;
      bump(bucket, key, amount);
      changes.push([bucket, key, amount]);
    };

    apply('tracks', identityOf(track), delta * PROPAGATION.track);
    apply('artists', artistKeyOf(track), delta * PROPAGATION.artist);
    if (track.album) apply('albums', albumKeyOf(track), delta * PROPAGATION.album);
    for (const tag of (track.tags ?? []).slice(0, 5)) {
      apply('tags', tag.toLowerCase(), delta * PROPAGATION.tag);
    }

    // Journalled so a mis-press can be reversed exactly, rather than guessed
    // at from the track later — which would touch tags the vote never reached.
    state.votes.push({
      id: identityOf(track),
      label: `${track.artist} — ${track.name}`,
      direction,
      weight,
      at: Date.now(),
      changes,
    });
    if (state.votes.length > JOURNAL_LIMIT) state.votes.splice(0, state.votes.length - JOURNAL_LIMIT);

    save();
  }

  /** Most recent journalled vote, optionally for one track. */
  function lastVote(identity = null) {
    refresh({ force: true });
    return [...state.votes].reverse().find((v) => !identity || v.id === identity) ?? null;
  }

  /**
   * Reverse a recorded vote.
   *
   * Each entry stores what the vote actually added, so undoing subtracts that
   * same amount decayed by the vote's own age — which is exactly what it still
   * contributes today. Decay is multiplicative over the whole stored value, so
   * an old delta keeps shrinking at the same rate whether or not other votes
   * landed on the key in between; removing the decayed amount therefore leaves
   * every other vote untouched. (Only a value that hit the ±3 clamp cannot be
   * unwound precisely.)
   */
  function undo(identity = null) {
    // `lastVote` refreshes, so the entry belongs to the array we are about to
    // filter — matching it by reference afterwards stays valid.
    const entry = lastVote(identity);
    if (!entry) return null;

    const factor = decayFactor(Date.now() - entry.at);
    for (const [bucket, key, amount] of entry.changes) {
      if (!state[bucket]?.[key]) continue;
      bump(bucket, key, -amount * factor);
      // A key left at zero holds no opinion; drop it rather than accumulating
      // dead entries every time a vote is taken back.
      if (Math.abs(state[bucket][key].value) < 0.005) delete state[bucket][key];
    }

    state.votes = state.votes.filter((v) => v !== entry);
    save();
    return entry;
  }

  /**
   * Reverse a vote that predates the journal, inferring what it touched.
   *
   * Nothing records what the old vote actually reached, so this is deliberately
   * conservative: it only reduces keys that already lean the way the mistake
   * pushed them, never past zero, and never creates a key. That can leave a
   * trace behind, but it can't invent an opinion the vote never expressed.
   */
  function undoInferred(track, direction = null, weight = null) {
    refresh({ force: true });
    // Both the direction and the strength of the mistake are readable from the
    // track entry, since a vote lands there at full weight — so an accidental
    // love unwinds as completely as an accidental downvote, without the caller
    // having to remember which key was pressed.
    const current = read('tracks', identityOf(track));
    const sign = direction ?? Math.sign(current);
    if (!sign) return [];
    const delta = sign * (weight ?? Math.abs(current) / PROPAGATION.track);
    const targets = [
      ['tracks', identityOf(track), delta * PROPAGATION.track],
      ['artists', artistKeyOf(track), delta * PROPAGATION.artist],
      ...(track.album ? [['albums', albumKeyOf(track), delta * PROPAGATION.album]] : []),
      ...(track.tags ?? []).slice(0, 5).map((tag) => ['tags', tag.toLowerCase(), delta * PROPAGATION.tag]),
    ];

    const undone = [];
    for (const [bucket, key, amount] of targets) {
      const prior = state[bucket]?.[key];
      if (!prior) continue;
      const current = decayed(prior.value, prior.at);
      // Same sign as the vote, or the vote isn't what put it there.
      if (Math.sign(current) !== Math.sign(amount)) continue;
      const removal = Math.min(Math.abs(amount), Math.abs(current)) * -Math.sign(amount);
      bump(bucket, key, removal);
      const after = read(bucket, key);
      if (Math.abs(after) < 0.005) delete state[bucket][key];
      undone.push({ bucket, key, before: current, after });
    }
    if (undone.length) save();
    return undone;
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
    refresh();
    let total = read('tracks', identityOf(track)) + read('artists', artistKeyOf(track));
    if (track.album) total += read('albums', albumKeyOf(track));
    for (const tag of (track.tags ?? []).slice(0, 5)) total += read('tags', tag.toLowerCase()) * 0.5;
    return Math.max(-4, Math.min(4, total));
  }

  function top(bucket, limit = 10) {
    refresh();
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

  return { vote, undo, undoInferred, lastVote, scoreFor, top, stats };
}
