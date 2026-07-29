# autodj

Continuous terminal radio built from your own Last.fm history. It picks the
music, streams it from YouTube Music, and scrobbles it back — indefinitely,
without you touching anything.

No Electron, no browser tab. Node + `mpv` + `yt-dlp`, zero npm dependencies.

## Install

```bash
brew install mpv yt-dlp
git clone https://github.com/ssthormess/autodj.git && cd autodj
node bin/autodj.js doctor      # check deps + credentials
node bin/autodj.js sync        # mirror your Last.fm library locally (~30s)
```

Optionally put it on your PATH:

```bash
ln -s ~/Scratchpad/autodj/bin/autodj.js /opt/homebrew/bin/autodj
```

## Use

```bash
autodj                              # start the radio (mix mode)
autodj --discover                   # only tracks you've never played
autodj --hits                       # your top played only
autodj --deep                       # deep cuts: known artists, unknown songs
autodj radio --mood "late night, warm, downtempo"
autodj radio --from "Bloc Party - Coming on Strong"
autodj preview --discover           # dry-run a set: no audio, no scrobbles
autodj preview --resolve            # …and verify each track exists on YT Music
autodj login --web                  # enable the Last.fm + YTM recommendation feeds
autodj status
autodj doctor
```

### Modes

| mode | what it plays |
|------|---------------|
| `--mix` *(default)* | blend of history, both recommendation feeds, and exploration |
| `--discover` | only tracks with zero plays in your history |
| `--hits` | only your top-played material |
| `--deep` | album tracks by artists you know — not their singles |

While playing:

| key | action |
|-----|--------|
| `space` | pause / resume |
| `n` | skip (recorded as a negative signal) |
| `↑` / `↓` | up/down vote — feeds the taste profile |
| `l` | love on Last.fm **and** strongest positive vote |
| `b` | ban — never queue this track again |
| `m` | set or clear a mood/direction |
| `r` | force a queue refill |
| `+` / `-` | volume |
| `q` | quit (flushes pending scrobbles) |

## The local library

`autodj sync` mirrors your entire Last.fm library — every unique track and
artist you have ever scrobbled, with playcounts — into
`~/.config/autodj/library.json`.

This is what makes `--discover` and `--hits` trustworthy. Without it, "have I
heard this?" costs one `track.getInfo` call per candidate, and any track the
API returns no playcount for reads as *never played*. On this account that
meant judging 44,210 unique tracks from a sample of a few hundred.

45 requests, about 30 seconds, and every lookup afterwards is local and
instant. Re-run it occasionally; the DJ falls back to the per-candidate API
path when no sync exists, so it is optional but strongly recommended.

## The taste profile

Votes are not stored per-track only. A vote propagates to the artist, the
album and the track's tags at decreasing weight (1.0 / 0.35 / 0.25 / 0.12), so
a handful of votes steers whole regions of the catalogue rather than four
individual songs. Tags are weighted lowest on purpose — one tag covers
thousands of tracks and would otherwise swamp every other signal.

Votes decay with a 120-day half-life, so the profile can change its mind
instead of fossilising around what you liked last year. `autodj status` shows
your strongest artist and tag affinities.

Stored in `~/.config/autodj/affinity.json`.

## Auth

On first run it reuses the authorised Last.fm session already stored by
Pear Desktop (the YouTube Music app), so there's usually nothing to do. If that
isn't present, `autodj login` runs the normal browser auth flow.

Credentials live in `~/.config/autodj/config.json`. Only values that differ from
the defaults are written there, so future default changes still reach you.

## How it picks music

A refill runs many independent candidate lanes in parallel, then narrows:

| lane | source | what it finds |
|------|--------|---------------|
| `lastfm-recommended` | Last.fm web session | **Last.fm's own recommendations** — the ones on your homepage |
| `lastfm-mix` | Last.fm web session | your library blended with those recommendations |
| `lastfm-library` | Last.fm web session | your scrobbled catalogue, shuffled |
| `ytm-rec` | YouTube session | YouTube's recommendation feed |
| `ytm-liked` | YouTube session | your Liked Music playlist |
| `ytm-history` | YouTube session | your watch history |
| `lb-cf` | ListenBrainz | genuine collaborative-filtering model output |
| `lb-similar` | ListenBrainz | co-listening neighbours, no account required |
| `similar-track` | Last.fm API | track-level neighbours — the tightest graph signal |
| `similar-artist` | Last.fm API | sideways moves inside your taste |
| `artist-deep` | Last.fm API | the tail of an artist's catalogue, past the singles |
| `tag` | Last.fm API | genre-level exploration, escapes the collaborative bubble |
| `ytm-radio` | YouTube (no auth) | track-seeded radio mix |
| `user-top` / `loved` | Last.fm API | your own most-played and loved material |

Running several *independent recommenders* is the point. Last.fm's model,
YouTube's model and ListenBrainz's CF model disagree, and the disagreement is
where the interesting tracks are — any single one of them converges.

### Why some feeds need a browser session

Last.fm withdrew `user.getRecommendedArtists` from the public API; it now
returns HTTP 400. The recommendations still exist — they're rendered on the
logged-in site. YouTube's personalised feeds are the same: account-level, no
public API. Both are read from the session your browser already holds, the same
mechanism as `yt-dlp --cookies-from-browser`. Nothing is sent anywhere except
to Last.fm and YouTube, exactly as the browser itself would.

Run `autodj login --web` to enable and verify them. Without it, those lanes
return empty and the DJ falls back to the API-only lanes.

