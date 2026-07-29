import { EventEmitter } from 'node:events';
import { buildSeeds } from './seeds.js';
import { gatherCandidates } from './candidates.js';
import { rankCandidates } from './score.js';
import { sequence } from './flow.js';
import { identityOf } from '../lastfm/correct.js';
import { artistKeyOf, dedupeBy, label } from '../util/track.js';
import { debug, warn } from '../util/log.js';

/**
 * The DJ loop.
 *
 * refill() → seeds → candidate lanes → cheap rank → Last.fm correction on the
 * shortlist only → re-rank with the enriched data → optional LLM sequencing →
 * flow pass. Correction is the expensive step (one API call per track), so it
 * runs after the first ranking has already thrown most candidates away.
 */
export class DjEngine extends EventEmitter {
  #config;
  #sources;
  #player;
  #scrobbler;
  #history;
  #affinity;
  #curator;
  #resolver;
  #enricher;
  #library;

  queue = [];
  nowPlaying = null;
  recentlyPlayed = [];
  mood = null;
  #startedAt = null;
  #scrobbled = false;
  #refilling = null;
  #stopped = false;

  constructor({
    config, sources, player, scrobbler, history, affinity, curator, resolver, enricher,
    library,
  }) {
    super();
    this.#config = config;
    this.#sources = sources;
    this.#player = player;
    this.#scrobbler = scrobbler;
    this.#history = history;
    this.#affinity = affinity;
    this.#curator = curator;
    this.#resolver = resolver;
    this.#enricher = enricher;
    this.#library = library;

    player.on('end-file', (m) => this.#onEndFile(m));
  }

  get recentArtists() {
    return this.recentlyPlayed.map(artistKeyOf);
  }

  async #onEndFile(message) {
    if (this.#stopped) return;

    // mpv fires end-file for the *outgoing* track whenever we call loadfile,
    // so only a genuine end of stream may advance the queue. Treating every
    // end-file as "track finished" makes skip() cascade through the whole
    // queue in milliseconds.
    const reason = message?.reason;
    if (reason !== 'eof' && reason !== 'error') return;

    if (reason === 'error') {
      warn(`playback error on ${this.nowPlaying ? label(this.nowPlaying) : 'unknown track'}`);
    }

    await this.#finishCurrent({ skipped: false });
    await this.next();
  }

  async #finishCurrent({ skipped }) {
    const track = this.nowPlaying;
    if (!track) return;

    const played = await this.#player.position().catch(() => 0);

    if (skipped) {
      this.#history.recordSkipped(track, played);
      this.emit('skipped', track, played);
    }

    if (!this.#scrobbled && this.#scrobbler.isEligible(track, played)) {
      await this.#scrobbler.scrobble(track, this.#startedAt);
      this.#scrobbled = true;
      this.emit('scrobbled', track);
    }

    this.#history.recordPlayed(track);
    this.recentlyPlayed.unshift(track);
    this.recentlyPlayed = this.recentlyPlayed.slice(0, 40);
    this.nowPlaying = null;
  }

  /** Called on a timer by the UI so scrobbles land mid-track, not at the end. */
  async tick() {
    if (!this.nowPlaying || this.#scrobbled) return;
    const played = await this.#player.position().catch(() => 0);
    if (this.#scrobbler.isEligible(this.nowPlaying, played)) {
      await this.#scrobbler.scrobble(this.nowPlaying, this.#startedAt);
      this.#scrobbled = true;
      this.emit('scrobbled', this.nowPlaying);
    }
  }

  async next() {
    if (this.#stopped) return null;

    if (this.queue.length <= this.#config.dj.refillAt) {
      // Don't block playback on a refill unless the queue is actually empty.
      const refill = this.refill();
      if (!this.queue.length) await refill;
    }

    const track = this.queue.shift();
    if (!track) {
      this.emit('empty');
      return null;
    }

    return this.play(track);
  }

  async play(track) {
    // Resolve to a playable stream at the last moment — YouTube ids go stale.
    const resolved = track.videoId
      ? { id: track.videoId }
      : await this.#sources.searcher.resolve(track).catch(() => null);

    if (!resolved?.id) {
      warn(`no playable match for ${label(track)} — skipping`);
      this.emit('unplayable', track);
      return this.next();
    }

    const playable = {
      ...track,
      videoId: resolved.id,
      // Trust Last.fm's duration; fall back to YouTube's.
      duration: track.duration ?? resolved.duration ?? null,
    };

    this.nowPlaying = playable;
    this.#startedAt = Date.now();
    this.#scrobbled = false;

    // A prefetched direct stream starts near-instantly; the watch URL makes
    // mpv run its own extraction first, costing several seconds of silence.
    await this.#player.play(
      track.streamUrl ?? `https://music.youtube.com/watch?v=${resolved.id}`,
    );
    await this.#scrobbler.nowPlaying(playable);

    this.emit('playing', playable);
    // Resolve the next track now, so the gap between songs is a socket write
    // rather than a yt-dlp round trip.
    this.#prefetch();
    return playable;
  }

  /**
   * Warm the head of the queue in the background. Failures are ignored: play()
   * resolves again at the last moment if the prefetch didn't land.
   */
  #prefetch() {
    const upcoming = this.queue.filter((t) => !t.streamUrl).slice(0, 2);
    for (const track of upcoming) {
      Promise.resolve()
        .then(async () => {
          if (!track.videoId) {
            const hit = await this.#sources.searcher.resolve(track);
            if (!hit?.id) return;
            track.videoId = hit.id;
            track.duration = track.duration ?? hit.duration ?? null;
          }
          // Extract the audio URL up front too. Handing mpv a direct stream
          // skips its own yt-dlp pass, which is the ~4s of silence between
          // tracks that videoId-only prefetching does not remove.
          track.streamUrl = await this.#sources.searcher.streamUrl(track.videoId);
        })
        .catch(() => {});
    }
  }

