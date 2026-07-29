import { hourPhrase, msUntilNextHour } from '../src/announce/phrase.js';

/**
 * Las veinticuatro horas, dichas. Lo que hay que mirar es la franja —
 * madrugada / mañana / tarde / noche — y que la una vaya en femenino.
 */
for (let hour = 0; hour < 24; hour += 1) {
  const clock = `${String(hour).padStart(2, '0')}:00`;
  console.log(`${clock}  ${hourPhrase(hour, { station: 'radio reloj' })}`);
}

console.log('\nsin emisora:', hourPhrase(15));
console.log('hora 24 (=0):', hourPhrase(24, { station: 'radio reloj' }));
console.log('hora -1 (=23):', hourPhrase(-1, { station: 'radio reloj' }));

// El próximo aviso siempre cae en el minuto cero, nunca a más de una hora.
let bad = 0;
for (const [h, m, s] of [[8, 0, 0], [8, 0, 1], [8, 59, 59], [23, 30, 0], [0, 0, 30]]) {
  const now = new Date(2026, 6, 29, h, m, s);
  const ms = msUntilNextHour(now);
  const then = new Date(now.getTime() + ms);
  const ok = then.getMinutes() === 0 && then.getSeconds() === 0 && ms > 0 && ms <= 3600_000;
  if (!ok) bad += 1;
  console.log(
    `desde ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` +
      ` -> ${Math.round(ms / 1000)}s -> ${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}:${String(then.getSeconds()).padStart(2, '0')} ${ok ? 'ok' : '✗'}`,
  );
}

console.log(bad ? `\n${bad} fallo(s)` : '\ntodo correcto');
process.exit(bad ? 1 : 0);
