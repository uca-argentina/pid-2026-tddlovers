// Los días de la semana (claves y nombres para mostrar) y cómo se escribe un
// rango horario en pantalla. No dependen de React, así que van como funciones
// sueltas (igual que calendar.js).
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
//   - El `end` de un rango es exclusivo, y uno que llega hasta la medianoche
//     termina en '24:00' y no en '00:00': si no, se rompe start < end para
//     cualquiera que ordene o valide (incluida la base). formatRangeLabel lo
//     muestra tal cual llega.
//
// Lo usan: utils/booking.js y utils/windows.js, pages/Booking/BookingFilters.jsx,
// y formatRangeLabel casi todas las tarjetas de clase y de ventana.

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

const LABEL_BY_KEY = DAY_KEYS.reduce((acc, key, index) => {
  acc[key] = DAY_LABELS[index]
  return acc
}, {})

/** 'miercoles' -> 'Miércoles'. Una clave desconocida sale tal cual. Lo usa: utils/windows.js. */
export function dayLabel(dayKey) {
  return LABEL_BY_KEY[dayKey] || dayKey
}

/**
 * '14:00 – 15:00'. Raya (–), no guion, y 24 h como el resto de la app.
 *
 * @param {string} start - 'HH:MM' (startTime/endTime de una clase, start/end de una ventana o tramo).
 * @param {string} end - 'HH:MM', exclusivo; puede ser '24:00'.
 * @returns {string}
 * Lo usan: utils/booking.js, components/ClassCard.jsx y ClassDetailDialog.jsx,
 * pages/Calendar/DayAgenda.jsx, pages/Booking/BookingCard.jsx y BookingDialog.jsx,
 * pages/Availability/WindowCard.jsx y WeekCalendar.jsx.
 */
export function formatRangeLabel(start, end) {
  return `${start} – ${end}`
}