  async skip() {
    await this.#finishCurrent({ skipped: true });
    return this.next();
  }

  /** Love on Last.fm *and* as the strongest positive vote in the profile. */
  async love() {
    if (!this.nowPlaying) return false;
    await this.#scrobbler.love(this.nowPlaying);
    this.#history.recordLoved(this.nowPlaying);
    this.#affinity.vote(this.nowPlaying, +1, 2);
    this.nowPlaying.userLoved = true;
    this.emit('loved', this.nowPlaying);
    return true;
  }

  /**
   * Up/down vote. Propagates to the artist, album and tags behind the track,
   * so a vote steers a region of the catalogue rather than one song.
   * A downvote also skips, since you clearly don't want to keep hearing it.
   */
  async vote(direction) {
    const track = this.nowPlaying;
    if (!track) return null;
    this.#affinity.vote(track, direction, 1);
    this.emit('voted', track, direction);
    return direction < 0 ? this.skip() : track;
  }

  ban(track = this.nowPlaying) {
    if (!track) return false;
    this.#history.ban(track);
    this.#affinity.vote(track, -1, 2);
    return true;
  }

  setMood(mood) {
    this.mood = mood || null;
    // A new direction invalidates the queued set.
    this.queue = [];
    this.emit('mood', this.mood);
    return this.refill();
  }

  /** Idempotent — concurrent callers share one in-flight refill. */
  refill(steer = null) {
    if (this.#refilling) return this.#refilling;
    this.#refilling = this.#doRefill(steer).finally(() => {
      this.#refilling = null;
    });
    return this.#refilling;
  }

  async #doRefill(steer) {
    this.emit('refilling');
    const { config } = this;

    try {
      const seeds = await buildSeeds(this.#sources, this.#config, { steer });
      const raw = await gatherCandidates(this.#sources, seeds, this.#config);
      if (!raw.length) {
        warn('no candidates returned this round');
        return;
      }

      const context = {
        history: this.#history,
        affinity: this.#affinity,
        library: this.#library,
        config: this.#config,
        recentArtists: this.recentArtists,
        nowPlayingTags: this.nowPlaying?.tags ?? [],
      };

      // Cheap pass first — most candidates die here, before any correction
      // call. Not strict: mode filters need data we don't have yet.
      const shortlist = rankCandidates(raw, context).slice(0, this.#config.dj.queueTarget * 4);

      // Now spend the API calls: canonical names, mbids, real durations and
      // your own playcount, which the second ranking pass actually needs.
      const corrected = await Promise.all(
        shortlist.map((c) =>
          this.#resolver.resolve(c).then((r) => ({ ...c, ...r })).catch(() => c),
        ),
      );

      const queued = new Set(this.queue.map(identityOf));
      const fresh = dedupeBy(corrected, identityOf).filter((t) => !queued.has(identityOf(t)));

      // Attach any audio features already in cache, so the sequencer can use
      // them. Free — no network, no rate limit.
      this.#enricher?.applyCached(fresh);

      // Second pass, now with canonical data — mode filters apply here.
      const ranked = rankCandidates(fresh, { ...context, strict: true });

      const curated = await this.#curator.curate(ranked, {
        nowPlaying: this.nowPlaying,
        recentlyPlayed: this.recentlyPlayed,
        want: this.#config.dj.queueTarget,
        mood: this.mood,
      });

      const ordered = sequence(curated ?? ranked, this.#config, {
        recentArtists: this.recentArtists,
        backfill: ranked,
      });

      this.queue.push(...ordered);
      debug(`queue refilled → ${this.queue.length} tracks${curated ? ' (LLM-sequenced)' : ''}`);
      this.emit('refilled', this.queue.length, Boolean(curated));
      this.#prefetch();
      // Detached on purpose. Enrich the whole shortlist, not just the queued
      // tracks: the ones that lost this round are the likeliest candidates
      // next round, and by then their features will be cached.
      this.#enricher?.enrich(fresh);
    } catch (err) {
      warn(`refill failed: ${err.message}`);
      this.emit('refill-error', err);
    }
    return undefined;
  }

  get config() {
    return this.#config;
  }

  async stop() {
    this.#stopped = true;
    await this.#finishCurrent({ skipped: false }).catch(() => {});
    await this.#scrobbler.flush().catch(() => {});
  }
}
