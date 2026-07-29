import { readCache, writeCache } from '../util/cache.js';
import { debug } from '../util/log.js';

const MB_ROOT = 'https://musicbrainz.org/ws/2';
const UA = 'autodj/0.1 (personal listening tool)';

// MusicBrainz asks anonymous clients for at most one request per second, and
// enforces it. Everything here funnels through a single serialised queue.
let lastCall = 0;
let chain = Promise.resolve();

function throttled(fn) {
  chain = chain.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastCall));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  return chain;
}

/**
 * Last.fm's `mbid` is not the identifier AcousticBrainz uses.
 *
 * Last.fm returns a track or release MBID depending on the entry, while
 * AcousticBrainz is keyed strictly on MusicBrainz *recording* MBIDs. Passing
 * the Last.fm value straight through returns nothing: measured against a
 * 25-track sample from this library, Last.fm ids scored 0% and a properly
 * resolved recording id hit on the first track tried.
 *
 * A song also has many recordings in MusicBrainz - album cut, single, live
 * takes, remasters, compilation pressings. Taking only the top hit picks an
 * arbitrary one that often has no analysis even when another pressing of the
 * same song does, so this returns several and lets the caller pick the one
 * that actually carries data.
 *
 * Results are cached for 30 days, including misses; re-asking MusicBrainz for
 * something it does not have would burn the rate-limit budget every refill.
 */
export async function recordingCandidates({ artist, name }, limit = 8) {
  if (!artist || !name) return [];
  const key = `${artist} ${name}`;

  const cached = readCache('mb-recording', key, 60 * 60 * 24 * 30);
  if (cached !== null) return cached.mbids ?? [];

  const clean = (s) => String(s).replace(/["\\]/g, ' ').trim();
  const query = `recording:"${clean(name)}" AND artist:"${clean(artist)}"`;
  const url = `${MB_ROOT}/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;

  try {
    const json = await throttled(async () => {
      const response = await fetch(url, { headers: { 'user-agent': UA } });
      if (!response.ok) return null;
      return response.json();
    });

    const mbids = (json?.recordings ?? []).map((r) => r.id).filter(Boolean);
    writeCache('mb-recording', key, { mbids });
    return mbids;
  } catch (err) {
    debug(`musicbrainz lookup failed for ${artist} / ${name}: ${err.message}`);
    return [];
  }
}
