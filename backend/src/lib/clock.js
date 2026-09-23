// La hora de "ahora" en el formato de la app: 'YYYY-MM-DD' y 'HH:MM', en hora
// ARGENTINA — la de los usuarios, que es la de las fechas y horas que se
// guardan (sin zona, ver CLAUDE.md).
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

export function now(date = new Date()) {
  const parts = Object.fromEntries(FORMAT.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function todayIso() {
  return now().iso;
}
