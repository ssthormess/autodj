import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CACHE_DIR, ensureDirs } from '../config/paths.js';

const keyOf = (namespace, input) =>
  `${namespace}-${createHash('sha1').update(input).digest('hex').slice(0, 20)}.json`;

export function readCache(namespace, input, ttlSeconds) {
  ensureDirs();
  const file = join(CACHE_DIR, keyOf(namespace, input));
  if (!existsSync(file)) return null;
  try {
    const { at, value } = JSON.parse(readFileSync(file, 'utf8'));
    if ((Date.now() - at) / 1000 > ttlSeconds) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeCache(namespace, input, value) {
  ensureDirs();
  writeFileSync(
    join(CACHE_DIR, keyOf(namespace, input)),
    JSON.stringify({ at: Date.now(), value }),
  );
  return value;
}
