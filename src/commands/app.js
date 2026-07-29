import { realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR, ensureDirs } from '../config/paths.js';
import { writeBundle, APP_NAME } from '../macos/bundle.js';
import { bold, cyan, dim, green, yellow } from '../ui/ansi.js';
import { error } from '../util/log.js';

/**
 * Install AutoDJ.app.
 *
 * The point is findability: double-clicking gets you one dedicated window with
 * a known name, and clicking again raises it rather than starting a second
 * radio — instead of hunting for a tab among thirty others.
 */
export async function app({ directory = null, icon = null } = {}) {
  if (process.platform !== 'darwin') {
    error('`autodj app` builds a macOS bundle; this is not macOS');
    process.exitCode = 1;
    return;
  }

  ensureDirs();

  // Absolute paths: a GUI-launched app inherits a bare PATH and would not find
  // either node or the CLI through the user's shell profile.
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = realpathSync(resolve(here, '..', '..', 'bin', 'autodj.js'));
  const node = realpathSync(process.execPath);

  if (icon && !existsSync(icon)) {
    error(`no such icon file: ${icon}`);
    process.exitCode = 1;
    return;
  }

  const target = directory ?? join(homedir(), 'Applications');

  const { app: bundle, withIcon } = await writeBundle({
    directory: target,
    node,
    entry,
    idFile: join(CONFIG_DIR, 'window.id'),
    // The window runs a login shell so mpv and yt-dlp are on PATH; use the
    // user's own, since that is the profile those tools were installed into.
    shell: process.env.SHELL || '/bin/zsh',
    icon,
  });

  console.log(`
  ${green('installed')}  ${bold(bundle)}

  ${dim('runs')}       ${node} ${entry}
  ${dim('window')}     a dedicated ${existsSync('/Applications/iTerm.app') ? 'iTerm2' : 'Terminal'} window named ${cyan(APP_NAME)}
  ${dim('icon')}       ${withIcon ? 'custom' : yellow('generic — pass --icon <file.png> to set your own')}

  ${bold('next')}
    open it once, then right-click its Dock icon → Options → Keep in Dock.

  ${dim('Launching it again while it is playing raises that window instead of')}
  ${dim('starting a second radio.')}
`);
}
