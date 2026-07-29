import { createInterface } from 'node:readline/promises';
import { loadConfig, saveConfig, merge } from '../config/config.js';
import { credentialsFromPear, whoami } from '../lastfm/auth.js';
import { createClient } from '../lastfm/client.js';
import { signParams } from '../util/sign.js';
import { bold, green, dim, cyan } from '../ui/ansi.js';
import { info, error } from '../util/log.js';

/**
 * Two ways in: lift the already-authorised session out of Pear Desktop, or run
 * the standard Last.fm desktop auth flow (open auth URL → user approves →
 * exchange the token for a session key).
 */
export async function login({ fresh = false } = {}) {
  let config = loadConfig();

  if (!fresh) {
    const pear = credentialsFromPear();
    if (pear?.sessionKey) {
      config = merge(config, { lastfm: pear });
      const client = createClient(pear);
      const me = await whoami(client).catch(() => null);
      if (me?.name) {
        config = merge(config, { lastfm: { user: me.name } });
        saveConfig(config);
        console.log(
          `${green('✔')} reused Pear Desktop session — signed in as ${bold(me.name)} ` +
            dim(`(${me.playcount.toLocaleString()} scrobbles)`),
        );
        return config;
      }
    }
    info('no usable Pear session found, falling back to browser auth');
  }

  const { apiKey, secret } = config.lastfm.apiKey ? config.lastfm : credentialsFromPear() ?? {};
  if (!apiKey || !secret) {
    error('no Last.fm API key/secret available. Set lastfm.apiKey and lastfm.secret in ~/.config/autodj/config.json');
    process.exitCode = 1;
    return null;
  }

  const client = createClient({ apiKey, secret });
  const { token } = await client.request('auth.getToken');

  const url = `https://www.last.fm/api/auth/?api_key=${apiKey}&token=${token}`;
  console.log(`\n  Approve access here:\n  ${cyan(url)}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('  Press Enter once approved… ');
  rl.close();

  const params = { api_key: apiKey, method: 'auth.getSession', token };
  const json = await client.request('auth.getSession', {
    token,
    api_sig: signParams(params, secret),
  });

  const sessionKey = json.session?.key;
  const user = json.session?.name;
  if (!sessionKey) {
    error('Last.fm did not return a session key');
    process.exitCode = 1;
    return null;
  }

  config = merge(config, { lastfm: { apiKey, secret, sessionKey, user } });
  saveConfig(config);
  console.log(`${green('✔')} signed in as ${bold(user)}`);
  return config;
}
