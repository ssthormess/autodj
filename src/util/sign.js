import { createHash } from 'node:crypto';

/**
 * Last.fm api_sig: sort params by key, concatenate `key + value`, append the
 * shared secret, then MD5. `format` and `callback` are excluded by spec.
 */
export function signParams(params, secret) {
  const payload = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback' && params[k] !== undefined)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return createHash('md5').update(`${payload}${secret}`, 'utf8').digest('hex');
}
