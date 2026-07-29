/**
 * Colour themes.
 *
 * Every widget reads from the active theme rather than naming colours inline,
 * so a theme is a single object and adding one costs nothing.
 */
export const THEMES = {
  midnight: {
    label: 'midnight',
    accent: 'cyan',
    accent2: 'magenta',
    border: 'gray',
    borderActive: 'cyan',
    bar: 'green',
    volume: 'yellow',
    warn: 'yellow',
    error: 'red',
    ok: 'green',
    dim: 'gray',
    vis: ['green', 'green', 'yellow', 'yellow', 'red'],
  },
  amber: {
    label: 'amber',
    accent: 'yellow',
    accent2: 'red',
    border: 'yellow',
    borderActive: 'yellow',
    bar: 'yellow',
    volume: 'yellow',
    warn: 'yellow',
    error: 'red',
    ok: 'yellow',
    dim: 'gray',
    vis: ['yellow', 'yellow', 'yellow', 'red', 'red'],
  },
  // The classic Winamp look: green on black with a red top end.
  winamp: {
    label: 'winamp',
    accent: 'green',
    accent2: 'green',
    border: 'green',
    borderActive: 'green',
    bar: 'green',
    volume: 'green',
    warn: 'yellow',
    error: 'red',
    ok: 'green',
    dim: 'gray',
    vis: ['green', 'green', 'green', 'yellow', 'red'],
  },
  mono: {
    label: 'mono',
    accent: 'white',
    accent2: 'white',
    border: 'gray',
    borderActive: 'white',
    bar: 'white',
    volume: 'white',
    warn: 'white',
    error: 'white',
    ok: 'white',
    dim: 'gray',
    vis: ['gray', 'gray', 'white', 'white', 'white'],
  },
};

export const themeNames = Object.keys(THEMES);

export function resolveTheme(name) {
  return THEMES[String(name ?? '').toLowerCase()] ?? THEMES.midnight;
}

/** Next theme in the list, for cycling with a key. */
export function nextTheme(current) {
  const index = themeNames.indexOf(current);
  return themeNames[(index + 1) % themeNames.length];
}
