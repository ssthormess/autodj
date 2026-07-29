import { buildApp } from '../app.js';
import { loadConfig, saveConfig, merge } from '../config/config.js';
import { createTui } from '../ui/tui.js';
import { resolveMode } from '../dj/modes.js';
import { setVerbose, setSink } from '../util/log.js';
import { createResourceSampler } from '../util/resources.js';
import { fetchCoverCells, defaultCoverCells } from '../ui/cover.js';
import { createLevelReader } from '../player/levels.js';
import { createLyricsSource } from '../lyrics/lrclib.js';
import { createVoice } from '../announce/say.js';
import { createHourlyClock } from '../announce/clock.js';

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

  // Measures this process plus mpv. mpv is polled on a slow cadence so the
  // meter does not become a noticeable share of what it reports.
  const resources = createResourceSampler({ pidOf: () => player.pid });

  // Reads mpv's own loudness metadata, so the meter shows the real signal
  // and a paused track reads as silence.
  const levels = createLevelReader((prop) => player.getProperty(prop));
  let levelSample = null;

  // Synced lyrics, fetched per track. Never awaited by playback.
  const lyricsSource = createLyricsSource();
  let lyrics = null;

  // Log output is captured, never printed: a stray write from a background
  // lane would corrupt the frame.
  const messages = [];
  const push = (level, text) => {
    const at = new Date();
    const stamp = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}:${String(at.getSeconds()).padStart(2, '0')}`;
    messages.push({ level, text: `${stamp}  ${text}` });
    if (messages.length > 200) messages.shift();
  };

  // Captured library warnings land here too, but they are rare — a panel that
  // only ever shows failures reads as broken when everything is fine. What
  // belongs here is what the DJ is actually doing.
  setSink(push);
  const activity = (text) => push('info', text);

  const name = (t) => `${t.artist} — ${t.name}`;

  /**
   * La hora en punto, encima de la música.
   *
   * `say` sale por la misma salida de audio que mpv, así que la música baja
   * mientras habla y vuelve después — como en una emisora, no cortando. Se
   * restaura al nivel que hubiera antes, no a tope: si el booster estaba
   * haciendo su propio fundido, subir a 1 lo desharía.
   */
  const voice = createVoice(config.announce);
  await voice.check();

  const clock = createHourlyClock({
    enabled: config.announce.enabled && voice.isAvailable(),
    station: config.announce.station || null,
    announce: async (text) => {
      activity(`hora       ${text}`);
      const before = player.fadeGain;
      await player.fadeTo(config.announce.duckLevel, 0.6).catch(() => {});
      await voice.speak(text);
      await player.fadeTo(before, 0.8).catch(() => {});
    },
  });

  if (config.announce.enabled && !voice.isAvailable()) {
    push('warn', `voz "${config.announce.voice}" no instalada — sin avisos de hora`);
  }

  engine.on('scrobbled', (t) => {
    scrobbled = true;
    activity(`scrobbled  ${name(t)}`);
  });
  // Artwork is fetched per track and rendered into the card. Deliberately not
  // awaited: playback must never wait on a thumbnail.
  let cover = null;
  // Artwork is rendered to a fixed grid of cells, so it has to be drawn at the
  // size the card actually ended up — which changes with the window.
  let coverSize = { columns: 18, rows: 9 };

  /** Draw the current track's artwork at `coverSize`, placeholder first. */
  function paintCover(t) {
    if (!t) return;
    // Fall back immediately to generated art, then replace it if real
    // artwork arrives — the card never sits empty.
    cover = defaultCoverCells(`${t.artist}::${t.album ?? ''}`, coverSize);
    if (!t.image) return;
    fetchCoverCells(t.image, coverSize)
      .then((cells) => {
        // Guard against a slow fetch landing after the track moved on, and
        // keep the placeholder when the release genuinely has no art.
        if (cells && engine.nowPlaying === t) cover = cells;
      })
      .catch(() => {});
  }

  engine.on('playing', (t) => {
    scrobbled = false;
    stage = null;
    paintCover(t);
    levels.reset();
    lyrics = null;
    lyricsSource
      .fetchFor(t)
      .then((found) => {
        // Discard a slow lookup that lands after the track has moved on.
        if (engine.nowPlaying === t) lyrics = found ?? { instrumental: false, synced: [], plain: null };
      })
      .catch(() => {});
    activity(`playing    ${name(t)}  (${t.curated ? 'llm' : t.source ?? '?'})`);
  });
  engine.on('refilling', () => { stage = 'refilling'; activity('refilling the queue…'); });
  engine.on('refilled', (n, llm) => {
    stage = `+${n}${llm ? ' llm' : ''}`;
    activity(`queued ${n} tracks${llm ? ', LLM-sequenced' : ''}`);
  });
  engine.on('skipped', (t, at) => activity(`skipped    ${name(t)} at ${Math.round(at)}s (downvoted)`));
  engine.on('voted', (t, dir) => activity(`${dir > 0 ? 'upvoted   ' : 'downvoted '} ${name(t)}`));
  engine.on('loved', (t) => activity(`loved      ${name(t)}`));
  engine.on('boost', (d) => activity(`boost: advancing in ${d.toFixed(0)}s`));
  engine.on('boost-toggled', (on) => activity(`scrobble booster ${on ? 'ON' : 'OFF'}`));
  engine.on('mood-resolving', (m) => {
    stage = `working out what "${m}" means…`;
    activity(`mood "${m}" — resolving to searchable genres/artists`);
  });
  engine.on('mood', (m, steer) => {
    if (!m) return activity('mood cleared — back to your history');
    if (!steer) return push('warn', `mood "${m}" matched nothing searchable; using your history`);
    const t = steer.tags.map((x) => x.name).join(', ') || 'none';
    const a = steer.artists.map((x) => x.name).join(', ') || 'none';
    return activity(`mood "${m}" → tags: ${t} | artists: ${a}`);
  });
  engine.on('unplayable', (t) => {
    stage = `no match for ${t.artist}`;
    push('warn', `no playable match for ${name(t)}`);
  });
  engine.on('refill-error', (err) => {
    stage = `refill failed: ${err.message}`;
    push('error', `refill failed: ${err.message}`);
  });
  engine.on('empty', () => {
    stage = 'no candidates — see autodj doctor';
    push('error', 'no candidates found — run: autodj doctor');
  });

  if (mood) engine.mood = mood;

  /**
   * Volume is a preference, not a runtime flag, so it is written back to
   * config and restored next launch. The write is debounced because holding
   * +/- would otherwise hit the disk on every keypress, and only the stored
   * file is touched — never the in-memory overrides, which is how a one-off
   * `--no-llm` once became permanent.
   */
  let volumeWrite = null;
  const persistVolume = (value) => {
    if (volumeWrite) clearTimeout(volumeWrite);
    volumeWrite = setTimeout(() => {
      volumeWrite = null;
      try {
        saveConfig(merge(loadConfig(), { player: { volume: value } }));
      } catch {
        /* a failed preference write must never interrupt playback */
      }
    }, 1200);
  };

  const setVolume = (next) => {
    volume = Math.max(0, Math.min(config.player.maxVolume, next));
    persistVolume(volume);
    return player.setVolume(volume);
  };

  const actions = {
    pause: () => player.togglePause(),
    // `n` rejects the track; the right arrow simply moves on.
    skip: () => engine.skip(),
    advance: () => engine.advance(),
    voteUp: () => engine.vote(+1),
    voteDown: () => engine.vote(-1),
    love: () => engine.love(),
    undoVote: () => {
      const entry = engine.undoVote();
      activity(entry ? `undid      ${entry.direction > 0 ? 'upvote' : 'downvote'} on ${entry.label}` : 'nothing to undo');
    },
    ban: () => { engine.ban(); return engine.skip(); },
    boost: () => engine.toggleBoost(),
    refill: () => engine.refill(),
    volumeUp: () => setVolume(volume + config.player.volumeStep),
    volumeDown: () => setVolume(volume - config.player.volumeStep),
    volumeUpCoarse: () => setVolume(volume + config.player.volumeCoarseStep),
    volumeDownCoarse: () => setVolume(volume - config.player.volumeCoarseStep),
    mood: async () => {
      const answer = await tui.prompt('mood / direction (blank clears)');
      await engine.setMood(answer);
    },
    theme: () => {
      const name = tui.cycleTheme();
      try {
        saveConfig(merge(loadConfig(), { ui: { theme: name } }));
      } catch { /* a failed preference write must not interrupt playback */ }
      activity(`theme: ${name}`);
    },
    queueDown: () => {
      const i = tui.moveQueueSelection(1, engine.queue.length);
      const t = engine.queue[i];
      if (t) stage = `selected: ${t.artist} — ${t.name}`;
    },
    queueUp: () => {
      const i = tui.moveQueueSelection(-1, engine.queue.length);
      const t = engine.queue[i];
      if (t) stage = `selected: ${t.artist} — ${t.name}`;
    },
    previous: () => engine.previous(),
    announce: () => {
      const on = clock.toggle();
      activity(
        on
          ? `avisos de hora ON — próximo: "${clock.preview()}" en ${Math.round(clock.nextIn() / 60000)} min`
          : 'avisos de hora OFF',
      );
    },
    queuePlay: () => engine.playAt(tui.selectedQueueIndex()),
    queueMenu: () => {
      if (engine.queue.length) tui.openContextMenu(tui.selectedQueueIndex());
    },
    logUp: () => tui.scrollLog(-3),
    logDown: () => tui.scrollLog(3),
    quit: () => shutdown(),
  };

  /**
   * The Mac's transport buttons.
   *
   * Deliberately mapped to the consequence-free moves: a hardware next button
   * is navigation, not a rejection, so it advances rather than downvoting the
   * way `n` does. Stop pauses instead of quitting — a stray press on a headset
   * should not tear down the session and lose the queue.
   */
  const mediaActions = {
    playpause: () => player.togglePause(),
    play: () => player.togglePause(),
    pause: () => player.togglePause(),
    next: () => engine.advance(),
    prev: () => engine.previous(),
    stop: () => player.togglePause(),
  };

  player.on('media-key', (action) => {
    activity(`media key   ${action}`);
    Promise.resolve(mediaActions[action]?.()).catch(() => {});
  });

  const tui = createTui({
    mode: mode.label,
    theme: config.ui.theme,
    // A resize changes how much of the card the artwork gets, and half-block
    // cells can't be scaled after the fact — so redraw at the new size.
    onCoverSize: (size) => {
      coverSize = size;
      paintCover(engine.nowPlaying);
    },
    onKey: (name) => Promise.resolve(actions[name]?.()).catch(() => {}),
    onSelectTrack: (index) => engine.playAt(index).catch(() => {}),
    onContextAction: (index, action) => {
      const track = engine.queue[index];
      if (!track) return;
      const label = `${track.artist} — ${track.name}`;
      if (action === 'remove') {
        engine.removeAt(index);
        activity(`removed    ${label} (no opinion recorded)`);
      } else if (action === 'downvote') {
        engine.downvoteAt(index);
        activity(`downvoted  ${label}`);
      } else if (action === 'ban') {
        engine.banAt(index);
        activity(`banned     ${label} — will never be queued again`);
      }
    },
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
      maxVolume: config.player.maxVolume,
      queue: engine.queue,
      stats: history.stats(),
      mood: engine.mood,
      stage,
      messages,
      scrobbled,
      cover,
      levels: levelSample,
      lyrics,
      boost: engine.boostEnabled,
      boostAt: engine.boostAt,
      resources: resources.sample(),
    });
  }

  const timer = setInterval(async () => {
    if (quitting) return;
    await engine.tick().catch(() => {});
    levelSample = await levels.sample().catch(() => levelSample);
    await draw();
  }, 1000);

  // Scrolling text needs a far finer cadence than the once-a-second state
  // poll, but nothing it draws depends on the player — so it repaints the text
  // lines alone rather than dragging three IPC reads along with it.
  let frame = 0;
  const marqueeTimer = setInterval(() => {
    if (quitting) return;
    frame += 1;
    tui.animate(frame);
  }, 90);

  async function shutdown() {
    if (quitting) return;
    quitting = true;
    clearInterval(timer);
    clearInterval(marqueeTimer);
    clock.stop();
    if (volumeWrite) {
      clearTimeout(volumeWrite);
      try { saveConfig(merge(loadConfig(), { player: { volume } })); } catch { /* best effort */ }
    }
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

  activity(`autodj started — mode ${mode.label}`);
  await draw();
  // Apply the stored level without rewriting it straight back.
  await player.setVolume(volume);

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
