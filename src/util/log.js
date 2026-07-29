import { dim, red, yellow, cyan } from '../ui/ansi.js';


let verbose = false;
export const setVerbose = (value) => {
  verbose = value;
};

/**
 * While a full-screen UI is running it must own the terminal: a stray
 * `console.error` from a background lane interleaves with the repaint and the
 * whole frame appears to scroll past instead of updating in place. The TUI
 * installs a sink to collect messages and render them itself.
 */
let sink = null;
export const setSink = (fn) => {
  sink = fn;
};

const emit = (level, prefix, args) => {
  const text = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  if (sink) {
    sink(level, text);
    return;
  }
  console.error(prefix, text);
};

export const info = (...a) => emit('info', cyan('›'), a);
export const warn = (...a) => emit('warn', yellow('!'), a);
export const error = (...a) => emit('error', red('✖'), a);
export const debug = (...a) => {
  if (verbose) emit('debug', dim('·'), a);
};
