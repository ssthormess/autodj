/**
 * Play modes decide which lanes run and how the scorer trades novelty against
 * familiarity. They are presets over the same engine, not separate code paths.
 */
export const MODES = {
  /** Default: everything on, balanced. */
  mix: {
    label: 'mix',
    description: 'blend of your history, both recommendation feeds and exploration',
    familiarRatio: 0.35,
    noveltyBonus: 0.9,
    familiarityCap: 40,
    // null = no filter
    require: null,
    lanes: null,
  },

  /** Nothing you have ever scrobbled. */
  discover: {
    label: 'discover',
    description: 'only tracks you have never played',
    familiarRatio: 0,
    noveltyBonus: 2.2,
    familiarityCap: 0,
    require: (track) => (track.userPlaycount ?? 0) === 0,
    // Lanes that reach outside your existing graph carry this mode.
    lanes: ['lastfm-recommended', 'ytm-rec', 'lb-cf', 'lb-similar', 'tag', 'similar-track', 'similar-artist'],
  },

  /** Your own most-played material. */
  hits: {
    label: 'hits',
    description: 'your top played tracks only',
    familiarRatio: 1,
    noveltyBonus: -1.5,
    familiarityCap: Infinity,
    require: (track) => (track.userPlaycount ?? 0) > 0,
    lanes: ['user-top', 'lastfm-library', 'ytm-liked', 'loved'],
  },

  /** Album tracks by artists you know, rather than their singles. */
  deep: {
    label: 'deep',
    description: 'deep cuts — known artists, unknown songs',
    familiarRatio: 0.1,
    noveltyBonus: 1.4,
    familiarityCap: 5,
    require: (track) => (track.userPlaycount ?? 0) <= 2,
    // Deep cuts come from a small set of artists by definition — a cap of one
    // per set would leave the queue half empty.
    artistMaxPerSet: 2,
    lanes: ['artist-deep', 'similar-track', 'lb-similar', 'lastfm-recommended'],
  },
};

export const modeNames = Object.keys(MODES);

export function resolveMode(name) {
  if (!name) return MODES.mix;
  const mode = MODES[name.toLowerCase()];
  if (!mode) throw new Error(`unknown mode "${name}" — try: ${modeNames.join(', ')}`);
  return mode;
}

/** Merge a mode's overrides into the running config. */
export function applyMode(config, mode) {
  return {
    ...config,
    dj: { ...config.dj, familiarRatio: mode.familiarRatio },
    mode,
  };
}
