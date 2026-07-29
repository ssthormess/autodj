import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../config/config.js';
import { credentialsFromPear, whoami } from '../lastfm/auth.js';
import { createClient } from '../lastfm/client.js';
import { createListenBrainz } from '../listenbrainz/client.js';
import { hasSqlite } from '../lastfm/cookies.js';
import { green, red, yellow, bold, dim } from '../ui/ansi.js';

const run = promisify(execFile);

const ok = (m) => console.log(`${green('✔')} ${m}`);
const bad = (m) => console.log(`${red('✖')} ${m}`);
const meh = (m) => console.log(`${yellow('!')} ${m}`);

async function checkBinary(name, args = ['--version']) {
  try {
    const { stdout } = await run(name, args, { timeout: 15000 });
    ok(`${bold(name)} ${dim(stdout.trim().split('\n')[0].slice(0, 60))}`);
    return true;
  } catch {
    bad(`${bold(name)} not found — install with: brew install ${name}`);
    return false;
  }
}

export async function doctor() {
  console.log(bold('\n  autodj doctor\n'));

  await checkBinary('mpv');
  await checkBinary('yt-dlp');

  const config = loadConfig();
  const creds = config.lastfm.apiKey ? config.lastfm : credentialsFromPear();

  if (!creds?.apiKey) {
    bad('no Last.fm API credentials (run: autodj login)');
  } else {
    ok(`Last.fm API key ${dim(`${creds.apiKey.slice(0, 8)}…`)}`);

    if (!creds.sessionKey) {
      bad('no Last.fm session key — scrobbling disabled (run: autodj login)');
    } else {
      const client = createClient(creds);
      try {
        const me = await whoami(client);
        ok(`authenticated as ${bold(me.name)} ${dim(`(${me.playcount.toLocaleString()} scrobbles)`)}`);
      } catch (err) {
        bad(`session key rejected: ${err.message}`);
      }
    }
  }

  // --- recommendation feeds ------------------------------------------------
  if (config.sources.listenBrainz) {
    const lb = createListenBrainz({ user: config.listenbrainz.user });
    const neighbours = await lb
      .similarArtists('a74b1b7f-71a5-4011-9441-d0b5e4122711', 1)
      .catch(() => []);
    if (neighbours.length) ok(`ListenBrainz similarity reachable ${dim('(no account needed)')}`);
    else bad('ListenBrainz similarity unreachable');

    if (config.listenbrainz.user) {
      const has = await lb.hasAccount().catch(() => false);
      if (has) ok(`ListenBrainz CF recommendations for ${bold(config.listenbrainz.user)}`);
      else meh(`ListenBrainz user "${config.listenbrainz.user}" has no listens — CF lane will be empty`);
    } else {
      meh('no listenbrainz.user set — CF recommendations disabled, similarity still active');
    }
  }

  if (config.sources.lastfmWeb || config.sources.ytmFeeds) {
    const sqlite = await hasSqlite();
    if (!sqlite) bad('sqlite3 missing — browser-backed feeds cannot read the cookie store');
    else meh('browser-backed feeds: run `autodj login --web` to verify Last.fm + YTM sessions');
  }

  if (config.llm.enabled) {
    const has = await checkBinary(config.llm.command, ['--version']);
    if (!has) meh('LLM curation will be skipped; the DJ still works without it');
  } else {
    meh('LLM curation disabled in config');
  }

  console.log('');
}
