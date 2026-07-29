import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const CONFIG_DIR = join(homedir(), '.config', 'autodj');
export const CACHE_DIR = join(CONFIG_DIR, 'cache');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const HISTORY_FILE = join(CONFIG_DIR, 'history.json');
export const IPC_SOCKET = join(CONFIG_DIR, 'mpv.sock');

/** Path of the Pear Desktop config we can lift Last.fm credentials from. */
export const PEAR_CONFIG = join(
  homedir(),
  'Library',
  'Application Support',
  'YouTube Music',
  'config.json',
);

export function ensureDirs() {
  mkdirSync(CACHE_DIR, { recursive: true });
}
