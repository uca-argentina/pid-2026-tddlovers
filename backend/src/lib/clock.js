// La hora de "ahora" en el formato de la app: 'YYYY-MM-DD' y 'HH:MM', en hora
// ARGENTINA — la de los usuarios, que es la de las fechas y horas que se
// guardan (sin zona, ver CLAUDE.md). Es la ÚNICA fuente de "hoy" y "ahora" del
// backend: las reglas puras (bookingStates, classMaterials, homework, vacations,
// classPacks...) reciben su resultado como parámetro en vez de leer el reloj.
//
// Con la zona escrita acá y no con la hora local del proceso: el contenedor
// corre en UTC, y desde las 21:00 de acá ya creía que era mañana (no dejaba
// cargar clases para hoy a la noche). toISOString() tampoco sirve: es UTC.

const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * El momento dado (por defecto, el actual) en hora argentina.
 *
 * @param {Date} [date] - el instante a convertir; por defecto el reloj del
 *   proceso. lib/neuronas.js le pasa timestamps de la base (created_at,
 *   submitted_at) para llevarlos al mismo formato.
 * @returns {{iso: string, time: string}} `iso` 'YYYY-MM-DD' y `time` 'HH:MM' (24 h).
 * Lo usan: routes/{availability,classes,homework,neuronas,teachers}/index.js,
 *   db/bookings.js y lib/neuronas.js.
 */
export function now(date = new Date()) {
  const parts = Object.fromEntries(FORMAT.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * La fecha de hoy en Argentina, 'YYYY-MM-DD' (atajo de now().iso).
 * Lo usan: routes/teachers/index.js, routes/packs/index.js y db/availability.js.
 */
export function todayIso() {
  return now().iso;
}
