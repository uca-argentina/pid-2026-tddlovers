// Funciones puras de fechas para el calendario mensual. Sin librería de
// fechas: `Date` nativo + `Intl` alcanzan y no cuestan un paquete más. No
// dependen de React, así que van como funciones sueltas (igual que
// validation.js).
//
// Dos convenciones que valen para todo el archivo:
//   - `month` es 0-indexed (0 = enero), igual que `Date`.
//   - La semana arranca en LUNES (Argentina), no en domingo.

export const WEEKS_IN_GRID = 6
export const DAYS_IN_WEEK = 7

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

/** Índice de día con la semana arrancando en lunes: 0 = lunes, 6 = domingo. */
export function mondayIndex(date) {
  return (date.getDay() + 6) % 7
}

export function startOfMonth(year, month) {
  return new Date(year, month, 1)
}

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

export function fromISODate(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** 'Septiembre de 2026' — Intl lo devuelve en minúscula, lo capitalizamos. */
export function formatMonthTitle(date) {
  return capitalize(MONTH_TITLE_FORMAT.format(date))
}

/** 'Lunes 14 de septiembre' — para el encabezado del día seleccionado. */
export function formatDayLong(date) {
  return capitalize(DAY_LONG_FORMAT.format(date))
}

/** 'Lunes 14 de septiembre de 2026' — con año, para confirmar una reserva. */
export function formatDayLongWithYear(date) {
  return capitalize(DAY_FULL_FORMAT.format(date))
}

/** Las clases duran 1 hora fija (ver CLAUDE.md). '16:30' -> '17:30'. */
export function addOneHour(time) {
  const [hours, minutes] = time.split(':').map(Number)
  const next = (hours + 1) % 24
  return `${String(next).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * Minutos entre dos horas 'HH:MM'. Si la segunda es menor que la primera se
 * asume que cruzó la medianoche (una clase que arranca 23:30 termina 00:30).
 */
export function minutesBetween(startTime, endTime) {
  const [startHours, startMinutes] = startTime.split(':').map(Number)
  const [endHours, endMinutes] = endTime.split(':').map(Number)
  const start = startHours * 60 + startMinutes
  const end = endHours * 60 + endMinutes
  return end >= start ? end - start : end + 24 * 60 - start
}

/** '09:00' + '10:00' -> '1 h'. Hoy siempre da 1 h, pero no lo damos por hecho. */
export function formatDuration(startTime, endTime) {
  const total = minutesBetween(startTime, endTime)
  const hours = Math.floor(total / 60)
  const minutes = total % 60

  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

/** Una clase solo puede empezar en punto o y media. */
export function isValidSlotStart(time) {
  return /^([01]\d|2[0-3]):(00|30)$/.test(time)
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
