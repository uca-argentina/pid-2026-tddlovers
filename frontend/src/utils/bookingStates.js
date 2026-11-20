import { formatDayLong, fromISODate, toISODate } from './calendar.js'

// Los estados de una reserva y qué se puede hacer en cada uno.
//
// Las reglas son un ESPEJO de backend/src/lib/bookingStates.js y sirven solo
// para decidir qué botones mostrar: el que decide de verdad es el backend, que
// vuelve a chequear todo (y dice por qué no, si algo cambió en el medio). Si
// se toca una regla allá, hay que tocarla acá.
//
// Todas reciben una clase (reserva) tal como la devuelve GET /api/bookings
// (status, date, startTime, endTime, paidAt, priceCents, packTokens,
// rewardType, cancelReason, cancelledBy) y, cuando importa, el rol de la
// sesión. Lo usan los componentes de clase (components/BookingActions.jsx,
// ClassActions.jsx, StudentsDialog.jsx, AttendanceDialog.jsx,
// ClassDetailDialog.jsx, ClassMaterial.jsx), pages/Reservations/ y los utils
// reservations.js, classMaterials.js y homework.js (nowParts/hasEnded).

const CANCEL_NOTICE_HOURS = 24

const STATUS_LABELS = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  confirmada: 'Confirmada',
  realizada: 'Realizada',
  no_presentada: 'No presentada',
  cancelada: 'Cancelada',
}

/** Qué color lleva la pastilla: espera algo, está bien, está cerrada. */
export const STATUS_TONES = {
  pendiente: 'warning',
  aceptada: 'info',
  confirmada: 'success',
  realizada: 'success',
  no_presentada: 'danger',
  cancelada: 'muted',
}

/**
 * El texto en pantalla de un `status` ('no_presentada' -> 'No presentada').
 * Lo usan: components/BookingActions.jsx, ClassActions.jsx, StudentsDialog.jsx.
 */
export function statusLabel(status) {
  return STATUS_LABELS[status] || status
}

/**
 * "Ahora" en el formato de la app. El navegador de los usuarios está en hora argentina.
 *
 * @param {Date} [date] - se inyecta en los tests.
 * @returns {{iso: string, time: string}} 'YYYY-MM-DD' y 'HH:MM' locales.
 * Es el `now` por defecto de casi todas las funciones de este archivo, de
 * classMaterials.js, homework.js y reservations.js.
 */
export function nowParts(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return { iso: toISODate(date), time: `${hh}:${mm}` }
}

function toEpochMinutes(iso, time) {
  const [y, m, d] = iso.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return Date.UTC(y, m - 1, d, hh, mm) / 60000
}

function minutesUntilStart(booking, now) {
  return toEpochMinutes(booking.date, booking.startTime) - toEpochMinutes(now.iso, now.time)
}

/**
 * Si la clase ya empezó (date + startTime <= ahora).
 * Lo usan: components/ClassDetailDialog.jsx, pages/Reservations/ReservationsPage.jsx.
 */
export function hasStarted(booking, now = nowParts()) {
  return minutesUntilStart(booking, now) <= 0
}

/**
 * Ya terminó: el fin llegó. Un fin "24:00" es la medianoche siguiente.
 * Lo usan: utils/classMaterials.js, utils/reservations.js, components/ClassMaterial.jsx.
 * Espejo: hasEnded de backend/src/lib/bookingStates.js.
 */
export function hasEnded(booking, now = nowParts()) {
  return toEpochMinutes(booking.date, booking.endTime) <= toEpochMinutes(now.iso, now.time)
}

function withNotice(booking, now) {
  return minutesUntilStart(booking, now) >= CANCEL_NOTICE_HOURS * 60
}

const RULES = {
  accept: (booking, role, now) => role === 'teacher' && booking.status === 'pendiente' && !hasStarted(booking, now),
  cancel: (booking, role, now) =>
    ['pendiente', 'aceptada', 'confirmada'].includes(booking.status) &&
    !hasStarted(booking, now) &&
    (role === 'teacher' || booking.status === 'pendiente' || withNotice(booking, now)),
  pay: (booking, role) =>
    role === 'student' &&
    !booking.paidAt &&
    ['aceptada', 'realizada', 'no_presentada'].includes(booking.status),
  attend: (booking, role, now) =>
    role === 'teacher' &&
    ['aceptada', 'confirmada', 'realizada', 'no_presentada'].includes(booking.status) &&
    hasStarted(booking, now),
  reschedule: (booking, role, now) =>
    role === 'student' && booking.status === 'confirmada' && withNotice(booking, now),
}

