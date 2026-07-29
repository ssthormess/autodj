/**
 * The Mac's play/pause and next/prev buttons.
 *
 * macOS does not deliver media keys as keystrokes. `mediaremoted` routes them
 * to whichever process registered with MPRemoteCommandCenter and is currently
 * the Now Playing app — which mpv already does, even started headless with
 * `--no-video --no-terminal`, because it links MediaPlayer.framework and
 * registers togglePlayPause / nextTrack / previousTrack / stop on playback.
 *
 * mpv feeds those commands back into its ordinary input layer as the key names
 * below, so rebinding them over IPC is all it takes to route a hardware button
 * to the DJ. `script-message` then arrives here as a `client-message` event.
 *
 * Doing it this way means no extra helper binary, no Accessibility permission
 * and no global event tap — the keys reach us only while autodj is the thing
 * playing, which is exactly the scope a media button should have.
 */
export const MEDIA_MESSAGE = 'autodj-media';

/**
 * mpv key name -> action. PLAY and PAUSE are bound alongside PLAYPAUSE because
 * some keyboards and most Bluetooth headsets send the discrete commands rather
 * than the toggle.
 */
export const MEDIA_BINDINGS = [
  ['PLAYPAUSE', 'playpause'],
  ['PLAY', 'play'],
  ['PAUSE', 'pause'],
  ['NEXT', 'next'],
  ['PREV', 'prev'],
  ['STOP', 'stop'],
];

/** Rebind the media keys away from mpv's playlist defaults, onto us. */
export async function bindMediaKeys(ipc) {
  const bound = [];
  for (const [key, action] of MEDIA_BINDINGS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await ipc.command('keybind', key, `script-message ${MEDIA_MESSAGE} ${action}`);
      bound.push(key);
    } catch {
      // An mpv too old for `keybind` simply keeps its own defaults.
    }
  }
  return bound;
}

/** The action carried by a client-message event, or null if it isn't ours. */
export function mediaAction(message) {
  const args = message?.args ?? [];
  return args[0] === MEDIA_MESSAGE && args[1] ? args[1] : null;
}
