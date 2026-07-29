import { buildApp } from '../app.js';
import { buildSeeds } from '../dj/seeds.js';
import { gatherCandidates } from '../dj/candidates.js';
import { rankCandidates } from '../dj/score.js';
import { sequence } from '../dj/flow.js';
import { resolveMode } from '../dj/modes.js';
import { identityOf } from '../lastfm/correct.js';
import { dedupeBy, label } from '../util/track.js';
import { plural } from '../util/format.js';
import { bold, dim, cyan, green, magenta, grey } from '../ui/ansi.js';
import { setVerbose } from '../util/log.js';

/**
 * Dry run of one full refill: seeds → candidates → correction → ranking →
 * sequencing, printed with the reasoning attached. No audio, no scrobbles.
 * This is the fastest way to judge whether the DJ's taste is any good.
 */
export async function preview({
  mood = null, verbose = false, noLlm = false, resolve = false, mode: modeName = null,
} = {}) {
  setVerbose(verbose);

  const mode = resolveMode(modeName);
  const { config, sources, resolver, history, affinity, library, curator } = await buildApp({
    requirePlayer: false,
    overrides: {
      ...(noLlm ? { llm: { enabled: false } } : {}),
      dj: { familiarRatio: mode.familiarRatio },
      mode,
    },
  });

  const t0 = Date.now();
  console.log(
    bold(`\n  preview for ${cyan(config.lastfm.user)}`) +
      magenta(` · ${mode.label}`) +
      dim(` — ${mode.description}`) +
      (mood ? dim(` · mood: ${mood}`) : '') +
      '\n',
  );

  const seeds = await buildSeeds(sources, config);
  console.log(dim(`  seeds  artists: ${seeds.artists.map((a) => a.name).join(', ')}`));
  console.log(dim(`         tracks:  ${seeds.tracks.map(label).join(' | ')}`));
  console.log(dim(`         tags:    ${seeds.tags.map((t) => t.name).join(', ')}\n`));

  const raw = await gatherCandidates(sources, seeds, config);

  // Per-lane counts make it obvious which feeds are actually reaching us —
  // a silent auth failure shows up here as a lane with zero contributions.
  const byLane = raw.reduce((acc, t) => {
    acc[t.source ?? '?'] = (acc[t.source ?? '?'] ?? 0) + 1;
    return acc;
  }, {});
  console.log(dim(`  ${raw.length} raw candidates`));
  for (const [lane, count] of Object.entries(byLane).sort((a, b) => b[1] - a[1])) {
    console.log(dim(`    ${String(count).padStart(4)}  ${lane}`));
  }

  const context = {
    history,
    affinity,
    library,
    config,
    recentArtists: [],
    nowPlayingTags: [],
  };

  const shortlist = rankCandidates(raw, context).slice(0, config.dj.queueTarget * 3);
  const corrected = await Promise.all(
    shortlist.map((c) => resolver.resolve(c).then((r) => ({ ...c, ...r })).catch(() => c)),
  );
  const correctedCount = corrected.filter((c) => c.corrected).length;
  console.log(dim(`  ${shortlist.length} shortlisted → ${correctedCount} canonicalised via Last.fm`));

  const ranked = rankCandidates(dedupeBy(corrected, identityOf), { ...context, strict: true });
  const curated = await curator.curate(ranked, {
    nowPlaying: null,
    recentlyPlayed: [],
    want: config.dj.queueTarget,
    mood,
  });
  if (curated) console.log(dim(`  LLM sequenced ${curated.length} tracks`));

  const ordered = sequence(curated ?? ranked, config, { recentArtists: [], backfill: ranked });

  console.log(bold(`\n  set (${ordered.length})\n`));
  for (const [i, track] of ordered.entries()) {
    const plays = track.userPlaycount ?? 0;
    const badges = [
      track.curated ? magenta('llm') : grey(track.source ?? '?'),
      plays ? dim(plural(plays, 'play')) : green('new'),
      track.userLoved ? green('♥') : null,
      track.mbid ? dim('mbid') : null,
      track.duration ? dim(`${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}`) : null,
    ].filter(Boolean);

    console.log(`  ${String(i + 1).padStart(2)}. ${bold(label(track))}`);
    console.log(`      ${badges.join(dim(' · '))}${track.seed ? dim(`  ← ${track.seed}`) : ''}`);

    if (resolve) {
      // eslint-disable-next-line no-await-in-loop
      const hit = await sources.searcher.resolve(track).catch(() => null);
      console.log(
        hit
          ? `      ${green('▶')} ${dim(hit.title)} ${grey(`(${hit.id}, score ${hit.score})`)}`
          : `      ${dim('no YouTube Music match')}`,
      );
    }
  }

  console.log(dim(`\n  built in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`));
}
