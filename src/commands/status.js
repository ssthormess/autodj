import { loadConfig, merge } from '../config/config.js';
import { createHistory } from '../dj/history.js';
import { createAffinity } from '../dj/affinity.js';
import { createLibrary } from '../library/store.js';
import { credentialsFromPear } from '../lastfm/auth.js';
import { CONFIG_FILE, HISTORY_FILE } from '../config/paths.js';
import { bold, dim, cyan, green } from '../ui/ansi.js';

export async function status() {
  const stored = loadConfig();
  // Resolve credentials the same way buildApp does, so status reports what a
  // real run would actually use rather than only what has been written down.
  const config =
    stored.lastfm.sessionKey ? stored : merge(stored, { lastfm: credentialsFromPear() ?? {} });
  const stats = createHistory().stats();
  const affinity = createAffinity();
  const library = createLibrary();
  const taste = affinity.stats();

  const row = (k, v) => console.log(`  ${dim(k.padEnd(18))} ${v}`);

  console.log(bold('\n  autodj status\n'));
  row('last.fm user', config.lastfm.user ? cyan(config.lastfm.user) : dim('— (run: autodj login)'));
  row('scrobbling', config.scrobble.enabled ? green('on') : dim('off'));
  row('session key', config.lastfm.sessionKey ? green('present') : dim('missing'));
  row('llm curation', config.llm.enabled ? `${green('on')} ${dim(config.llm.model)}` : dim('off'));
  console.log('');
  const lib = library.stats();
  if (lib.tracks) {
    const age = lib.syncedAt ? `${Math.round((Date.now() - lib.syncedAt) / 86400_000)}d ago` : '';
    row('library', `${green(lib.tracks.toLocaleString())} tracks · ${green(lib.artists.toLocaleString())} artists ${dim(age)}`);
  } else {
    row('library', `${dim('not synced')} ${dim('— run: autodj sync')}`);
  }
  row('lastfm feeds', config.sources.lastfmWeb ? green('on') : dim('off'));
  row('ytm feeds', config.sources.ytmFeeds ? green('on') : dim('off'));
  row('listenbrainz', config.sources.listenBrainz
    ? `${green('on')} ${dim(config.listenbrainz.user ? `CF as ${config.listenbrainz.user}` : 'similarity only (no account)')}`
    : dim('off'));
  console.log('');
  row('tracks played', stats.played);
  row('tracks skipped', stats.skipped);
  row('banned', stats.banned);
  row('loved', stats.loved);
  console.log('');
  row('votes: tracks', taste.tracks);
  row('votes: artists', taste.artists);
  row('votes: albums', taste.albums);
  row('votes: tags', taste.tags);

  const likedArtists = affinity.top('artists', 5);
  const likedTags = affinity.top('tags', 5);
  if (likedArtists.length) {
    console.log('');
    row('top artists', likedArtists.map((a) => `${a.key} ${dim(a.value.toFixed(2))}`).join(', '));
  }
  if (likedTags.length) row('top tags', likedTags.map((t) => `${t.key} ${dim(t.value.toFixed(2))}`).join(', '));
  console.log('');
  row('config', dim(CONFIG_FILE));
  row('history', dim(HISTORY_FILE));
  console.log('');
}
