import readline from 'node:readline';
import { SHOW_CURSOR, HIDE_CURSOR } from './ansi.js';

/**
 * Raw-mode key handling. `prompt()` temporarily drops out of raw mode so the
 * user can type a full line (used for mood and search), then restores it.
 */
export function attachKeys(handlers) {
  if (!process.stdin.isTTY) return { detach: () => {}, prompt: async () => null };

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(HIDE_CURSOR);

  let suspended = false;

  const onKeypress = (str, key) => {
    if (suspended) return;
    if (key.ctrl && key.name === 'c') return handlers.quit?.();
    const handler = handlers[key.name] ?? handlers[str];
    return handler?.();
  };

  process.stdin.on('keypress', onKeypress);

  async function prompt(question) {
    suspended = true;
    process.stdin.setRawMode(false);
    process.stdout.write(SHOW_CURSOR);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    rl.close();

    process.stdin.setRawMode(true);
    process.stdout.write(HIDE_CURSOR);
    process.stdin.resume();
    suspended = false;
    return answer.trim() || null;
  }

  function detach() {
    process.stdin.off('keypress', onKeypress);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write(SHOW_CURSOR);
    process.stdin.pause();
  }

  return { detach, prompt };
}
