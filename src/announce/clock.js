import { hourPhrase, msUntilNextHour } from './phrase.js';

/**
 * La hora en punto, encima de la música.
 *
 * Se reprograma en cada aviso a partir del reloj real en vez de encadenar
 * intervalos de una hora: un `setInterval` se desfasa, y a lo largo de una
 * tarde el aviso acabaría cayendo en cualquier minuto menos en el correcto.
 * Además así sobrevive a que el portátil se duerma, que es cuando más se nota.
 */
export function createHourlyClock({ announce, station, enabled = true }) {
  let timer = null;
  let on = enabled;

  function schedule() {
    if (timer) clearTimeout(timer);
    if (!on) return;

    timer = setTimeout(async () => {
      timer = null;
      // La hora se lee al sonar, no al programar: si la máquina durmió, lo
      // correcto es la hora a la que despierta.
      const hour = new Date().getHours();
      try {
        await announce(hourPhrase(hour, { station }));
      } catch {
        /* un aviso fallido no puede parar la radio */
      }
      schedule();
    }, msUntilNextHour());
  }

  /** Enciende o apaga los avisos en caliente. Devuelve el estado nuevo. */
  function toggle() {
    on = !on;
    if (on) schedule();
    else if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    return on;
  }

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  /** La frase que se diría ahora mismo — para probarla sin esperar una hora. */
  const preview = () => hourPhrase(new Date().getHours(), { station });

  schedule();
  return { toggle, stop, preview, isOn: () => on, nextIn: () => msUntilNextHour() };
}
