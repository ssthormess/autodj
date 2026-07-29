import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { debug } from '../util/log.js';

const run = promisify(execFile);

/**
 * macOS speech synthesis.
 *
 * `say` blocks until it has finished speaking, which is what makes the ducking
 * around it correct without having to guess at a duration.
 */
export function createVoice({ voice = 'Mónica', rate = null } = {}) {
  let available = process.platform === 'darwin';

  /** Is this voice actually installed? Answered once, then remembered. */
  async function check() {
    if (!available) return false;
    try {
      const { stdout } = await run('say', ['-v', '?']);
      // The listing puts the name first, padded, then the locale.
      const names = stdout.split('\n').map((line) => line.split(/\s{2,}/)[0].trim());
      if (!names.includes(voice)) {
        debug(`voice not installed: ${voice}`);
        available = false;
      }
    } catch {
      available = false;
    }
    return available;
  }

  async function speak(text) {
    if (!available || !text) return false;
    try {
      await run('say', ['-v', voice, ...(rate ? ['-r', String(rate)] : []), text]);
      return true;
    } catch (err) {
      debug(`say failed: ${err.message.split('\n')[0]}`);
      return false;
    }
  }

  return { speak, check, isAvailable: () => available };
}
