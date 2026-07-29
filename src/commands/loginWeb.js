import { loadConfig } from '../config/config.js';
import { lastfmCookieHeader, hasSqlite } from '../lastfm/cookies.js';
import { createWebSource } from '../lastfm/web.js';
import { createFeeds } from '../ytm/feeds.js';
import { bold, green, red, yellow, dim } from '../ui/ansi.js';

const ok = (m) => console.log(`${green('✔')} ${m}`);
const bad = (m) => console.log(`${red('✖')} ${m}`);
const meh = (m) => console.log(`${yellow('!')} ${m}`);

/**
 * Verifies the two browser-session-backed feeds.
 *
 * Neither Last.fm's recommendation stations nor YouTube Music's personalised
 * mixes are reachable through a documented API — both are only served to a
 * logged-in session. This reads the session your browser already holds; no
 * password is requested and nothing is transmitted anywhere but to those two
 * sites, exactly as the browser itself would.
 */
export async function loginWeb() {
  const config = loadConfig();
  console.log(bold('\n  browser-backed recommendation feeds\n'));

  if (!(await hasSqlite())) {
    bad('sqlite3 not found — cannot read the Firefox cookie store');
    return;
  }

  // --- Last.fm ------------------------------------------------------------
  const cookie = await lastfmCookieHeader();
  if (!cookie) {
    bad('no Last.fm session in Firefox — log in at https://www.last.fm/login, then re-run');
  } else {
    ok(`found a Last.fm session cookie ${dim('(value not shown)')}`);

    if (!config.lastfm.user) {
      meh('no Last.fm username known yet — run `autodj login` first');
    } else {
      const web = createWebSource({ user: config.lastfm.user, cookie });
      for (const name of ['recommended', 'mix', 'library']) {
        // eslint-disable-next-line no-await-in-loop
        const tracks = await web.station(name, 5);
        if (tracks.length) {
          ok(`station ${bold(name)} → ${tracks.length} tracks ${dim(`e.g. ${tracks[0].artist} — ${tracks[0].name}`)}`);
        } else {
          bad(`station ${bold(name)} returned nothing`);
        }
      }
    }
  }

  // --- YouTube Music ------------------------------------------------------
  console.log('');
  if (!config.sources.cookiesFromBrowser) {
    meh('sources.cookiesFromBrowser is null — YouTube Music personalised mixes disabled');
    return;
  }

  const feeds = createFeeds(config);
  for (const [name, fn] of [
    ['Liked Music', () => feeds.liked(5)],
    ['Recommendations', () => feeds.recommendations(5)],
    ['History', () => feeds.history(5)],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const tracks = await fn();
    if (tracks.length) {
      ok(`YouTube ${bold(name)} → ${tracks.length} tracks ${dim(`e.g. ${tracks[0].artist} — ${tracks[0].name}`)}`);
    } else {
      bad(`YouTube ${bold(name)} returned nothing`);
    }
  }

  console.log(dim('\n  If a feed is empty, check that yt-dlp reads the right Firefox profile:'));
  console.log(dim(`    sources.cookiesFromBrowser = "${config.sources.cookiesFromBrowser}"`));
  console.log(dim('    you have multiple profiles; append a path to target one, e.g.'));
  console.log(dim('    "firefox:~/Library/Application Support/Firefox/Profiles/iw6pct0o.default-release"'));
  console.log('');
}
