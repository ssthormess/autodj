import { loadConfig, saveConfig, merge } from './config/config.js';
import { createClient } from './lastfm/client.js';
import { createResolver } from './lastfm/correct.js';
import { createUserSource } from './lastfm/user.js';
import { createSimilarSource } from './lastfm/similar.js';
import { createTagSource } from './lastfm/tags.js';
import { createScrobbler } from './lastfm/scrobble.js';
import { createSearcher } from './ytm/search.js';
import { createFeeds } from './ytm/feeds.js';
import { createWebSource } from './lastfm/web.js';
import { createListenBrainz } from './listenbrainz/client.js';
import { createCurator } from './llm/curate.js';
import { createHistory } from './dj/history.js';
import { createAffinity } from './dj/affinity.js';
import { createEnricher } from './dj/enrich.js';
import { createMoodResolver } from './dj/mood.js';
import { createAcousticBrainz } from './acousticbrainz/client.js';
import { createLibrary } from './library/store.js';
import { credentialsFromPear, whoami } from './lastfm/auth.js';
import { Player } from './player/mpv.js';
import { DjEngine } from './dj/engine.js';

/**
 * Composition root. Everything is wired here and nowhere else, so each module
 * stays a plain function of its inputs and can be exercised in isolation.
 */
export async function buildApp({ requirePlayer = true, overrides = null } = {}) {
  // Two distinct objects on purpose.
  //
  // `stored` is what lives on disk and only ever gains credentials we
  // discover. `config` is what this process runs with, and carries the
  // per-invocation flags on top. Merging the two before saving is how a
  // one-off `--no-llm` silently became a permanent setting.
  let stored = loadConfig();

  // Fall back to Pear Desktop's authorised session if we have none of our own.
  if (!stored.lastfm.apiKey || !stored.lastfm.sessionKey) {
    const pear = credentialsFromPear();
    if (pear) stored = saveConfig(merge(stored, { lastfm: pear }));
  }

  const client = createClient({
    apiKey: stored.lastfm.apiKey,
    secret: stored.lastfm.secret,
    sessionKey: stored.lastfm.sessionKey,
    cacheTtl: stored.cache.ttlSeconds,
  });

  // Learn the username from the session rather than making the user type it.
  if (!stored.lastfm.user && stored.lastfm.sessionKey) {
    const me = await whoami(client).catch(() => null);
    if (me?.name) stored = saveConfig(merge(stored, { lastfm: { user: me.name } }));
  }

  const config = overrides ? merge(stored, overrides) : stored;

  const searcher = createSearcher(config);
  const sources = {
    user: createUserSource(client, config.lastfm.user),
    similar: createSimilarSource(client),
    tags: createTagSource(client),
    searcher,
    // First-party recommendation feeds. Each degrades to an empty lane when
    // its session is missing, so the DJ never hard-fails on a missing cookie.
    web: config.sources.lastfmWeb
      ? createWebSource({ user: config.lastfm.user, cookie: config.lastfm.webCookie })
      : null,
    feeds: config.sources.ytmFeeds ? createFeeds(config) : null,
    lb: config.sources.listenBrainz
      ? createListenBrainz({ user: config.listenbrainz.user })
      : null,
  };

  const resolver = createResolver(client, { user: config.lastfm.user });
  const scrobbler = createScrobbler(client, config);
  const history = createHistory();
  const affinity = createAffinity();
  const library = createLibrary();
  const moodResolver = createMoodResolver({
    tags: sources.tags, similar: sources.similar, config,
  });
  const curator = createCurator(config);
  const enricher = createEnricher(createAcousticBrainz(), {
    enabled: config.sources.acousticBrainz,
  });

  const player = new Player(config);
  if (requirePlayer) await player.start();

  const engine = new DjEngine({
    config, sources, player, scrobbler, history, affinity, curator, resolver, enricher, library, moodResolver,
  });

  return {
    config, client, sources, resolver, scrobbler, history, affinity, curator,
    enricher, library, moodResolver, player, engine,
  };
}
