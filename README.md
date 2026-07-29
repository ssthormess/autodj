# autodj

Continuous terminal radio built from your own Last.fm history. It picks the
music, streams it from YouTube Music, and scrobbles it back — indefinitely,
without you touching anything.

No Electron, no browser tab. Node + `mpv` + `yt-dlp`, with `blessed` for the
terminal UI.

## Install

```bash
brew install mpv yt-dlp
git clone https://github.com/ssthormess/autodj.git && cd autodj
npm install
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
| `→` | next track — **no consequences**, nothing recorded |
| `n` | skip — recorded as a negative signal against track and artist |
| `↑` / `↓` | up/down vote — feeds the taste profile |
| `l` | love on Last.fm **and** strongest positive vote |
| `x` | ban — never queue this track again |
| `b` | toggle the scrobble booster on/off, live |
| `m` | set or clear a mood/direction |
| `r` | force a queue refill |
| `+` / `-` | volume, 1% steps |
| `PgUp` / `PgDn` | volume, 10% steps |
| `[` / `]` | scroll the activity log back / forward |
| `t` | cycle theme (midnight, amber, winamp, mono) |
| `q` | quit (flushes pending scrobbles) |

`→` and `n` are deliberately different. Skipping is an opinion — it feeds the
scoring and, repeated, bans the track. Moving on because you feel like it
should not poison the profile, so the arrow does exactly nothing beyond
advancing.

The **activity** panel logs what the DJ is doing as it happens — tracks
starting, scrobbles landing, refills, votes, boost advances — alongside any
warnings. The terminal tab title tracks the current `Artist - Track`.

**Left-click** any track in the up-next list to play it immediately. The rest
of the queue stays as it is, and the current track is finished neutrally rather
than counted as a skip.

**Right-click** a queued track for the reject menu:

| action | effect |
|--------|--------|
| Remove from queue | drops it from this set only — no opinion recorded |
| Downvote | drops it and marks down the track, artist, album and tags |
| Ban | never queued again, plus the strongest negative vote |

They are offered separately rather than bundled, because dropping one track
from one queue and refusing it forever are very different intentions.

### Layout, themes and the level meter

The layout is computed from the terminal size and recomputed on every resize.
Above 86 columns the queue and analysis panels sit side by side; below that
they stack, and the footer's keys wrap onto as many rows as the width needs
rather than running past its own border. On a short window the analysis panel,
and then the log, step aside rather than being drawn squashed or pushed off
the bottom. Verified from 40x15 through 240x100 with every panel inside the
screen at every size.

The activity log is deliberately bounded: it is a log, and it should not
inherit every spare row just because the window is tall — the queue gets the
slack instead. It stays pinned to the newest line and is scrollable with `[`
and `]` or the mouse wheel; scrolling back pauses auto-follow (the label shows
`[scrolled back]`) so reading history is not yanked away by new entries.

Themes cycle with `t` and persist: midnight, amber, winamp, mono.

The level meter is driven by mpv's own `ebur128` filter metadata read over
IPC, so it reflects the real signal and reads as silence when paused. It is a
level meter and not a spectrum analyser: mpv exposes no FFT, and decoding each
stream a second time purely to compute one would double the bandwidth per
track. Note that mpv keeps only the last `--af` it is given, so normalisation
and the meter travel in a single filter chain.

### Fades

Every track eases up from silence over a random 1.5–3 seconds, so starts vary
rather than all sounding the same. When the scrobble booster arms its
countdown, the level eases down across it, so the early handover is heard as a
fade instead of the track being cut mid-bar.

Fades move a multiplier on top of your chosen level; the displayed percentage
never changes and is restored exactly when the ramp ends. The ramp is eased
rather than linear, because a linear amplitude ramp lurches at the quiet end.

### Album art

The now-playing card carries a thumbnail of the release, drawn with half-block
characters and truecolor: the upper-half block renders its foreground in the
top of the cell and its background in the bottom, so one character row carries
two pixel rows.

Real inline images do exist — iTerm2's OSC 1337, kitty's graphics protocol —
but they draw outside the character grid, and this UI repaints every second, so
blessed would erase them on the next frame. Half-blocks stay inside the grid
where the layout can own them. `ffmpeg` fetches, scales and decodes in one
pass, which avoids an image library for a 16×8 thumbnail. Artwork comes from
Last.fm and is cached for 30 days.

### Acoustic analysis

When AcousticBrainz has data for a recording, the analysis panel shows it:
energy, danceability, and the mood classifiers for happy, aggressive, relaxed,
acoustic, electronic and instrumental, each as a bar with its raw probability.

These are classifier outputs rather than measurements of taste, so they are
shown as numbers rather than dressed up as verdicts. Coverage is partial; a
track without analysis says so instead of showing zeros, which would read as
"not danceable" rather than "unknown".

### Volume

The displayed percentage is a share of full amplitude, not mpv's own number.
mpv's `volume` property is cubic — `gain = (volume/100)³` — so passing a
displayed value straight through made 10% roughly a thousandth of full scale,
which is inaudible. Measured against a tone: 5% is about −26 dB, 20% is −14 dB,
100% is unity gain. Steps of 1% work out to roughly 1 dB at the quiet end,
which is about the smallest change worth having.

## Scrobble booster

Press **`b`** to toggle it on or off at any point during a set — it is not a
launch flag, so you can switch it on for a stretch and back off again. The
header shows `⚡boost` while it is active.

Turning it on part-way through a track that has already scrobbled arms the
advance immediately rather than waiting for the next track; turning it off
cancels an advance already pending.

It advances 5–10 seconds after the current track scrobbles, instead of playing it
out. A scrobble lands at half the track or four minutes, whichever comes first,
so this plays roughly the minimum each track needs in order to count. The
delay is randomised across the window rather than fixed, and the now-playing
line shows a `next in Ns` countdown so the early advance is never a surprise.

An advance made by the booster is **not** a skip: the track already counted, so
recording it as a rejection would be wrong.

Worth knowing before using it: the playcounts it inflates are the same
`user.getTopTracks` numbers that `--hits`, `--discover` and the familiarity
scoring all read from. Boosting will progressively skew this tool's own
recommendations toward whatever it boosted.

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
