import { formatDayLong, fromISODate } from './calendar.js'
import { nowParts } from './bookingStates.js'

// Las tareas. Las reglas son un ESPEJO de backend/src/lib/homework.js y sirven
// solo para decidir qué mostrar: el backend vuelve a chequear todo. Si se toca
// una regla allá, va acá.
//
// Las tareas llegan de GET /api/homework: el docente las recibe con
// `submissions` (una por alumno) y el alumno con `submission` (la suya).
// Lo usan las pantallas de pages/Homework/ (HomeworkPage, StudentHomeworkDialog,
// TeacherHomeworkDialog, TeacherSubmissionDialog, NewHomeworkDialog,
// SubmissionContent y HomeworkChat).

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

/**
 * Si ya pasó la fecha y hora de entrega (hora argentina).
 *
 * @param {{dueDate: string, dueTime: string}} homework - una tarea de GET /api/homework.
 * @param {object} [now] - nowParts() de utils/bookingStates.js ({ iso, time }).
 * @returns {boolean}
 * Lo usa: pages/Homework/StudentHomeworkDialog.jsx.
 * Espejo: isPastDue de backend/src/lib/homework.js.
 */
export function isPastDue({ dueDate, dueTime }, now = nowParts()) {
  return `${now.iso}T${now.time}` > `${dueDate}T${dueTime}`
}

/**
 * Un enlace ajeno solo se vuelve <a href> si es web: un javascript: correría con tu sesión.
 *
 * @param {string} link - el `linkUrl` de una entrega.
 * @returns {boolean} true solo para http/https.
 * Lo usa: pages/Homework/SubmissionContent.jsx.
 */
export function isSafeLink(link) {
  try {
    return ['http:', 'https:'].includes(new URL(link).protocol)
  } catch {
    return false
  }
}

/**
 * El estado de una entrega para la píldora: { label, tone } de .class-status.
 * Corregida > Entregada > Vencida > Pendiente.
 *
 * @param {object} homework - la tarea (su dueDate/dueTime).
 * @param {object} submission - una entrega (`submission` o un elemento de `submissions`),
 *   con submittedAt/correctedAt.
 * @param {object} [now] - nowParts().
 * @returns {{label: string, tone: string}}
 * Lo usan: pages/Homework/HomeworkPage.jsx, StudentHomeworkDialog.jsx, TeacherHomeworkDialog.jsx.
 */
export function submissionStatus(homework, submission, now = nowParts()) {
  if (submission.correctedAt) return { label: 'Corregida', tone: 'success' }
  if (submission.submittedAt) return { label: 'Entregada', tone: 'info' }
  if (isPastDue(homework, now)) return { label: 'Vencida', tone: 'danger' }
  return { label: 'Pendiente', tone: 'warning' }
}

/**
 * La entrega para leer: "<día largo> · 18:00 h".
 * Lo usan: pages/Homework/HomeworkPage.jsx, StudentHomeworkDialog.jsx, TeacherHomeworkDialog.jsx.
 */
export function formatDue({ dueDate, dueTime }) {
  return `${formatDayLong(fromISODate(dueDate))} · ${dueTime} h`
}

/**
 * Un instante del backend (submittedAt, createdAt...), para leer, en hora argentina.
 * Lo usan: pages/Homework/HomeworkChat.jsx, SubmissionContent.jsx.
 */
export function formatMoment(timestamp) {
  return MOMENT_FORMAT.format(new Date(timestamp))
}

/**
 * "Clase grupal de Matemática · ..." o el nombre del alumno. Null si es para el que mira.
 *
 * @param {object} homework - una tarea de GET /api/homework (classDate, subjectName,
 *   classStartTime si es de una grupal; si no, el studentName de su primera entrega).
 * @returns {string|null}
 * Lo usan: pages/Homework/HomeworkPage.jsx, TeacherHomeworkDialog.jsx.
 */
export function targetLabel(homework) {
  if (homework.classDate) {
    const materia = homework.subjectName ? ` de ${homework.subjectName}` : ''
    const dia = formatDayLong(fromISODate(homework.classDate))
    return `Clase grupal${materia} · ${dia} · ${homework.classStartTime} h`
  }
  return homework.submissions?.[0]?.studentName ?? null
}

/**
 * Cuántas entregas hay y cuántas esperan corrección, para la tarjeta del docente.
 *
 * @param {object} homework - una tarea del docente (con `submissions`).
 * @returns {{total: number, entregadas: number, porCorregir: number}}
 * Lo usa: pages/Homework/HomeworkPage.jsx.
 */
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
 *
 * @param {object[]} homeworks - las tareas del alumno (cada una con `submission`).
 * @returns {object[]} un array nuevo ordenado (no toca el de entrada).
 * Lo usa: pages/Homework/HomeworkPage.jsx.
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
