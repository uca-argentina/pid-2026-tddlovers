// Las neuronas, del lado del front. Las reglas y los costos que valen están en
// backend/src/lib/neuronas.js: esto es un espejo solo para mostrar y para decidir
// qué ofrecer, y el backend vuelve a chequear todo al reservar. Si cambia un
// costo, hay que cambiarlo en los dos lados.
//
// El saldo, el nivel y los movimientos llegan de GET /api/neuronas; si el
// docente acepta canjes, en `teacherAcceptsRewards` de cada fila de
// GET /api/availability (BookingDialog lo pasa acá como `acceptsRewards`).
// Lo usan: pages/Neuronas/NeuronasPage.jsx, pages/Booking/BookingDialog.jsx,
// pages/Homework/ (NewHomeworkDialog, TeacherSubmissionDialog), las tarjetas
// de clase (rewardLabel) y utils/packs.js (quoteBooking).

import { classPriceCents } from './rates.js'

export const REWARDS = {
  free_30: { kind: 'free', minutes: 30, cost: 500, label: '30 min gratis' },
  free_60: { kind: 'free', minutes: 60, cost: 1000, label: '1 h gratis' },
  discount_10: { kind: 'discount', percent: 10, cost: 250, label: '10% de descuento' },
  discount_20: { kind: 'discount', percent: 20, cost: 500, label: '20% de descuento' },
}

const REWARD_MINUTES_FOR_DISCOUNT = 60

export const MIN_FEEDBACK_LENGTH = 20

const MIN_HOMEWORK_LEAD_MINUTES = 24 * 60

/**
 * Si la tarea da neuronas: con menos de 24 h de plazo no da. `createdAt` es un
 * instante y el vencimiento va en hora argentina, que no cambia en el año. Se
 * redondea al minuto igual que en el backend, para que el aviso no le contradiga.
 *
 * @param {{createdAt: string, dueDate: string, dueTime: string}} homework - una tarea de
 *   GET /api/homework (en NewHomeworkDialog, una armada con "ahora" como createdAt).
 * @returns {boolean}
 * Lo usan: pages/Homework/NewHomeworkDialog.jsx, TeacherSubmissionDialog.jsx.
 * Espejo: homeworkEarns de backend/src/lib/neuronas.js.
 */
export function homeworkEarns({ createdAt, dueDate, dueTime }) {
  const due = Date.parse(`${dueDate}T${dueTime}:00-03:00`) / 60000
  const created = Math.floor(Date.parse(createdAt) / 60000)
  return due - created >= MIN_HOMEWORK_LEAD_MINUTES
}

const NUMBER_FORMAT = new Intl.NumberFormat('es-AR')

/** '1.000 neuronas' / '1 neurona'. Lo usan: NeuronasPage.jsx, BookingDialog.jsx. */
export function formatNeuronas(amount) {
  return `${NUMBER_FORMAT.format(amount)} ${Math.abs(amount) === 1 ? 'neurona' : 'neuronas'}`
}

/**
 * El texto de un canje ('30 min gratis'...), o '' si no hay.
 * `rewardType` es el de una reserva de GET /api/bookings (null si no canjeó).
 * Lo usan: components/ClassCard.jsx, ClassDetailDialog.jsx, BookingActions.jsx.
 */
export function rewardLabel(rewardType) {
  return REWARDS[rewardType]?.label ?? ''
}

/**
 * Si el canje entra en una clase de esa duración: no puede cubrir más de lo que dura.
 * Lo usa: pages/Booking/BookingDialog.jsx (y rewardApplies).
 */
export function rewardFits(rewardType, minutes) {
  const reward = REWARDS[rewardType]
  return reward.kind !== 'free' || minutes >= reward.minutes
}

/**
 * Si tiene sentido ofrecer canjes en esta clase: el docente los acepta y la
 * materia no es gratis (sobre $ 0 el backend responde 409).
 *
 * @param {{acceptsRewards: boolean, hourlyRateCents: number}} offer - `teacherAcceptsRewards`
 *   de la fila de GET /api/availability y la tarifa de la materia elegida.
 * @returns {boolean}
 * Lo usa: pages/Booking/BookingDialog.jsx.
 */
export function rewardsOffered({ acceptsRewards, hourlyRateCents }) {
  return Boolean(acceptsRewards) && hourlyRateCents > 0
}

/**
 * Si el canje vale para esta clase, con lo mismo que chequea el backend al
 * reservar (rewardProblem en lib/neuronas.js, más el docente y el saldo). Si
 * no se pasa `balance`, no se mira el saldo.
 *
 * @param {string} rewardType - una clave de REWARDS.
 * @param {object} context - acceptsRewards (teacherAcceptsRewards de la fila de
 *   disponibilidad) y hourlyRateCents,
 *   minutes (duración elegida) y balance (de GET /api/neuronas).
 * @returns {boolean}
 * Lo usa: utils/packs.js (quoteBooking).
 * Espejo: rewardProblem de backend/src/lib/neuronas.js.
 */
export function rewardApplies(
  rewardType,
  { acceptsRewards, hourlyRateCents, minutes, balance = Infinity },
) {
  if (!REWARDS[rewardType] || !minutes) return false
  if (!rewardsOffered({ acceptsRewards, hourlyRateCents })) return false
  return rewardFits(rewardType, minutes) && balance >= REWARDS[rewardType].cost
}

/**
 * Lo que queda por pagar con el canje. El descuento va sobre los primeros 60 minutos.
 *
 * @param {string} rewardType - una clave de REWARDS (ya validada con rewardApplies).
 * @param {{hourlyRateCents: number, minutes: number}} clase
 * @returns {number} centavos.
 * Lo usa: utils/packs.js (quoteBooking).
 * Espejo: rewardPriceCents de backend/src/lib/neuronas.js.
 */
export function rewardPriceCents(rewardType, { hourlyRateCents, minutes }) {
  const reward = REWARDS[rewardType]
  if (reward.kind === 'free') return classPriceCents(hourlyRateCents, minutes - reward.minutes)
  const base = classPriceCents(hourlyRateCents, Math.min(minutes, REWARD_MINUTES_FOR_DISCOUNT))
  return classPriceCents(hourlyRateCents, minutes) - Math.round((base * reward.percent) / 100)
}

const MOVEMENT_LABELS = {
  class_attended: 'Clase con presente',
  class_taught: 'Clase dada',
  homework_on_time: 'Tarea a tiempo',
  homework_feedback: 'Devolución de tarea',
  reward_bonus: 'Bono por clase canjeada',
  class_reward: 'Canje en una clase',
  featured: 'Destacado por 7 días',
}

/**
 * El texto de un movimiento del historial. `reason` viene de cada elemento de
 * `movements` de GET /api/neuronas (los motivos de neurona_credits, más
 * 'class_reward' y 'featured' que arma backend/src/db/neuronas.js).
 * Lo usa: pages/Neuronas/NeuronasPage.jsx.
 */
export function movementLabel(reason) {
  return MOVEMENT_LABELS[reason] ?? 'Neuronas'
}

/**
 * Qué parte del camino al próximo nivel lleva, de 0 a 100. El último nivel queda lleno.
 *
 * @param {{min: number, nextMin: number|null}} level - el `level` de GET /api/neuronas
 *   (levelFor de backend/src/lib/neuronas.js).
 * @param {number} earned - el `earned` de la misma respuesta.
 * @returns {number}
 * Lo usa: pages/Neuronas/NeuronasPage.jsx.
 */
export function levelProgress(level, earned) {
  if (level.nextMin === null) return 100
  return Math.round(((earned - level.min) / (level.nextMin - level.min)) * 100)
}
