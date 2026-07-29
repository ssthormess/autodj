import { readFileSync, existsSync } from 'node:fs';
import { PEAR_CONFIG } from '../config/paths.js';
import { warn } from '../util/log.js';

/**
 * Pear Desktop (the YouTube Music app) already holds an authorised Last.fm
 * session. Reuse it so there's no second OAuth dance — its API key is bundled
 * in the open-source app, so it is not a secret.
 */
export function credentialsFromPear() {
  if (!existsSync(PEAR_CONFIG)) return null;
  try {
    const config = JSON.parse(readFileSync(PEAR_CONFIG, 'utf8'));
    const lastfm = config?.plugins?.scrobbler?.scrobblers?.lastfm;
    if (!lastfm?.apiKey || !lastfm?.secret) return null;
    return {
      apiKey: lastfm.apiKey,
      secret: lastfm.secret,
      sessionKey: lastfm.sessionKey ?? null,
    };
  } catch (err) {
    warn(`could not read Pear config: ${err.message}`);
    return null;
  }
}

/** Confirm the session key works and learn the username it belongs to. */
export async function whoami(client) {
  const json = await client.request('user.getInfo', {}, { signed: true });
  return {
    name: json.user?.name,
    playcount: Number(json.user?.playcount) || 0,
    url: json.user?.url,
  };
}

export function assertScrobbleReady(config) {
  const { apiKey, secret, sessionKey } = config.lastfm;
  if (!apiKey || !secret) throw new Error('No Last.fm API key/secret. Run: autodj login');
  if (!sessionKey) throw new Error('No Last.fm session key. Run: autodj login');
}
