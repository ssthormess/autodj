const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const bold = wrap(1);
export const dim = wrap(2);
export const red = wrap(31);
export const green = wrap(32);
export const yellow = wrap(33);
export const blue = wrap(34);
export const magenta = wrap(35);
export const cyan = wrap(36);
export const grey = wrap(90);

export const CLEAR = '\x1b[2J\x1b[H';
export const HIDE_CURSOR = '\x1b[?25l';
export const SHOW_CURSOR = '\x1b[?25h';
export const clearLine = '\r\x1b[2K';

export function bar(ratio, width) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `${'━'.repeat(filled)}${dim('─'.repeat(width - filled))}`;
}

export function time(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
