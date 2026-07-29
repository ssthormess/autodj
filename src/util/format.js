export const plural = (count, word, suffix = 's') =>
  `${count} ${word}${count === 1 ? '' : suffix}`;
