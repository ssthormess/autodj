import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { MpvIpc } from './ipc.js';
import { IPC_SOCKET } from '../config/paths.js';
import { debug } from '../util/log.js';
import { toMpvVolume } from './volume.js';
import { createFader } from './fade.js';
import { VIS_FILTER } from './levels.js';
import { bindMediaKeys, mediaAction } from './mediaKeys.js';

/**
 * Audio-only mpv, driven over IPC.
 *
 * mpv resolves YouTube URLs through its bundled ytdl hook, so we hand it the
 * watch URL rather than a pre-extracted stream — pre-extracted URLs expire
 * mid-track and mpv can re-resolve on its own.
 */
export class Player extends EventEmitter {
  #process = null;
  #ipc = null;
  #config;
  // Your level, and the fade multiplier applied on top of it.
  #baseVolume;
  #fader;

  constructor(config) {
    super();
    this.#config = config;
    this.#baseVolume = config.player.volume;
    this.#fader = createFader({
      apply: (gain) => this.#pushVolume(gain),
    });
  }

  /** Send base × fade to mpv, converted onto mpv's cubic scale. */
  #pushVolume(gain = this.#fader.current()) {
    const effective = this.#baseVolume * gain;
    return this.#ipc
      ?.set('volume', toMpvVolume(effective, this.#config.player.maxVolume))
      .catch(() => {});
  }

  /** Ramp the fade multiplier. Leaves the chosen level untouched. */
  fadeTo(target, seconds) {
    return this.#fader.to(target, seconds);
  }

  /** Cancel any ramp and restore full level immediately. */
  cancelFade() {
    return this.#fader.set(1);
  }

  get fadeGain() {
    return this.#fader.current();
  }

  async start() {
    if (existsSync(IPC_SOCKET)) unlinkSync(IPC_SOCKET);

    const { binary, args } = this.#config.player;
    this.#process = spawn(
      binary,
      [
        ...args,
        // The configured number is a share of full amplitude; mpv's own scale
        // is cubic, so it has to be converted rather than passed through.
        `--volume=${toMpvVolume(this.#config.player.volume).toFixed(2)}`,
        // mpv keeps only the last --af it is given, so every filter has to
        // travel in one chain. Normalisation runs first; the meter measures
        // what actually reaches the speakers.
        ...(this.#audioFilters().length ? [`--af=${this.#audioFilters().join(',')}`] : []),
        `--input-ipc-server=${IPC_SOCKET}`,
        // Stated rather than assumed: this is mpv's default, but a user's
        // mpv.conf can turn it off, and without it the Mac's play/pause and
        // next/prev buttons never reach us at all.
        '--input-media-keys=yes',
        '--ytdl=yes',
        '--ytdl-format=bestaudio[ext=m4a]/bestaudio/best',
        // Keep playback smooth over flaky connections.
        '--cache=yes',
        '--cache-secs=60',
        '--demuxer-max-bytes=64MiB',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );

    this.#process.stderr.on('data', (d) => debug(`mpv: ${String(d).trim()}`));
    this.#process.on('exit', (code) => this.emit('exit', code));

    this.#ipc = await new MpvIpc().connect(IPC_SOCKET);
    this.#ipc.on('end-file', (m) => this.emit('end-file', m));
    this.#ipc.on('file-loaded', () => this.emit('file-loaded'));
    this.#ipc.on('error', (err) => debug(`mpv ipc: ${err.message}`));
    await this.#ipc.observe(1, 'time-pos');
    await this.#ipc.observe(2, 'pause');
    this.#ipc.on('property-change', (m) => this.emit('property', m.name, m.data));

    // Hardware transport buttons arrive as client-messages once rebound.
    this.#ipc.on('client-message', (m) => {
      const action = mediaAction(m);
      if (action) this.emit('media-key', action);
    });
    this.mediaKeys = await bindMediaKeys(this.#ipc);
    debug(`media keys bound: ${this.mediaKeys.join(', ') || 'none'}`);

    return this;
  }

  /**
   * What macOS shows in Control Center and on the lock screen.
   *
   * Without this the Now Playing widget above the transport buttons reads out
   * the YouTube video title, which is often decorated well past recognition.
   */
  setMediaTitle = (title) => this.#ipc?.set('force-media-title', title).catch(() => {});

  /** Back to the top of the current track. */
  restart = () => this.#ipc.command('seek', 0, 'absolute');

  /** mpv's pid, for the resource meter. Null before start() or after quit(). */
  get pid() {
    return this.#process?.pid ?? null;
  }

  /**
   * The audio filter chain, in order.
   *
   * mpv keeps only the last `--af` it is given, so every filter has to travel
   * in a single chain — passing two separate flags silently discards the
   * first. Normalisation runs first so the meter measures what actually
   * reaches the speakers.
   */
  #audioFilters() {
    const filters = [];
    const norm = this.#config.player.normalize;
    if (norm?.enabled) {
      filters.push(`lavfi=[loudnorm=I=${norm.target}:TP=${norm.truePeak}:LRA=${norm.range}]`);
    }
    if (this.#config.ui?.visualizer !== false) filters.push(VIS_FILTER);
    return filters;
  }

  /** Raw property read, used by the level meter. */
  getProperty = (name) => this.#ipc.get(name);

  play = (url) => this.#ipc.command('loadfile', url, 'replace');
  stop = () => this.#ipc.command('stop');
  togglePause = () => this.#ipc.command('cycle', 'pause');
  seek = (seconds) => this.#ipc.command('seek', seconds, 'relative');
  /** Takes the displayed percentage; the active fade still applies on top. */
  setVolume = (displayed) => {
    this.#baseVolume = Math.max(0, Math.min(this.#config.player.maxVolume, displayed));
    return this.#pushVolume();
  };

  async position() {
    try {
      return (await this.#ipc.get('time-pos')) ?? 0;
    } catch {
      return 0;
    }
  }

  async duration() {
    try {
      return (await this.#ipc.get('duration')) ?? null;
    } catch {
      return null;
    }
  }

  async isPaused() {
    try {
      return Boolean(await this.#ipc.get('pause'));
    } catch {
      return false;
    }
  }

  quit() {
    this.#fader.clear();
    try {
      this.#ipc?.command('quit');
    } catch {
      /* mpv may already be gone */
    }
    this.#ipc?.close();
    this.#process?.kill('SIGTERM');
    if (existsSync(IPC_SOCKET)) {
      try {
        unlinkSync(IPC_SOCKET);
      } catch {
        /* best effort */
      }
    }
  }
}
