import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DEFAULTS } from './defaults.js';
import { CONFIG_FILE, ensureDirs } from './paths.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep merge that never mutates either operand. */
export function merge(base, override) {
  if (!isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(base?.[key]) ? merge(base[key], value) : value;
  }
  return out;
}

export function loadConfig() {
  ensureDirs();
  if (!existsSync(CONFIG_FILE)) return structuredClone(DEFAULTS);
  try {
    return merge(DEFAULTS, JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

/**
 * Everything in `full` that differs from `base`. Empty branches are pruned.
 */
export function diff(base, full) {
  if (!isPlainObject(full) || !isPlainObject(base)) return full;
  const out = {};
  for (const [key, value] of Object.entries(full)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      const nested = diff(base[key], value);
      if (Object.keys(nested).length) out[key] = nested;
    } else if (JSON.stringify(value) !== JSON.stringify(base[key])) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Persist only what the user actually changed. Writing the fully-resolved
 * config would freeze today's defaults into the file forever, so later
 * improvements to DEFAULTS would never reach an existing install.
 */
export function saveConfig(config) {
  ensureDirs();
  const delta = diff(DEFAULTS, config);
  writeFileSync(CONFIG_FILE, `${JSON.stringify(delta, null, 2)}\n`);
  return merge(DEFAULTS, delta);
}
