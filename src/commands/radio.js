import { buildApp } from '../app.js';
import { attachKeys } from '../ui/keys.js';
import { renderNowPlaying } from '../ui/render.js';
import { CLEAR, SHOW_CURSOR } from '../ui/ansi.js';
import { resolveMode } from '../dj/modes.js';
import { setVerbose, info } from '../util/log.js';

/**
 * The continuous set. One render timer drives the screen and the mid-track
 * scrobble check; everything else is event-driven off the engine.
 */
export async function radio({
  mood = null, seedQuery = null, verbose = false, noLlm = false, mode: modeName = null,
} = {}) {
  setVerbose(verbose);

  const mode = resolveMode(modeName);
  const { config, engine, player, history, scrobbler, sources } = await buildApp({
    overrides: {
      ...(noLlm ? { llm: { enabled: false } } : {}),
      dj: { familiarRatio: mode.familiarRatio },
      mode,
    },
  });

  let volume = config.player.volume;
  let scrobbled = false;
  let quitting = false;

  engine.on('scrobbled', () => {
    scrobbled = true;
  });
  engine.on('playing', () => {
    scrobbled = false;
  });

  if (mood) engine.mood = mood;

  // A seed query starts the set from a specific track instead of your history.
  if (seedQuery) {
    const [artist, ...rest] = seedQuery.split(' - ');
    const seedTrack = rest.length
      ? { artist: artist.trim(), name: rest.join(' - ').trim() }
      : null;
    if (seedTrack) {
      const resolved = await sources.searcher.resolve(seedTrack).catch(() => null);
      if (resolved) engine.queue.push({ ...seedTrack, videoId: resolved.id, source: 'seed' });
    }
  }

  await engine.next();

  const keys = attachKeys({
    space: () => player.togglePause(),
    n: () => engine.skip(),
    right: () => engine.skip(),
    l: () => engine.love().catch(() => {}),
    b: () => {
      engine.ban();
      return engine.skip();
    },
    up: () => engine.vote(+1).catch(() => {}),
    down: () => engine.vote(-1).catch(() => {}),
    r: () => engine.refill(),
    m: async () => {
      const answer = await keys.prompt('\n  mood / direction (blank to clear): ');
      await engine.setMood(answer);
    },
    '+': () => {
      volume = Math.min(130, volume + 5);
      return player.setVolume(volume);
    },
    '=': () => {
      volume = Math.min(130, volume + 5);
      return player.setVolume(volume);
    },
    '-': () => {
      volume = Math.max(0, volume - 5);
      return player.setVolume(volume);
    },
    q: () => shutdown(),
    quit: () => shutdown(),
  });

  const timer = setInterval(async () => {
    if (quitting) return;
    await engine.tick().catch(() => {});

    const [position, duration, paused] = await Promise.all([
      player.position().catch(() => 0),
      player.duration().catch(() => null),
      player.isPaused().catch(() => false),
    ]);

    process.stdout.write(
      renderNowPlaying({
        track: engine.nowPlaying,
        position,
        duration: duration ?? engine.nowPlaying?.duration ?? null,
        paused,
        queue: engine.queue,
        stats: history.stats(),
        mood: engine.mood,
        mode: mode.label,
        scrobbled,
      }),
    );
  }, 1000);

  async function shutdown() {
    if (quitting) return;
    quitting = true;
    clearInterval(timer);
    keys.detach();
    process.stdout.write(CLEAR + SHOW_CURSOR);
    info('saving…');
    await engine.stop().catch(() => {});
    const flushed = await scrobbler.flush().catch(() => 0);
    if (flushed) info(`flushed ${flushed} pending scrobble(s)`);
    player.quit();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
