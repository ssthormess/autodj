import { readCache, writeCache } from '../util/cache.js';
import { debug } from '../util/log.js';

const API = 'https://api.listenbrainz.org/1';
const LABS = 'https://labs.api.listenbrainz.org';

/**
 * ListenBrainz — the only genuinely free, open collaborative-filtering
 * recommender available here. No API key, no quota tier.
 *
 * Two distinct capabilities:
 *  - `recommendations()` needs a ListenBrainz account with listen history
 *    (you can import a Last.fm history into one), and returns output from a
 *    real CF model, not a similarity graph walk.
 *  - `similarRecordings()` / `similarArtists()` need no account at all: they
 *    query the session-based co-listening dataset built from every user's
 *    listens. That is a different signal from Last.fm's similarity, which is
 *    the point of running both.
 */
export function createListenBrainz({ user = null, ttl = 604800 } = {}) {
  async function getJson(url, { cache = true } = {}) {
    if (cache) {
      const hit = readCache('lb', url, ttl);
      if (hit) return hit;
    }
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'autodj/0.1 (personal use)' },
      });
      if (!response.ok) {
        debug(`listenbrainz ${response.status} for ${url.slice(0, 80)}`);
        return null;
      }
      const json = await response.json();
      return cache ? writeCache('lb', url, json) : json;
    } catch (err) {
      debug(`listenbrainz failed: ${err.message}`);
      return null;
    }
  }

  /** CF model output for a ListenBrainz user. Empty when there's no account. */
  async function recommendations(count = 100) {
    if (!user) return [];
    const json = await getJson(
      `${API}/cf/recommendation/user/${encodeURIComponent(user)}/recording?count=${count}`,
      { cache: false },
    );
    return (json?.payload?.mbids ?? []).map((m) => ({
      recordingMbid: m.recording_mbid,
      score: m.score,
      source: 'lb-cf',
    }));
  }

  // The two endpoints take *different* algorithm enums; the server rejects
  // anything not on its list, so these strings are copied from its own error
  // response rather than inferred.
  const RECORDING_ALGO =
    'session_based_days_7500_session_300_contribution_5_threshold_15_limit_50_skip_30_top_n_listeners_1000';
  const ARTIST_ALGO =
    'session_based_days_7500_session_300_contribution_3_threshold_10_limit_100_filter_True_skip_30';

  /** Co-listening neighbours for a recording. No account required. */
  async function similarRecordings(recordingMbid, limit = 20) {
    const json = await getJson(
      `${LABS}/similar-recordings/json?recording_mbids=${recordingMbid}&algorithm=${RECORDING_ALGO}`,
    );
    const rows = Array.isArray(json) ? json : [];
    return rows
      .filter((r) => r.recording_mbid && r.recording_mbid !== recordingMbid)
      .slice(0, limit)
      .map((r) => ({
        recordingMbid: r.recording_mbid,
        artist: r.artist_credit_name ?? null,
        name: r.recording_name ?? null,
        album: r.release_name ?? null,
        // Raw co-listen counts, roughly 0..300 here.
        score: Number(r.score) || 0,
        source: 'lb-similar',
      }));
  }

  /** Co-listening neighbours for an artist. No account required. */
  async function similarArtists(artistMbid, limit = 20) {
    const json = await getJson(
      `${LABS}/similar-artists/json?artist_mbids=${artistMbid}&algorithm=${ARTIST_ALGO}`,
    );
    const rows = Array.isArray(json) ? json : [];
    return rows
      .filter((r) => r.artist_mbid && r.artist_mbid !== artistMbid)
      .slice(0, limit)
      .map((r) => ({
        artistMbid: r.artist_mbid,
        name: r.name ?? null,
        // Artist scores run an order of magnitude higher than recording ones.
        score: Number(r.score) || 0,
        source: 'lb-similar-artist',
      }));
  }

  /**
   * CF output is MBIDs only, so it has to be turned back into artist/title
   * before anything else can use it. MusicBrainz asks for <=1 request/second.
   */
  async function lookupRecording(recordingMbid) {
    const json = await getJson(
      `https://musicbrainz.org/ws/2/recording/${recordingMbid}?inc=artist-credits&fmt=json`,
    );
    if (!json?.title) return null;
    return {
      artist: json['artist-credit']?.[0]?.name ?? null,
      name: json.title,
      mbid: recordingMbid,
      duration: json.length ? Math.round(json.length / 1000) : null,
    };
  }

  async function hasAccount() {
    if (!user) return false;
    const json = await getJson(`${API}/user/${encodeURIComponent(user)}/listen-count`, {
      cache: false,
    });
    return Boolean(json?.payload?.count);
  }

  return {
    recommendations,
    similarRecordings,
    similarArtists,
    lookupRecording,
    hasAccount,
  };
}
