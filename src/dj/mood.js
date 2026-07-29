import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readCache, writeCache } from '../util/cache.js';
import { debug, warn } from '../util/log.js';

const run = promisify(execFile);

/**
 * Turn a free-text mood into things the recommenders can actually search for.
 *
 * A mood used to reach only the LLM's ordering step, which meant it could
 * re-rank whatever your listening history had already produced and nothing
 * more. Asking for a regional genre the history does not contain therefore
 * changed the order of the same familiar tracks and nothing else.
 *
 * Resolution runs in three stages:
 *
 *  1. Try the phrase as a Last.fm tag. Sometimes that is all it takes.
 *  2. If the tag is thin or missing, ask the LLM to expand the phrase into
 *     concrete genre tags and representative artists. "raspacanilla" is not a
 *     Last.fm tag with any depth, but "changa tuki" and "raptor house" — the
 *     scene it belongs to — are.
 *  3. Validate everything against Last.fm and discard whatever does not exist,
 *     so an invented artist name can never reach the queue.
 */

// A tag with almost nothing behind it will not sustain a set.
const MIN_TAG_TRACKS = 5;

export function createMoodResolver({ tags, similar, config }) {
  async function tagDepth(name) {
    const tracks = await tags.tagTopTracks(name, 10).catch(() => []);
    return tracks.length;
  }

  /** Ask the LLM for searchable terms. Returns {tags, artists}. */
  async function expand(mood) {
    if (!config.llm.enabled) return { tags: [], artists: [] };

    const prompt = [
      `A listener asked for music described as: "${mood}"`,
      '',
      'This may be a genre, a scene, a regional slang term, a vibe, or a mix.',
      'Translate it into concrete search terms for a music database.',
      '',
      'Return ONLY JSON of this exact shape, no prose:',
      '{"tags":["genre tag","another"],"artists":["Artist Name","Another Artist"]}',
      '',
      'Rules:',
      '- tags: 2-5 Last.fm-style genre tags that real listeners actually use.',
      '  If the phrase is regional slang, give the genre names of that scene.',
      '- artists: 3-8 real, well-known artists central to it. Real names only.',
      '- If the phrase is a mood rather than a genre, give genres that carry it.',
    ].join('\n');

    try {
      const { stdout } = await run(
        config.llm.command,
        ['-p', prompt, '--model', config.llm.model, '--output-format', 'text'],
        { timeout: config.llm.timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      );
      const match = stdout.match(/\{[\s\S]*\}/);
      if (!match) return { tags: [], artists: [] };
      const parsed = JSON.parse(match[0]);
      return {
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
        artists: Array.isArray(parsed.artists) ? parsed.artists.slice(0, 8) : [],
      };
    } catch (err) {
      warn(`mood expansion failed: ${err.message.split('\n')[0]}`);
      return { tags: [], artists: [] };
    }
  }

  /**
   * Resolved seeds for a mood, or null when nothing survived validation — in
   * which case the caller should fall back to history-based seeding rather
   * than play silence.
   */
  async function resolve(mood) {
    if (!mood) return null;

    const cached = readCache('mood', mood, 60 * 60 * 24 * 30);
    if (cached) return cached;

    const direct = await tagDepth(mood);
    const expanded = direct >= MIN_TAG_TRACKS ? { tags: [], artists: [] } : await expand(mood);

    // The literal phrase stays in the running if it had any depth at all.
    const tagCandidates = [...(direct > 0 ? [mood] : []), ...expanded.tags];

    const tagChecks = await Promise.all(
      tagCandidates.map(async (name) => ({ name, depth: await tagDepth(name) })),
    );
    const goodTags = tagChecks
      .filter((t) => t.depth >= MIN_TAG_TRACKS)
      .map((t) => ({ name: t.name, count: t.depth * 100 }));

    // Validate artists by asking Last.fm for their neighbours: an artist it
    // has never heard of returns none, which filters out invented names.
    const artistChecks = await Promise.all(
      expanded.artists.map(async (name) => {
        const neighbours = await similar.similarArtists(name, 3).catch(() => []);
        return neighbours.length ? { name, weight: 3 } : null;
      }),
    );
    const goodArtists = artistChecks.filter(Boolean);

    if (!goodTags.length && !goodArtists.length) {
      debug(`mood "${mood}" resolved to nothing usable`);
      return null;
    }

    const steer = { artists: goodArtists, tracks: [], tags: goodTags, mood };
    debug(
      `mood "${mood}" → tags [${goodTags.map((t) => t.name).join(', ')}] ` +
        `artists [${goodArtists.map((a) => a.name).join(', ')}]`,
    );
    return writeCache('mood', mood, steer);
  }

  return { resolve, expand, tagDepth };
}
