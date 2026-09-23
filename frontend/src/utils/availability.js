// Los días de la semana y las horas 'HH:MM' de a media hora. No dependen de
// React, así que van como funciones sueltas (igual que calendar.js).
//
// Dos convenciones que valen para todo el archivo:
//
//   - Las claves de día van SIN acento y en ASCII ('miercoles', 'sabado').
//     No son texto de pantalla: son clave de JSON, `key` de React y valor en
//     la base. 'miércoles' puede llegar en NFC o en NFD —se ven idénticos
//     pero === dice que no— y este equipo ya tuvo problemas de texto entre
//     Mac y Windows (ver CLAUDE.md y el .gitattributes). Para mostrar están
//     DAY_LABELS acá y WEEKDAY_LABELS en calendar.js.
//
//   - `end` es exclusivo: un rango que llega hasta las 23:30 inclusive
//     termina en '24:00' y no en '00:00', porque si no se rompe start < end
//     para cualquiera que ordene o valide (incluida la base).

export const DAY_KEYS = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
]

export const DAY_LABELS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
]

// Medias horas que tiene un día: es el índice de '24:00'.
const SLOTS_PER_DAY = 48

const LABEL_BY_KEY = DAY_KEYS.reduce((acc, key, index) => {
  acc[key] = DAY_LABELS[index]
  return acc
}, {})

/** 'miercoles' -> 'Miércoles'. */
export function dayLabel(dayKey) {
  return LABEL_BY_KEY[dayKey] || dayKey
}

/**
 * En qué media hora del día cae una hora: '00:00' -> 0, '13:30' -> 27.
 * Acepta también '24:00' -> 48, que es el fin exclusivo de un rango que
 * llega hasta las 23:30. Devuelve -1 si no es una hora en punto o y media.
 */
export function timeToSlotIndex(time) {
  if (typeof time !== 'string') return -1
  if (time === '24:00') return SLOTS_PER_DAY

  const match = /^([01]\d|2[0-3]):(00|30)$/.exec(time)
  if (!match) return -1

  return Number(match[1]) * 2 + (match[2] === '30' ? 1 : 0)
}

/** '14:00 – 15:00'. Raya (–), no guion, y 24 h como el resto de la app. */
export function formatRangeLabel(start, end) {
  return `${start} – ${end}`
}
