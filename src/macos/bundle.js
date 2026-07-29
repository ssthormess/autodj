import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { launcherScript } from './launcher.js';

const run = promisify(execFile);

const BUNDLE_ID = 'net.phoebo.autodj';
const APP_NAME = 'AutoDJ';

/** Sizes macOS expects in an .icns, each at 1x and 2x. */
const ICON_SIZES = [16, 32, 128, 256, 512];

const infoPlist = ({ withIcon, version }) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleExecutable</key><string>${APP_NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
${withIcon ? `  <key>CFBundleIconFile</key><string>${APP_NAME}</string>\n` : ''}  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;

/**
 * Convert a square PNG into the .icns the Dock wants.
 *
 * sips and iconutil both ship with macOS, so this needs no toolchain — but it
 * needs a real image from the user. Nothing here invents artwork: without an
 * icon the bundle simply carries the system's generic one.
 */
async function buildIcon(source, resources) {
  const iconset = join(resources, `${APP_NAME}.iconset`);
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset, { recursive: true });

  for (const size of ICON_SIZES) {
    // eslint-disable-next-line no-await-in-loop
    await run('sips', ['-z', String(size), String(size), source, '--out', join(iconset, `icon_${size}x${size}.png`)]);
    // eslint-disable-next-line no-await-in-loop
    await run('sips', ['-z', String(size * 2), String(size * 2), source, '--out', join(iconset, `icon_${size}x${size}@2x.png`)]);
  }

  await run('iconutil', ['-c', 'icns', iconset, '-o', join(resources, `${APP_NAME}.icns`)]);
  rmSync(iconset, { recursive: true, force: true });
}

/**
 * Write (or rewrite) the .app bundle.
 *
 * Rewriting in place is deliberate: re-running the command after an upgrade
 * refreshes the launcher without the user having to delete anything, and the
 * bundle keeps whatever position it already has in the Dock.
 */
export async function writeBundle({
  directory, node, entry, idFile, shell, icon = null, version = '1.0',
}) {
  const app = join(directory, `${APP_NAME}.app`);
  const contents = join(app, 'Contents');
  const macos = join(contents, 'MacOS');
  const resources = join(contents, 'Resources');

  mkdirSync(macos, { recursive: true });
  mkdirSync(resources, { recursive: true });

  let withIcon = existsSync(join(resources, `${APP_NAME}.icns`));
  if (icon) {
    await buildIcon(icon, resources);
    withIcon = true;
  }

  writeFileSync(join(contents, 'Info.plist'), infoPlist({ withIcon, version }));

  const launcher = join(macos, APP_NAME);
  writeFileSync(launcher, launcherScript({ node, entry, idFile, shell }), { mode: 0o755 });

  // Finder caches bundle metadata; touching the bundle makes it re-read.
  await run('touch', [app]).catch(() => {});

  return { app, withIcon };
}

export { APP_NAME };
