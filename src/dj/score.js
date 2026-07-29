import { artistKeyOf } from '../util/track.js';

/**
 * Source lanes aren't equally trustworthy — weight them accordingly.
 *
 * The two first-party recommendation feeds sit at the top: they are the output
 * of Last.fm's and YouTube's own models over your account, which is strictly
 * more information than a similarity walk we assemble ourselves.
 */
const SOURCE_WEIGHT = {
  'lastfm-recommended': 1.15,
  'lastfm-mix': 0.95,
  'lastfm-library': 0.8,
  'ytm-rec': 1.05,
  'ytm-liked': 0.95,
  'ytm-history': 0.75,
  'lb-cf': 1.1,
  'lb-similar': 0.9,
  'similar-track': 1.0,
  'similar-artist': 0.85,
  'ytm-radio': 0.8,
  'artist-deep': 0.9,
  'user-top': 0.85,
  loved: 0.95,
  tag: 0.6,
  'artist-top': 0.7,
};

/**
 * Turn a candidate into a single ranking number.
 *
 * The goal isn't "most similar" — a pure-similarity ranker converges on the
 * same handful of songs. It's a balance of relevance, novelty and variety,
 * with your own skip history as a negative signal.
 */
export function scoreCandidate(candidate, context) {
  const { history, affinity, library, config, recentArtists, nowPlayingTags } = context;
  const mode = config.mode ?? null;

  // The local library is authoritative once synced: it covers every track ever
  // scrobbled, so a miss genuinely means "never played" rather than "the API
  // didn't tell us". Before a sync we fall back to whatever `track.getInfo`
  // returned, which is incomplete by nature.
  if (library?.isReady() && candidate.userPlaycount === undefined) {
    candidate.userPlaycount = library.playcountOf(candidate);
  }

  if (history.isBanned(candidate)) return -Infinity;

  // A mode may hard-filter rather than merely re-weight (discover/hits/deep).
  // That filter reads `userPlaycount`, which only exists after the Last.fm
  // correction pass — so applying it to the pre-correction ranking would
  // reject every candidate and leave the queue empty. `strict` is set only on
  // the second pass, once the data it depends on is actually present.
  if (context.strict && mode?.require && !mode.require(candidate)) return -Infinity;

  let score = 0;

  // Relevance: how close Last.fm thinks this is to the seed.
  score += (candidate.match ?? candidate.rank ?? 0.4) * 3;
  score *= SOURCE_WEIGHT[candidate.source] ?? 0.7;

  // Learned taste: your up/down votes, propagated through artist, album and
  // tag. This is the only term that can express dislike short of a ban.
  if (affinity) score += affinity.scoreFor(candidate) * 1.4;

  // Familiarity: some known quantity keeps a set comfortable, but a high
  // personal playcount also means you don't need to hear it again today.
  const plays = candidate.userPlaycount ?? 0;
  const familiarityCap = mode?.familiarityCap ?? 40;
  if (plays > 0) score += Math.min(1.2, Math.log1p(plays) * 0.4);
  if (plays > familiarityCap) score -= 0.8;
  if (candidate.userLoved) score += 1.5;

  // Novelty: reward things that are new to you, but not obscure to everyone.
  if (plays === 0) score += mode?.noveltyBonus ?? 0.9;
  const listeners = candidate.listeners ?? 0;
  if (listeners > 0 && listeners < 500) score -= 1.2;
  if (listeners > 2_000_000) score -= 0.4;

  // Repetition guards.
  if (history.playedRecently(candidate, config.dj.trackCooldownDays)) score -= 3;
  score -= history.skipCount(candidate) * 1.2;
  score -= history.artistPenalty(candidate);

  // Variety: an artist already in the current window gets pushed down hard.
  const artist = artistKeyOf(candidate);
  const recentIndex = recentArtists.indexOf(artist);
  if (recentIndex !== -1) score -= (config.dj.artistCooldown - recentIndex) * 0.9;

  // Cohesion: overlap with what's playing now keeps a set from lurching.
  if (nowPlayingTags?.length && candidate.tags?.length) {
    const overlap = candidate.tags.filter((t) => nowPlayingTags.includes(t)).length;
    score += Math.min(1.0, overlap * 0.35);
  }

  // A little jitter so identical inputs don't produce an identical set.
  score += Math.random() * 0.35;

  return score;
}

export function rankCandidates(candidates, context) {
  return candidates
    .map((c) => ({ ...c, score: scoreCandidate(c, context) }))
    .filter((c) => Number.isFinite(c.score))
    .sort((a, b) => b.score - a.score);
}
