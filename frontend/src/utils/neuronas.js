// Las neuronas, del lado del front. Las reglas y los costos que valen están en
// backend/src/lib/neuronas.js: esto es un espejo solo para mostrar y para decidir
// qué ofrecer, y el backend vuelve a chequear todo al reservar. Si cambia un
// costo, hay que cambiarlo en los dos lados.

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
 */
export function homeworkEarns({ createdAt, dueDate, dueTime }) {
  const due = Date.parse(`${dueDate}T${dueTime}:00-03:00`) / 60000
  const created = Math.floor(Date.parse(createdAt) / 60000)
  return due - created >= MIN_HOMEWORK_LEAD_MINUTES
}

const NUMBER_FORMAT = new Intl.NumberFormat('es-AR')

export function formatNeuronas(amount) {
  return `${NUMBER_FORMAT.format(amount)} ${Math.abs(amount) === 1 ? 'neurona' : 'neuronas'}`
}

export function rewardLabel(rewardType) {
  return REWARDS[rewardType]?.label ?? ''
}

/** Si el canje entra en una clase de esa duración: no puede cubrir más de lo que dura. */
export function rewardFits(rewardType, minutes) {
  const reward = REWARDS[rewardType]
  return reward.kind !== 'free' || minutes >= reward.minutes
}

/** Lo que queda por pagar con el canje. El descuento va sobre los primeros 60 minutos. */
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

export function movementLabel(reason) {
  return MOVEMENT_LABELS[reason] ?? 'Neuronas'
}

/** Qué parte del camino al próximo nivel lleva, de 0 a 100. El último nivel queda lleno. */
export function levelProgress(level, earned) {
  if (level.nextMin === null) return 100
  return Math.round(((earned - level.min) / (level.nextMin - level.min)) * 100)
}
