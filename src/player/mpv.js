import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { MpvIpc } from './ipc.js';
import { IPC_SOCKET } from '../config/paths.js';
import { debug } from '../util/log.js';
import { toMpvVolume } from './volume.js';

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

  constructor(config) {
    super();
    this.#config = config;
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
        `--input-ipc-server=${IPC_SOCKET}`,
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

    return this;
  }

  /** mpv's pid, for the resource meter. Null before start() or after quit(). */
  get pid() {
    return this.#process?.pid ?? null;
  }

  play = (url) => this.#ipc.command('loadfile', url, 'replace');
  stop = () => this.#ipc.command('stop');
  togglePause = () => this.#ipc.command('cycle', 'pause');
  seek = (seconds) => this.#ipc.command('seek', seconds, 'relative');
  /** Takes the displayed percentage; converts to mpv's cubic scale. */
  setVolume = (displayed) =>
    this.#ipc.set('volume', toMpvVolume(displayed, this.#config.player.maxVolume));

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
