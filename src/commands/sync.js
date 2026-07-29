import { buildApp } from '../app.js';
import { syncLibrary } from '../library/sync.js';
import { bold, green, dim, cyan } from '../ui/ansi.js';
import { clearLine } from '../ui/ansi.js';

/**
 * Mirror the full Last.fm library locally. Run once, then occasionally —
 * everything downstream reads the local copy instead of asking the API
 * per candidate.
 */
export async function sync() {
  const { config, client, library } = await buildApp({ requirePlayer: false });

  if (!config.lastfm.user) {
    console.error('No Last.fm user. Run: autodj login');
    process.exitCode = 1;
    return;
  }

  console.log(bold(`\n  syncing library for ${cyan(config.lastfm.user)}\n`));
  const started = Date.now();

  const data = await syncLibrary(client, config.lastfm.user, {
    onProgress: ({ method, page, totalPages, total }) => {
      const label = method === 'user.getTopTracks' ? 'tracks ' : 'artists';
      process.stdout.write(
        `${clearLine}  ${label}  page ${page}/${totalPages}  ${dim(`of ${total.toLocaleString()}`)}`,
      );
    },
  });

  library.save(data);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`${clearLine}${green('  ✔')} ${bold(data.totals.fetchedTracks.toLocaleString())} tracks · ${bold(data.totals.fetchedArtists.toLocaleString())} artists ${dim(`in ${seconds}s`)}`);
  console.log(dim(`    reported totals: ${data.totals.tracks.toLocaleString()} tracks, ${data.totals.artists.toLocaleString()} artists`));
  console.log(dim('    --discover and --hits now decide from the full library.\n'));
}
