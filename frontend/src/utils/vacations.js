// Las vacaciones del docente, del lado del front. Las reglas de verdad viven
// en backend/src/lib/vacations.js; acá solo se decide qué mostrar.

const MONTH = new Intl.DateTimeFormat('es-AR', { month: 'long' })

function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** ¿Ese día cae en alguno de los rangos? Los dos extremos cuentan. */
export function isOnVacation(vacations, iso) {
  return (vacations || []).some((range) => iso >= range.startDate && iso <= range.endDate)
}

/**
 * '19 al 21 de octubre de 2026', '28 de octubre al 3 de noviembre de 2026' o,
 * si es un solo día, '19 de octubre de 2026'. Armado a mano: así se lee como
 * se dice, sin depender de cómo cada navegador formatea un rango.
 */
export function formatVacationRange({ startDate, endDate }) {
  const desde = toDate(startDate)
  const hasta = toDate(endDate)
  const dia = (date) => date.getDate()
  const mes = (date) => MONTH.format(date)
  const fin = `${dia(hasta)} de ${mes(hasta)} de ${hasta.getFullYear()}`
  if (startDate === endDate) return fin
  if (desde.getFullYear() !== hasta.getFullYear()) {
    return `${dia(desde)} de ${mes(desde)} de ${desde.getFullYear()} al ${fin}`
  }
  if (desde.getMonth() !== hasta.getMonth()) return `${dia(desde)} de ${mes(desde)} al ${fin}`
  return `${dia(desde)} al ${fin}`
}

/** Cuántos días dura, los dos extremos incluidos. */
export function vacationDays({ startDate, endDate }) {
  return Math.round((toDate(endDate) - toDate(startDate)) / 86400000) + 1
}

/** El mismo chequeo que el backend, para avisar antes de mandar. null si está bien. */
export function vacationRangeError({ startDate, endDate }, today) {
  if (!startDate) return 'Elegí desde qué día.'
  if (!endDate) return 'Elegí hasta qué día.'
  if (endDate < startDate) return 'El último día no puede ser antes del primero.'
  if (endDate < today) return 'Esas vacaciones ya terminaron.'
  if (vacationDays({ startDate, endDate }) > 365) return 'Las vacaciones pueden durar hasta 365 días.'
  return null
}
