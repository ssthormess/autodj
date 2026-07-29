/**
 * Every tunable lives here — single source of truth for engine behaviour.
 * Anything in ~/.config/autodj/config.json is merged on top of this.
 */
export const DEFAULTS = {
  lastfm: {
    user: null,
    apiKey: null,
    secret: null,
    sessionKey: null,
  },

  scrobble: {
    enabled: true,
    // Last.fm spec: scrobble at half the track, or 4 minutes, whichever first.
    minPercent: 0.5,
    minSeconds: 240,
    // Tracks shorter than this are never scrobbled (Last.fm rule).
    minTrackLength: 30,

    /**
     * Scrobble booster: advance to the next track shortly after the current
     * one has counted, rather than playing it out.
     *
     * A scrobble lands at half the track or four minutes, whichever comes
     * first, so this plays roughly the minimum each track needs to register
     * and then moves on. Off by default; `--boost` turns it on.
     */
    boost: {
      enabled: false,
      minDelay: 5,
      maxDelay: 10,
    },
  },

  dj: {
    // Keep the queue topped up to this many tracks.
    queueTarget: 12,
    // Refill once the queue drops below this.
    refillAt: 5,
    // Never play the same artist more often than once per N tracks.
    artistCooldown: 6,
    // …and never more than this many times in a single queue refill.
    artistMaxPerSet: 1,
    // Don't replay a track heard within this many days.
    trackCooldownDays: 30,
    // Share of the queue that should be tracks you already know and love.
    familiarRatio: 0.35,
    // How many seed artists/tracks to expand per refill.
    seedCount: 8,
    // Candidates pulled per seed before scoring.
    perSeedLimit: 12,
  },

  sources: {
    topArtists: true,
    lovedTracks: true,
    recentTracks: true,
    similarArtists: true,
    similarTracks: true,
    topTags: true,
    // YouTube Music "radio" mixes seeded from a resolved video id.
    ytmRadio: true,
    // Last.fm's own Recommended/Mix/Library stations. These are the homepage
    // recommendations; there is no public API for them, so they come from the
    // logged-in web session. Needs `autodj login --web`.
    lastfmWeb: true,
    // YouTube Music's personalised Discover / New Release / Replay mixes.
    // Needs a browser session for yt-dlp to borrow.
    ytmFeeds: true,
    // Which browser yt-dlp should take YouTube cookies from (null disables).
    cookiesFromBrowser: 'firefox',
    // ListenBrainz: free, open collaborative filtering. The similarity
    // endpoints work with no account; CF recommendations need one.
    listenBrainz: true,
    // AcousticBrainz audio features (tempo, mood, danceability), used to
    // smooth energy transitions between tracks. Enriches in the background
    // because resolving MusicBrainz recording ids is rate-limited to ~1/sec,
    // so coverage builds up across sessions rather than blocking a refill.
    acousticBrainz: true,
  },

  listenbrainz: {
    // Your ListenBrainz username, if you have one. Without it only the
    // account-free similarity endpoints are used.
    user: null,
  },

  llm: {
    // Uses the `claude` CLI already on this machine — no API key needed.
    // `--no-llm` overrides this at runtime via buildApp({ overrides }).
    enabled: true,
    command: 'claude',
    model: 'claude-sonnet-5',
    // Ask the LLM to sequence at most this many candidates per refill.
    batchSize: 40,
    // The `claude` CLI pays a cold-start cost before inference even begins;
    // 60s was not enough for a full batch and the pass silently fell back.
    timeoutMs: 150000,
  },

  player: {
    binary: 'mpv',
    // Audio only, no window, no video decode.
    args: ['--no-video', '--no-terminal', '--idle=yes'],
    // Persisted: whatever you last set with +/- is what you get next time.
    volume: 70,
    // mpv refuses anything above 100 unless told otherwise, so the gauge and
    // the clamp both key off this rather than assuming a range.
    maxVolume: 100,
    // +/- move by this; page up/down by the coarse step.
    volumeStep: 1,
    volumeCoarseStep: 10,

    /**
     * Loudness normalisation, so one setting works across tracks.
     *
     * YouTube audio carries no ReplayGain tags, so levels swing wildly between
     * a loud remaster and a quiet upload and the volume has to be ridden per
     * track. EBU R128 normalisation fixes the perceived level instead.
     * Measured on a -44 dB source: loudnorm brought it to -18 dB, while
     * dynaudnorm left it untouched.
     */
    normalize: {
      enabled: true,
      // Integrated loudness target in LUFS. -16 is the usual streaming level.
      target: -16,
      truePeak: -1.5,
      range: 11,
    },

    /**
     * Fades. These move a multiplier on top of your chosen level, so the
     * displayed percentage never changes and is restored exactly.
     */
    fade: {
      enabled: true,
      // Every track eases up from silence over a random time in this range,
      // so starts don't all feel identical.
      inMin: 1.5,
      inMax: 3.0,
      // While the booster counts down, ease to this fraction of your level,
      // so the handover is heard as a fade rather than a cut.
      outLevel: 0.15,
    },
  },

  resolver: {
    binary: 'yt-dlp',
    // Search YouTube Music rather than plain YouTube for cleaner matches.
    searchPrefix: 'https://music.youtube.com/search?q=',
    timeoutMs: 30000,
  },

  cache: {
    // Last.fm similarity data barely changes — cache it hard.
    ttlSeconds: 60 * 60 * 24 * 7,
  },
};
