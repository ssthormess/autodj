import { dim, red, yellow, cyan } from '../ui/ansi.js';


let verbose = false;
export const setVerbose = (value) => {
  verbose = value;
};

export const info = (...a) => console.error(cyan('›'), ...a);
export const warn = (...a) => console.error(yellow('!'), ...a);
export const error = (...a) => console.error(red('✖'), ...a);
export const debug = (...a) => {
  if (verbose) console.error(dim('·'), ...a.map(String).map(dim));
};
