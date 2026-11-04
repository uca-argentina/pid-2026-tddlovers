import { formatDayLong, fromISODate } from './calendar.js'
import { nowParts } from './classStates.js'

// Las tareas. Las reglas son un ESPEJO de backend/src/lib/homework.js y sirven
// solo para decidir qué mostrar: el backend vuelve a chequear todo. Si se toca
// una regla allá, va acá.

export const MAX_TITLE_LENGTH = 120
export const MAX_TEXT_LENGTH = 5000
export const MAX_MESSAGE_LENGTH = 2000

// Las fechas de entrega son en hora argentina: la del backend.
const MOMENT_FORMAT = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function isPastDue({ dueDate, dueTime }, now = nowParts()) {
  return `${now.iso}T${now.time}` > `${dueDate}T${dueTime}`
}

/** Un enlace ajeno solo se vuelve <a href> si es web: un javascript: correría con tu sesión. */
export function isSafeLink(link) {
  try {
    return ['http:', 'https:'].includes(new URL(link).protocol)
  } catch {
    return false
  }
}

/** El estado de una entrega para la píldora: { label, tone } de .class-status. */
export function submissionStatus(homework, submission, now = nowParts()) {
  if (submission.correctedAt) return { label: 'Corregida', tone: 'success' }
  if (submission.submittedAt) return { label: 'Entregada', tone: 'info' }
  if (isPastDue(homework, now)) return { label: 'Vencida', tone: 'danger' }
  return { label: 'Pendiente', tone: 'warning' }
}

export function formatDue({ dueDate, dueTime }) {
  return `${formatDayLong(fromISODate(dueDate))} · ${dueTime} h`
}

/** Un instante del backend (submittedAt, createdAt...), para leer. */
export function formatMoment(timestamp) {
  return MOMENT_FORMAT.format(new Date(timestamp))
}

/** "Clase grupal de Matemática · ..." o el nombre del alumno. Null si es para el que mira. */
export function targetLabel(homework) {
  if (homework.classDate) {
    const materia = homework.subjectName ? ` de ${homework.subjectName}` : ''
    const dia = formatDayLong(fromISODate(homework.classDate))
    return `Clase grupal${materia} · ${dia} · ${homework.classStartTime} h`
  }
  return homework.submissions?.[0]?.studentName ?? null
}

/** Cuántas entregas hay y cuántas esperan corrección, para la tarjeta del docente. */
export function submissionCounts(homework) {
  const entregadas = homework.submissions.filter((row) => row.submittedAt)
  return {
    total: homework.submissions.length,
    entregadas: entregadas.length,
    porCorregir: entregadas.filter((row) => !row.correctedAt).length,
  }
}

/**
 * El alumno ve primero lo que todavía tiene que hacer, lo más urgente arriba;
 * lo ya entregado queda abajo, lo último primero. El docente las recibe del
 * backend con la más lejana arriba.
 */
export function sortStudentHomeworks(homeworks) {
  const due = (homework) => `${homework.dueDate}T${homework.dueTime}`
  const pendientes = homeworks.filter((homework) => !homework.submission.submittedAt)
  const entregadas = homeworks.filter((homework) => homework.submission.submittedAt)
  return [
    ...pendientes.sort((a, b) => due(a).localeCompare(due(b))),
    ...entregadas.sort((a, b) => due(b).localeCompare(due(a))),
  ]
}