/**
 * FILTRO: qué botones se muestran. Lo que `role` puede hacer ahora con la
 * clase: accept, cancel, pay, attend, reschedule. Regla del backend
 * (checkAction en backend/src/lib/bookingStates.js, que la vuelve a chequear);
 * esto es solo su espejo para elegir botones.
 *
 * @param {object} booking - una reserva de GET /api/bookings.
 * @param {'teacher'|'student'} role - el rol de la sesión.
 * @param {object} [now] - nowParts().
 * @returns {string[]} las acciones permitidas; cada una corresponde a
 *   POST /api/bookings/:id/{accept,cancel,pay,attendance,reschedule}.
 * Lo usan: components/BookingActions.jsx, ClassActions.jsx, StudentsDialog.jsx,
 * AttendanceDialog.jsx, ClassDetailDialog.jsx.
 * Espejo: RULES/checkAction de backend/src/lib/bookingStates.js (la autoridad).
 */
export function allowedActions(booking, role, now = nowParts()) {
  return Object.keys(RULES).filter((action) => RULES[action](booking, role, now))
}

/**
 * Una clase que se debe: la aceptada todavía no se pagó (por eso no está
 * confirmada), y una ya dada puede haber quedado sin pagar (se paga después).
 * Lo usa: components/BookingActions.jsx.
 */
export function owesPayment(booking) {
  return !booking.paidAt && ['aceptada', 'realizada', 'no_presentada'].includes(booking.status)
}

/**
 * Si el alumno ya pagó, para el docente: "Pagó", "Sin pagar", o por qué no
 * hay nada que pagar (lo cubre el paquete, o la tarifa es 0). Devuelve
 * { label, tone } con los tonos de las pastillas.
 * Lo usan: components/ClassDetailDialog.jsx, StudentsDialog.jsx, AttendanceDialog.jsx.
 */
export function paymentStatus(booking) {
  // Antes que paidAt: aceptar una clase cubierta entera por el canje o por el
  // paquete ya la marca paga, y "Pagó" diría algo que el alumno no hizo.
  if (booking.rewardType && booking.priceCents === 0) return { label: 'Con neuronas', tone: 'info' }
  if (booking.packTokens > 0 && booking.priceCents === 0) return { label: 'Con paquete', tone: 'info' }
  if (booking.paidAt) return { label: 'Pagó', tone: 'success' }
  if (booking.priceCents === 0) return { label: 'Gratis', tone: 'info' }
  return { label: 'Sin pagar', tone: 'warning' }
}

/**
 * Por qué está cancelada, dicho desde quien mira: "Cancelada por vos" no es
 * lo mismo que "Cancelada por el docente".
 *
 * @param {object} booking - una reserva de GET /api/bookings (cancelReason, cancelledBy).
 * @param {'teacher'|'student'} role - el rol de quien mira.
 * @returns {string|null} null si no está cancelada o no hay nada que explicar.
 * Lo usan: components/BookingActions.jsx, ClassActions.jsx.
 */
export function cancelDescription(booking, role) {
  if (booking.status !== 'cancelada') return null
  if (booking.cancelReason === 'vencida') return 'El docente no respondió antes de la clase.'
  if (booking.cancelReason === 'reprogramada') return 'Reprogramada a otro horario.'
  if (booking.cancelReason === 'vacaciones') {
    return role === 'teacher'
      ? 'Se canceló por tu licencia.'
      : 'El docente está de licencia: se canceló la clase.'
  }
  const fuiYo = booking.cancelledBy === role
  if (booking.cancelReason === 'rechazada') {
    return fuiYo ? 'La rechazaste.' : 'El docente rechazó la reserva.'
  }
  if (!booking.cancelledBy) return null
  if (fuiYo) return 'La cancelaste vos.'
  return booking.cancelledBy === 'teacher' ? 'La canceló el docente.' : 'La canceló el alumno.'
}

/**
 * Hasta cuándo puede el alumno cancelar o reprogramar una clase ya aceptada,
 * dicho en criollo, o por qué ya no puede. null si no aplica (pendiente, que
 * se retira siempre, o algo ya cerrado).
 * Lo usa: components/BookingActions.jsx.
 */
export function cancelDeadlineHint(booking, now = nowParts()) {
  if (!['aceptada', 'confirmada'].includes(booking.status) || hasStarted(booking, now)) return null
  if (!withNotice(booking, now)) {
    return `Faltan menos de ${CANCEL_NOTICE_HOURS} h: ya no se puede cancelar ni reprogramar.`
  }
  // Las cuentas van en minutos "UTC" solo como reloj sin zona: toISOString
  // devuelve la misma fecha y hora local que entraron, 24 h antes.
  const limite = new Date((toEpochMinutes(booking.date, booking.startTime) - CANCEL_NOTICE_HOURS * 60) * 60000)
  const iso = limite.toISOString().slice(0, 10)
  const hora = limite.toISOString().slice(11, 16)
  return `Podés cancelar o reprogramar hasta el ${formatDayLong(fromISODate(iso)).toLowerCase()} a las ${hora}.`
}
