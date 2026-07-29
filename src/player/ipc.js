import net from 'node:net';
import { EventEmitter } from 'node:events';

/**
 * mpv's JSON IPC: newline-delimited JSON over a unix socket. Commands carry a
 * request_id and are answered out of band; anything without one is an event.
 */
export class MpvIpc extends EventEmitter {
  #socket = null;
  #buffer = '';
  #nextId = 1;
  #pending = new Map();

  async connect(socketPath, { retries = 40, delayMs = 100 } = {}) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        this.#socket = await new Promise((resolve, reject) => {
          const s = net.createConnection(socketPath);
          s.once('connect', () => resolve(s));
          s.once('error', reject);
        });
        break;
      } catch {
        // mpv may not have created the socket yet.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (!this.#socket) throw new Error('could not connect to mpv IPC socket');

    this.#socket.setEncoding('utf8');
    this.#socket.on('data', (chunk) => this.#onData(chunk));
    this.#socket.on('close', () => this.emit('close'));
    this.#socket.on('error', (err) => this.emit('error', err));
    return this;
  }

  #onData(chunk) {
    this.#buffer += chunk;
    let index = this.#buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line) this.#dispatch(line);
      index = this.#buffer.indexOf('\n');
    }
  }

  #dispatch(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.request_id !== undefined && this.#pending.has(message.request_id)) {
      const { resolve, reject } = this.#pending.get(message.request_id);
      this.#pending.delete(message.request_id);
      if (message.error && message.error !== 'success') reject(new Error(message.error));
      else resolve(message.data);
      return;
    }

    if (message.event) this.emit(message.event, message);
    this.emit('message', message);
  }

  command(...args) {
    if (!this.#socket) return Promise.reject(new Error('mpv IPC not connected'));
    const request_id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(request_id, { resolve, reject });
      this.#socket.write(`${JSON.stringify({ command: args, request_id })}\n`);
      setTimeout(() => {
        if (this.#pending.has(request_id)) {
          this.#pending.delete(request_id);
          reject(new Error(`mpv command timed out: ${args[0]}`));
        }
      }, 10000);
    });
  }

  get = (property) => this.command('get_property', property);
  set = (property, value) => this.command('set_property', property, value);
  observe = (id, property) => this.command('observe_property', id, property);

  close() {
    this.#socket?.end();
    this.#socket = null;
  }
}
