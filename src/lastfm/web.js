import { lastfmCookieHeader } from './cookies.js';
import { debug, warn } from '../util/log.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0';

/**
 * Last.fm's real recommendation feeds, taken from the logged-in website.
 *
 * These are the stations the site itself plays: "Recommended" (things you
 * haven't heard, drawn from Last.fm's own model), "Mix" (a blend of your
 * library and recommendations), and "Library" (your own scrobbled catalogue).
 * They are the closest thing to the homepage recommendations, and there is no
 * public API equivalent.
 */
export function createWebSource({ user, cookie = null }) {
  let cookieHeader = cookie;
  let unavailable = false;
  let pending = null;

  /**
   * Single-flight. The three stations run as concurrent lanes during a refill,
   * so without this they would each kick off their own cookie read at the same
   * moment and contend over the browser's database.
   */
  async function ensureCookie() {
    if (cookieHeader || unavailable) return cookieHeader;
    if (!pending) {
      pending = lastfmCookieHeader().finally(() => {
        pending = null;
      });
    }
    cookieHeader = await pending;
    if (!cookieHeader) {
      unavailable = true;
      warn('no Last.fm web session found — recommendation stations disabled (run: autodj login --web)');
    }
    return cookieHeader;
  }

  async function station(name, limit = 40) {
    const header = await ensureCookie();
    if (!header) return [];

    const url = `https://www.last.fm/player/station/user/${encodeURIComponent(user)}/${name}?ajax=1`;
    try {
      const response = await fetch(url, {
        headers: {
          cookie: header,
          'user-agent': UA,
          accept: 'application/json, text/javascript, */*; q=0.01',
          'x-requested-with': 'XMLHttpRequest',
          referer: `https://www.last.fm/user/${encodeURIComponent(user)}`,
        },
      });

      if (response.status === 403 || response.status === 401) {
        unavailable = true;
        warn(`Last.fm rejected the web session for station "${name}" — re-run: autodj login --web`);
        return [];
      }
      if (!response.ok) {
        debug(`station ${name} → HTTP ${response.status}`);
        return [];
      }

      const json = await response.json();
      const playlist = json.playlist ?? json.playlists?.[0]?.playlist ?? [];

      return playlist
        .map((item) => ({
          artist: item.artists?.[0]?.name ?? item.artist,
          name: item.name ?? item.title,
          duration: Number(item.duration) || null,
          source: `lastfm-${name}`,
          seed: `last.fm ${name} station`,
        }))
        .filter((t) => t.artist && t.name)
        .slice(0, limit);
    } catch (err) {
      debug(`station ${name} failed: ${err.message}`);
      return [];
    }
  }

  /** Things Last.fm thinks you'll like and haven't scrobbled. */
  const recommended = (limit) => station('recommended', limit);
  /** Library + recommendations blended, the site's default "Mix". */
  const mix = (limit) => station('mix', limit);
  /** Your own scrobbled catalogue, shuffled. */
  const library = (limit) => station('library', limit);

  const available = () => !unavailable;

  return { recommended, mix, library, station, available };
}
