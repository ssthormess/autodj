import { buildApp } from '../app.js';
import { createTui } from '../ui/tui.js';
import { resolveMode } from '../dj/modes.js';
import { setVerbose, setSink } from '../util/log.js';

/**
 * The continuous set.
 *
 * The screen is driven by a single timer; everything else is event-driven off
 * the engine. Playback starts before the first full refill completes, because
 * a refill runs a dozen network lanes plus an LLM pass and takes close to a
 * minute — far too long to sit in silence.
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
  let stage = 'starting';

  // Log output is captured, never printed: a stray write from a background
  // lane would corrupt the frame.
  const messages = [];
  setSink((level, text) => {
    messages.push({ level, text });
    if (messages.length > 200) messages.shift();
  });

  engine.on('scrobbled', () => { scrobbled = true; });
  engine.on('playing', () => { scrobbled = false; stage = null; });
  engine.on('refilling', () => { stage = 'refilling'; });
  engine.on('refilled', (n, llm) => { stage = `+${n}${llm ? ' llm' : ''}`; });
  engine.on('unplayable', (t) => { stage = `no match for ${t.artist}`; });
  engine.on('refill-error', (err) => { stage = `refill failed: ${err.message}`; });
  engine.on('empty', () => { stage = 'no candidates — see autodj doctor'; });

  if (mood) engine.mood = mood;

  const setVolume = (next) => {
    volume = Math.max(0, Math.min(130, next));
    return player.setVolume(volume);
  };

  const actions = {
    pause: () => player.togglePause(),
    skip: () => engine.skip(),
    voteUp: () => engine.vote(+1),
    voteDown: () => engine.vote(-1),
    love: () => engine.love(),
    ban: () => { engine.ban(); return engine.skip(); },
    refill: () => engine.refill(),
    volumeUp: () => setVolume(volume + 5),
    volumeDown: () => setVolume(volume - 5),
    mood: async () => {
      const answer = await tui.prompt('mood / direction (blank clears)');
      await engine.setMood(answer);
    },
    quit: () => shutdown(),
  };

  const tui = createTui({
    mode: mode.label,
    onKey: (name) => Promise.resolve(actions[name]?.()).catch(() => {}),
  });

  async function draw() {
    const [position, duration, paused] = await Promise.all([
      player.position().catch(() => 0),
      player.duration().catch(() => null),
      player.isPaused().catch(() => false),
    ]);

    tui.render({
      track: engine.nowPlaying,
      position,
      duration: duration ?? engine.nowPlaying?.duration ?? null,
      paused,
      volume,
      queue: engine.queue,
      stats: history.stats(),
      mood: engine.mood,
      stage,
      messages,
      scrobbled,
    });
  }

  const timer = setInterval(async () => {
    if (quitting) return;
    await engine.tick().catch(() => {});
    await draw();
  }, 1000);

  async function shutdown() {
    if (quitting) return;
    quitting = true;
    clearInterval(timer);
    setSink(null);
    tui.destroy();
    await engine.stop().catch(() => {});
    const flushed = await scrobbler.flush().catch(() => 0);
    if (flushed) console.log(`flushed ${flushed} pending scrobble(s)`);
    player.quit();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await draw();
  await setVolume(volume);

  // A seed query overrides both the quick start and the first refill.
  if (seedQuery) {
    const [artist, ...rest] = seedQuery.split(' - ');
    if (rest.length) {
      const seedTrack = { artist: artist.trim(), name: rest.join(' - ').trim() };
      const resolved = await sources.searcher.resolve(seedTrack).catch(() => null);
      if (resolved) engine.queue.push({ ...seedTrack, videoId: resolved.id, source: 'seed' });
    }
  }

  // Start audible quickly, then let the real queue build behind it.
  (async () => {
    const quick = await engine.quickStart().catch(() => null);
    if (!quick) {
      stage = 'building the first set';
      await engine.next();
    }
  })().catch((err) => { stage = `failed to start: ${err.message}`; });
}
