import { formatDayLong, fromISODate, toISODate } from './calendar.js'

// Los estados de una reserva y qué se puede hacer en cada uno.
//
// Las reglas son un ESPEJO de backend/src/lib/classStates.js y sirven solo
// para decidir qué botones mostrar: el que decide de verdad es el backend, que
// vuelve a chequear todo (y dice por qué no, si algo cambió en el medio). Si
// se toca una regla allá, hay que tocarla acá.

export const CANCEL_NOTICE_HOURS = 24

export const STATUS_LABELS = {
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

export function statusLabel(status) {
  return STATUS_LABELS[status] || status
}

/** "Ahora" en el formato de la app. El navegador de los usuarios está en hora argentina. */
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

export function minutesUntilStart(cls, now) {
  return toEpochMinutes(cls.date, cls.startTime) - toEpochMinutes(now.iso, now.time)
}

export function hasStarted(cls, now) {
  return minutesUntilStart(cls, now) <= 0
}

function withNotice(cls, now) {
  return minutesUntilStart(cls, now) >= CANCEL_NOTICE_HOURS * 60
}

const RULES = {
  accept: (cls, role, now) => role === 'teacher' && cls.status === 'pendiente' && !hasStarted(cls, now),
  cancel: (cls, role, now) =>
    ['pendiente', 'aceptada', 'confirmada'].includes(cls.status) &&
    !hasStarted(cls, now) &&
    (role === 'teacher' || cls.status === 'pendiente' || withNotice(cls, now)),
  pay: (cls, role) =>
    role === 'student' &&
    !cls.paidAt &&
    ['aceptada', 'realizada', 'no_presentada'].includes(cls.status),
  attend: (cls, role, now) =>
    role === 'teacher' &&
    ['aceptada', 'confirmada', 'realizada', 'no_presentada'].includes(cls.status) &&
    hasStarted(cls, now),
  reschedule: (cls, role, now) =>
    role === 'student' && cls.status === 'confirmada' && withNotice(cls, now),
}

/** Lo que `role` puede hacer ahora con la clase: accept, cancel, pay, attend, reschedule. */
export function allowedActions(cls, role, now = nowParts()) {
  return Object.keys(RULES).filter((action) => RULES[action](cls, role, now))
}

/**
 * Una clase que se debe: la aceptada todavía no se pagó (por eso no está
 * confirmada), y una ya dada puede haber quedado sin pagar (se paga después).
 */
export function owesPayment(cls) {
  return !cls.paidAt && ['aceptada', 'realizada', 'no_presentada'].includes(cls.status)
}

/**
 * Por qué está cancelada, dicho desde quien mira: "Cancelada por vos" no es
 * lo mismo que "Cancelada por el docente".
 */
export function cancelDescription(cls, role) {
  if (cls.status !== 'cancelada') return null
  if (cls.cancelReason === 'vencida') return 'El docente no respondió antes de la clase.'
  if (cls.cancelReason === 'reprogramada') return 'Reprogramada a otro horario.'
  const fuiYo = cls.cancelledBy === role
  if (cls.cancelReason === 'rechazada') {
    return fuiYo ? 'La rechazaste.' : 'El docente rechazó la reserva.'
  }
  if (!cls.cancelledBy) return null
  if (fuiYo) return 'La cancelaste vos.'
  return cls.cancelledBy === 'teacher' ? 'La canceló el docente.' : 'La canceló el alumno.'
}

/**
 * Hasta cuándo puede el alumno cancelar o reprogramar una clase ya aceptada,
 * dicho en criollo, o por qué ya no puede. null si no aplica (pendiente, que
 * se retira siempre, o algo ya cerrado).
 */
export function cancelDeadlineHint(cls, now = nowParts()) {
  if (!['aceptada', 'confirmada'].includes(cls.status) || hasStarted(cls, now)) return null
  if (!withNotice(cls, now)) {
    return `Faltan menos de ${CANCEL_NOTICE_HOURS} h: ya no se puede cancelar ni reprogramar.`
  }
  // Las cuentas van en minutos "UTC" solo como reloj sin zona: toISOString
  // devuelve la misma fecha y hora local que entraron, 24 h antes.
  const limite = new Date((toEpochMinutes(cls.date, cls.startTime) - CANCEL_NOTICE_HOURS * 60) * 60000)
  const iso = limite.toISOString().slice(0, 10)
  const hora = limite.toISOString().slice(11, 16)
  return `Podés cancelar o reprogramar hasta el ${formatDayLong(fromISODate(iso)).toLowerCase()} a las ${hora}.`
}
