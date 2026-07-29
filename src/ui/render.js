import {
  CLEAR, bold, dim, green, cyan, magenta, yellow, grey, bar, time, truncate,
} from './ansi.js';
import { label } from '../util/track.js';
import { plural } from '../util/format.js';

const width = () => Math.min(process.stdout.columns || 80, 100);

const sourceTag = (track) => {
  if (track.curated) return magenta('llm');
  return grey(track.source ?? 'lastfm');
};

export function renderNowPlaying(state) {
  const w = width();
  const { track, position, duration, paused, queue, stats, mood, mode, scrobbled } = state;
  const lines = [];

  lines.push(
    bold(cyan('  autodj')) +
      (mode ? magenta(` ${mode}`) : '') +
      dim(`  ${stats.played} played · ${stats.banned} banned`),
  );
  lines.push('');

  if (!track) {
    lines.push(dim('  finding something to play…'));
  } else {
    lines.push(`  ${bold(truncate(track.name, w - 6))}`);
    lines.push(`  ${cyan(truncate(track.artist, w - 6))}${track.album ? dim(` · ${truncate(track.album, 30)}`) : ''}`);
    lines.push('');

    const ratio = duration ? position / duration : 0;
    lines.push(`  ${paused ? yellow('❚❚') : green('▶')}  ${bar(ratio, w - 22)} ${dim(`${time(position)}/${time(duration)}`)}`);

    const badges = [
      sourceTag(track),
      track.userLoved ? green('♥') : null,
      track.userPlaycount ? dim(plural(track.userPlaycount, 'play')) : dim('new to you'),
      scrobbled ? green('scrobbled') : dim('…'),
      track.seed ? dim(`via ${truncate(track.seed, 28)}`) : null,
    ].filter(Boolean);
    lines.push(`  ${badges.join(dim(' · '))}`);
  }

  if (mood) {
    lines.push('');
    lines.push(`  ${magenta('mood')} ${dim(mood)}`);
  }

  lines.push('');
  lines.push(dim(`  up next (${queue.length})`));
  for (const item of queue.slice(0, 5)) {
    lines.push(`    ${dim('·')} ${truncate(label(item), w - 8)}  ${sourceTag(item)}`);
  }
  if (!queue.length) lines.push(dim('    (refilling…)'));

  lines.push('');
  lines.push(
    dim('  [space] pause  [n] skip  [↑/↓] vote  [l] love  [b] ban  [m] mood  [r] refill  [+/-] vol  [q] quit'),
  );

  return CLEAR + lines.join('\n') + '\n';
}

export function renderLine(text) {
  return `${text}\n`;
}
