#!/usr/bin/env node
import { radio } from '../src/commands/radio.js';
import { preview } from '../src/commands/preview.js';
import { login } from '../src/commands/login.js';
import { loginWeb } from '../src/commands/loginWeb.js';
import { doctor } from '../src/commands/doctor.js';
import { status } from '../src/commands/status.js';
import { sync } from '../src/commands/sync.js';
import { unvote } from '../src/commands/unvote.js';
import { MODES, modeNames } from '../src/dj/modes.js';
import { bold, cyan, dim } from '../src/ui/ansi.js';
import { error } from '../src/util/log.js';

const argv = process.argv.slice(2);

function flag(name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

function usage() {
  console.log(`
  ${bold(cyan('autodj'))} ${dim('— continuous Last.fm-driven radio, scrobbled back')}

  ${bold('usage')}
    autodj                          start the radio
    autodj radio                    same thing, explicitly
    autodj radio --mood "<text>"    steer the set with a direction
    autodj radio --from "Artist - Track"
                                    start from a specific track
    autodj preview                  dry-run one set, no audio, no scrobbles
    autodj preview --resolve        …and check each track resolves on YouTube Music
    autodj login                    authorise Last.fm (reuses Pear Desktop's session)
    autodj login --fresh            force the browser auth flow
    autodj login --web              enable Last.fm + YTM recommendation feeds
                                    (reads the sessions Firefox already holds)
    autodj unvote "Artist - Track"  take back a vote cast by mistake
    autodj unvote                   …take back the most recent one
    autodj sync                     mirror your full Last.fm library locally
    autodj status                   config + listening stats
    autodj doctor                   check mpv, yt-dlp, credentials

  ${bold('modes')}
${modeNames.map((m) => `    --${m.padEnd(12)} ${dim(MODES[m].description)}`).join('\n')}

  ${bold('flags')}
    --mode <name> same as the shortcuts above
    --no-llm      skip the LLM sequencing pass
    --verbose     show API and resolver detail, plus per-lane candidate counts
    --help        this

  ${bold('keys while playing')}
    space pause   ←/→ prev/next   n skip(-)   ↑/↓ vote   u undo vote   l love   x ban
    b boost (toggle)   m mood   r refill   +/- volume   q quit
`);
}

async function main() {
  const command = argv.find((a) => !a.startsWith('--')) ?? 'radio';

  if (argv.includes('--help') || argv.includes('-h')) return usage();

  const verbose = argv.includes('--verbose');
  const noLlm = argv.includes('--no-llm');

  // `--discover` is sugar for `--mode discover`, and so on for each mode.
  const modeShortcut = modeNames.find((m) => argv.includes(`--${m}`));
  const mode = modeShortcut ?? (typeof flag('mode') === 'string' ? flag('mode') : null);

  switch (command) {
    case 'radio':
      return radio({
        mood: typeof flag('mood') === 'string' ? flag('mood') : null,
        seedQuery: typeof flag('from') === 'string' ? flag('from') : null,
        mode,
        verbose,
        noLlm,
      });
    case 'preview':
      return preview({
        mood: typeof flag('mood') === 'string' ? flag('mood') : null,
        resolve: argv.includes('--resolve'),
        mode,
        verbose,
        noLlm,
      });
    case 'login':
      return argv.includes('--web') ? loginWeb() : login({ fresh: Boolean(flag('fresh')) });
    case 'unvote':
      return unvote(argv.filter((a) => !a.startsWith('--'))[1] ?? null);
    case 'sync':
      return sync();
    case 'status':
      return status();
    case 'doctor':
      return doctor();
    default:
      error(`unknown command: ${command}`);
      usage();
      process.exitCode = 1;
      return undefined;
  }
}

main().catch((err) => {
  error(err.stack ?? err.message);
  process.exit(1);
});
