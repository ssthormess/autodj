import { createAffinity } from '../dj/affinity.js';
import { createClient } from '../lastfm/client.js';
import { createResolver, identityOf } from '../lastfm/correct.js';
import { loadConfig } from '../config/config.js';
import { bold, cyan, dim, green } from '../ui/ansi.js';
import { error } from '../util/log.js';

/**
 * Take back a vote after the fact.
 *
 * The `u` key covers a mis-press noticed while the track is still on screen;
 * this covers the rest — a downvote spotted an hour later, when the track is
 * long gone from the queue.
 */
export async function unvote(query) {
  const affinity = createAffinity();

  if (!query) {
    const entry = affinity.lastVote();
    if (!entry) {
      console.log(dim('  no votes recorded yet'));
      return;
    }
    affinity.undo(entry.id);
    console.log(`  ${green('undone')}  ${entry.direction > 0 ? 'upvote' : 'downvote'} on ${bold(entry.label)}`);
    return;
  }

  const [artist, name] = query.split(/\s+[-—–]\s+/);
  if (!artist || !name) {
    error('expected "Artist - Track"');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const client = createClient(config.lastfm);
  const resolver = createResolver(client, { user: config.lastfm.user });
  const track = (await resolver.correctTrack({ artist, name })) ?? { artist, name, tags: [] };

  console.log(`  ${cyan(bold(`${track.artist} — ${track.name}`))}`);

  // A journalled vote can be reversed exactly; anything older has to be
  // inferred from the track, which is why the two paths report differently.
  const entry = affinity.lastVote(identityOf(track));
  if (entry) {
    affinity.undo(entry.id);
    console.log(`  ${green('undone')}  ${entry.direction > 0 ? 'upvote' : 'downvote'} from ${new Date(entry.at).toLocaleString()}`);
    return;
  }

  const undone = affinity.undoInferred(track);
  if (!undone.length) {
    console.log(dim('  no vote on record for this track'));
    return;
  }

  console.log(`  ${green('undone')}  ${dim('(inferred — this vote predates the undo journal)')}`);
  for (const { bucket, key, before, after } of undone) {
    console.log(`    ${bucket.padEnd(8)} ${dim(key.replace(/\0/g, ' '))}  ${before.toFixed(2)} → ${after.toFixed(2)}`);
  }
}
