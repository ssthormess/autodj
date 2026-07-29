/**
 * La hora, dicha como la diría una emisora.
 *
 * El español parte el día en cuatro, no en dos: madrugada, mañana, tarde y
 * noche. Un "AM/PM" traducido literalmente suena a máquina, así que la franja
 * se calcula por hora real. La una va en femenino — "una", no "uno" — porque
 * se concuerda con "la hora".
 */
const NUMBERS = [
  'doce', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis',
  'siete', 'ocho', 'nueve', 'diez', 'once', 'doce',
];

/** Franja horaria al uso hispano. */
function periodOf(hour) {
  if (hour === 0) return 'de la noche';
  if (hour < 6) return 'de la madrugada';
  if (hour < 12) return 'de la mañana';
  if (hour === 12) return 'del mediodía';
  if (hour < 20) return 'de la tarde';
  return 'de la noche';
}

/** Capitaliza la primera letra, para que la voz entre con acento de frase. */
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * "Ocho de la mañana, radio reloj".
 *
 * `station` es opcional: sin ella queda solo la hora.
 */
export function hourPhrase(hour, { station = null } = {}) {
  const normalized = ((hour % 24) + 24) % 24;
  const spoken = NUMBERS[normalized % 12 === 0 ? 12 : normalized % 12];
  const phrase = `${capitalize(spoken)} ${periodOf(normalized)}`;
  return station ? `${phrase}, ${station}` : phrase;
}

/** Milisegundos que faltan para la próxima hora en punto. */
export function msUntilNextHour(now = new Date()) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime() - now.getTime();
}
