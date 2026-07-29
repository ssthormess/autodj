import { signParams } from '../util/sign.js';
import { readCache, writeCache } from '../util/cache.js';
import { debug } from '../util/log.js';

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';

export class LastfmError extends Error {
  constructor(code, message) {
    super(`Last.fm error ${code}: ${message}`);
    this.code = Number(code);
  }
}

/** Errors Last.fm documents as worth retrying rather than surfacing. */
const RETRYABLE = new Set([8, 11, 16, 29]);

export function createClient({ apiKey, secret, sessionKey, cacheTtl = 604800 }) {
  async function request(method, params = {}, { signed = false, post = false, cache = false } = {}) {
    const query = { ...params, method, api_key: apiKey, format: 'json' };
    if (signed) {
      query.sk = sessionKey;
      // api_sig must be computed over the params *without* format.
      query.api_sig = signParams({ ...query, format: undefined }, secret);
    }

    const cacheInput = JSON.stringify({ method, params });
    if (cache) {
      const hit = readCache('lastfm', cacheInput, cacheTtl);
      if (hit) return hit;
    }

    const body = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null),
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = post
        ? await fetch(API_ROOT, {
            method: 'POST',
            body,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          })
        : await fetch(`${API_ROOT}?${body}`);

      const json = await response.json().catch(() => ({}));

      if (json.error) {
        if (RETRYABLE.has(Number(json.error)) && attempt < 2) {
          await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
          continue;
        }
        throw new LastfmError(json.error, json.message);
      }

      debug(`lastfm ${method}`, JSON.stringify(params).slice(0, 90));
      return cache ? writeCache('lastfm', cacheInput, json) : json;
    }
    throw new LastfmError(-1, `${method} failed after retries`);
  }

  return { request };
}

/** Last.fm returns bare objects when a list has exactly one member. */
export const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