Note on YouTube Music's named mixes (Discover Mix, New Release Mix, Supermix):
their playlist ids are **per-account** and only obtainable from the
authenticated home feed, which yt-dlp does not expose. No such id is hardcoded
here — an earlier attempt to do so used ids that return HTTP 404 for everyone.
The YouTube lanes use documented endpoints instead, and `autodj login --web`
reports which of them actually returned tracks on your account.

If a YouTube lane is empty while you are signed in, the usual cause is yt-dlp
reading the wrong Firefox profile. Set an explicit path:

```jsonc
{ "sources": { "cookiesFromBrowser":
  "firefox:~/Library/Application Support/Firefox/Profiles/xxxx.default-release" } }
```

### Audio features (AcousticBrainz)

Tracks are annotated with measured acoustic data — tempo, key, loudness, and
trained classifiers for mood, danceability and timbre — collapsed into a single
0..1 `energy` value. The sequencer uses it to break near-ties: given several
equally-ranked placeable candidates, it picks the one closest in energy to the
outgoing track, which is what stops a set feeling stitched together.

Two things make this workable:

- **Last.fm MBIDs don't work here.** Last.fm returns track/release ids;
  AcousticBrainz is keyed on MusicBrainz *recording* ids. Measured on a
  25-track sample of this library, passing Last.fm's ids through scored **0%**.
- **One recording id isn't enough.** A song has many recordings (album cut,
  single, live, remaster, compilation). Resolving to just the top match often
  lands on a pressing with no analysis. Asking for several and taking the first
  that carries data took coverage from **0/25 to 6/8**.

Resolution costs one MusicBrainz request per track and they rate-limit to
~1/sec, so it runs **detached in the background** and caches for 30 days
(including misses). A separate cache-only pass runs before sequencing, so
energy-aware ordering switches on progressively as coverage builds rather than
stalling any refill. Nothing depends on it — tracks without features sequence
exactly as before.

### On LLMs and music recommendation

No major service uses an LLM as its recommender. Spotify, YouTube Music and
Apple Music run collaborative filtering, session-sequence models and audio
embeddings — two-tower retrieval feeding a ranker. LLMs appear at the edges:
natural-language playlist prompts, DJ commentary, metadata cleanup.

That's how it's used here. The LLM never retrieves: it receives candidates the
recommenders produced and only reorders and filters them, and any id it returns
that wasn't in the input is discarded. Retrieval comes from real CF data
(ListenBrainz), two first-party recommenders, and the Last.fm graph.

Seeds are drawn from four time horizons at once (all-time top artists, last
3 months, loved tracks, and what you played most recently) so a set doesn't
collapse into whatever you had on yesterday.

Candidates are ranked twice. The first pass is cheap and throws most of them
away. Only the survivors get a `track.getInfo` call, which returns the canonical
name, MusicBrainz id, real duration, and **your own playcount** — the second
ranking pass needs all four. Then an optional LLM pass (via the `claude` CLI
already on your machine, no API key) sequences the shortlist for flow, and a
final pass enforces artist diversity.

Scoring balances four things rather than maximising similarity — a pure
similarity ranker converges on the same twelve songs forever:

- **relevance** — Last.fm's match score, weighted by which lane found it
- **familiarity** — some known material, but high playcounts get penalised
- **novelty** — unheard tracks get a bonus; sub-500-listener obscurities don't
- **variety** — artist cooldown, per-set artist cap, 30-day track cooldown

Your skips are permanent input: skip something twice inside 10 seconds and it's
banned. `b` bans immediately.

## Names come from Last.fm, not from regex

Every track is resolved through `track.getInfo?autocorrect=1` before it is
keyed, searched, or scrobbled. Guessing canonical titles by stripping
`(Official Video)` with a regex is lossy — it mangles songs genuinely called
"Video Games" or "4K", and it puts near-duplicate variants into your scrobble
history. Identity is the MusicBrainz id where one exists.

The regex helpers in `src/util/track.js` are only used for cheap pre-dedupe
before spending API calls, and for comparing *YouTube* titles against a known
Last.fm track.

## Scrobbling

Follows Last.fm's rules: `updateNowPlaying` at track start, submit at half the
track or 4 minutes (whichever is first), nothing under 30 seconds. Failed
scrobbles queue in memory and are retried on the next track and on quit.

## Layout

```
bin/autodj.js          entry + arg parsing
src/app.js             composition root — everything is wired here
src/config/            defaults, load/save (delta-only), paths
src/lastfm/            client, auth, correction, user data, similarity, tags, scrobbling
src/ytm/search.js      yt-dlp search + result scoring against the canonical track
src/player/            mpv process + JSON IPC
src/dj/                seeds → candidates → score → flow → engine, plus play history
src/llm/curate.js      optional LLM sequencing via the `claude` CLI
src/ui/                ANSI helpers, render, keybindings
src/util/              signing, cache, formatting, track helpers
```

## Tuning

Edit `~/.config/autodj/config.json`. Useful knobs:

```jsonc
{
  "dj": {
    "familiarRatio": 0.35,     // share of the queue you already know
    "artistCooldown": 6,       // min gap between tracks by one artist
    "artistMaxPerSet": 1,      // hard cap per refill
    "trackCooldownDays": 30
  },
  "llm": { "enabled": true, "model": "claude-sonnet-5" },
  "sources": { "ytmRadio": true, "topTags": true }
}
```

Run `--no-llm` to skip LLM sequencing for one session without changing config.
