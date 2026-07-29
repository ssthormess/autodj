import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { label } from '../util/track.js';
import { debug, warn } from '../util/log.js';

const run = promisify(execFile);

/**
 * Optional LLM sequencing pass, run through the `claude` CLI that's already
 * installed and authenticated on this machine — no API key handling here.
 *
 * The model never invents tracks: it only reorders and filters the candidates
 * the Last.fm graph produced, so a hallucinated title can't reach the player.
 * Any id it returns that isn't in the input is discarded.
 */
export function createCurator(config) {
  const { enabled, command, model, batchSize, timeoutMs } = config.llm;

  async function curate(candidates, context) {
    if (!enabled || candidates.length < 4) return null;

    const batch = candidates.slice(0, batchSize);
    const listing = batch
      .map((t, i) => {
        const tags = t.tags?.slice(0, 4).join(', ') || '—';
        const plays = t.userPlaycount ?? 0;
        return `${i}. ${label(t)} | tags: ${tags} | your plays: ${plays} | via: ${t.source ?? '?'}`;
      })
      .join('\n');

    const nowPlaying = context.nowPlaying ? label(context.nowPlaying) : 'nothing yet';
    const recent = context.recentlyPlayed.slice(0, 8).map(label).join(', ') || 'none';

    const prompt = [
      'You are sequencing a continuous listening set for one listener.',
      '',
      `Currently playing: ${nowPlaying}`,
      `Just played: ${recent}`,
      context.mood ? `Requested mood/direction: ${context.mood}` : '',
      '',
      'Candidate tracks:',
      listing,
      '',
      `Pick and order the best ${context.want} for an unbroken set that flows from what is`,
      'playing now. Favour coherent transitions in energy and texture, avoid stacking the',
      'same artist, and avoid obvious chart filler. Drop anything that would break the set.',
      '',
      'Respond with ONLY a JSON array of the candidate numbers, best order first.',
      'Example: [4,17,2,9]',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const { stdout } = await run(
        command,
        ['-p', prompt, '--model', model, '--output-format', 'text'],
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      );

      const match = stdout.match(/\[[\d,\s]*\]/);
      if (!match) {
        debug('curator returned no parseable array');
        return null;
      }

      const order = JSON.parse(match[0]);
      const picked = order
        .map((i) => batch[i])
        .filter(Boolean)
        .map((t) => ({ ...t, curated: true }));

      if (!picked.length) return null;
      debug(`curator ordered ${picked.length}/${batch.length} candidates`);
      return picked;
    } catch (err) {
      // The DJ must never stall because the LLM was slow or absent.
      warn(`LLM curation skipped: ${err.message.split('\n')[0]}`);
      return null;
    }
  }

  return { curate };
}
