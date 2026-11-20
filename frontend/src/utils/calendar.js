// Funciones puras de fechas para el calendario mensual. Sin librería de
// fechas: `Date` nativo + `Intl` alcanzan y no cuestan un paquete más. No
// dependen de React, así que van como funciones sueltas (igual que
// validation.js).
//
// Dos convenciones que valen para todo el archivo:
//   - `month` es 0-indexed (0 = enero), igual que `Date`.
//   - La semana arranca en LUNES (Argentina), no en domingo.
//
// Las fechas de la API ('YYYY-MM-DD', hora local) entran con fromISODate y
// salen con toISODate. Lo usan casi todas las pantallas con fechas: el
// calendario (pages/Calendar/), Disponibilidad, el tablero de reservas,
// Mis reservas, Tareas, components/WeekStrip.jsx y los utils booking.js,
// windows.js, classStates.js y homework.js.

const WEEKS_IN_GRID = 6
const DAYS_IN_WEEK = 7

// Fijos a mano en vez de sacarlos de Intl: son 7 strings, quedan iguales en
// cualquier versión de Node/ICU y hacen los tests deterministas.
export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const MONTH_TITLE_FORMAT = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' })
const DAY_LONG_FORMAT = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})
const DAY_FULL_FORMAT = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Índice de día con la semana arrancando en lunes: 0 = lunes, 6 = domingo.
 * Lo usan: utils/booking.js y utils/windows.js (pasar de fecha a clave 'lunes'…'domingo').
 */
export function mondayIndex(date) {
  return (date.getDay() + 6) % 7
}

/** El día 1 de ese mes (`month` 0-indexed). Lo usa: pages/Calendar/MonthPane.jsx. */
export function startOfMonth(year, month) {
  return new Date(year, month, 1)
}

/**
 * Un Date nuevo `amount` días después (o antes, si es negativo), a medianoche
 * local: no arrastra la hora ni sufre el cambio de horario.
 */
export function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

/**
 * Corre `amount` meses y devuelve SIEMPRE el día 1. Devolver el día 1 es a
 * propósito: evita el clásico desborde de "31 de enero + 1 mes = 3 de marzo"
 * (febrero no tiene 31, así que Date se pasa al mes siguiente).
 */
export function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

/** Si dos Date caen el mismo día (ignora la hora). Lo usa buildMonthGrid para `isToday`. */
export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * 'YYYY-MM-DD' en hora LOCAL. Ojo: no usar toISOString(), que pasa a UTC y
 * puede devolver el día anterior o el siguiente según el huso del navegador
 * (y el runner de CI corre en UTC).
 */
export function toISODate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 'YYYY-MM-DD' (como viajan las fechas de la API: `date` de una clase,
 * `dueDate` de una tarea...) -> Date a medianoche LOCAL. `new Date(iso)` lo
 * leería como UTC y en Argentina caería el día anterior.
 */
export function fromISODate(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** 'Septiembre de 2026' — Intl lo devuelve en minúscula, lo capitalizamos. */
export function formatMonthTitle(date) {
  return capitalize(MONTH_TITLE_FORMAT.format(date))
}

const MONTH_NAME_FORMAT = new Intl.DateTimeFormat('es-AR', { month: 'long' })

/** 'Septiembre' — el mes solo, para la tira de semana (el año va aparte). */
export function formatMonthName(date) {
  return capitalize(MONTH_NAME_FORMAT.format(date))
}

/** 'Lunes 14 de septiembre' — para el encabezado del día seleccionado. */
export function formatDayLong(date) {
  return capitalize(DAY_LONG_FORMAT.format(date))
}

/** 'Lunes 14 de septiembre de 2026' — con año, para confirmar una reserva. */
export function formatDayLongWithYear(date) {
  return capitalize(DAY_FULL_FORMAT.format(date))
}

/**
 * Minutos entre dos horas 'HH:MM'. Nada cruza la medianoche: el fin más
 * tarde posible se escribe '24:00' (1440), así que alcanza con restar.
 */
function minutesBetween(startTime, endTime) {
  const [startHours, startMinutes] = startTime.split(':').map(Number)
  const [endHours, endMinutes] = endTime.split(':').map(Number)
  return endHours * 60 + endMinutes - (startHours * 60 + startMinutes)
}

/**
 * '09:00' + '10:30' -> '1 h 30 min'. Cada docente elige cuánto duran sus clases.
 *
 * @param {string} startTime - 'HH:MM' (startTime de una clase de GET /api/classes).
 * @param {string} endTime - 'HH:MM' (su endTime).
 * @returns {string}
 * Lo usan: components/ClassDetailDialog.jsx, pages/Calendar/DayAgenda.jsx.
 */
export function formatDuration(startTime, endTime) {
  const total = minutesBetween(startTime, endTime)
  const hours = Math.floor(total / 60)
  const minutes = total % 60

  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

/**
 * Grilla del mes: 6 filas x 7 columnas arrancando en lunes, incluyendo los
 * días de relleno del mes anterior y del siguiente. Siempre 6 filas (42
 * celdas) aunque sobren, para que la altura de la tarjeta no salte al pasar
 * de mes. `referenceDate` se puede inyectar para que los tests no dependan
 * de qué día es hoy.
 *
 * Devuelve Cell[6][7], con
 * Cell = { date, iso, day, inMonth, isToday, isWeekend }.
 *
 * @param {number} year
 * @param {number} month - 0-indexed.
 * @param {Date} [referenceDate] - "hoy", para marcar isToday.
 * Lo usa: pages/Calendar/MonthPane.jsx.
 */
export function buildMonthGrid(year, month, referenceDate = new Date()) {
  const first = startOfMonth(year, month)
  const gridStart = addDays(first, -mondayIndex(first))
  const weeks = []

  for (let week = 0; week < WEEKS_IN_GRID; week++) {
    const days = []
    for (let day = 0; day < DAYS_IN_WEEK; day++) {
      const date = addDays(gridStart, week * DAYS_IN_WEEK + day)
      days.push({
        date,
        iso: toISODate(date),
        day: date.getDate(),
        inMonth: date.getMonth() === month && date.getFullYear() === year,
        isToday: isSameDay(date, referenceDate),
        isWeekend: mondayIndex(date) >= 5,
      })
    }
    weeks.push(days)
  }

  return weeks
}

/**
 * { 'YYYY-MM-DD': [item, ...] } a partir de cualquier lista con `date` y
 * `startTime`, cada día ordenado por hora. Los inicios son siempre :00 o :30
 * en 'HH:MM', así que comparar los textos alcanza para ordenar.
 *
 * @param {Array<{date: string, startTime: string}>} items - p. ej. las clases (o turnos)
 *   de GET /api/classes.
 * @returns {Object<string, Array>} por fecha ISO.
 * Lo usa: pages/Calendar/CalendarPage.jsx.
 */
export function groupByDate(items) {
  const map = {}
  for (const item of items) {
    if (!map[item.date]) map[item.date] = []
    map[item.date].push(item)
  }
  for (const iso of Object.keys(map)) {
    map[iso].sort((a, b) => a.startTime.localeCompare(b.startTime))
  }
  return map
}
