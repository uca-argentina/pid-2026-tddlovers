import { normalizeText } from './booking.js'
import { hasEnded, nowParts } from './classStates.js'

// Cómo se ordena "Mis reservas": las cinco categorías, la próxima clase, la
// última y el turno de una grupal. Funciones puras para probarlas sin montar
// la pantalla.

// En las que vienen importa la más cercana; en las cerradas, la más nueva.
// La cantidad solo va en las que esperan algo: en las cerradas sería un
// número que solo crece.
export const CATEGORIES = [
  { key: 'pendiente', title: 'Pendientes', statuses: ['pendiente'], showCount: true },
  { key: 'aceptada', title: 'Aceptadas', statuses: ['aceptada'], showCount: true },
  { key: 'confirmada', title: 'Confirmadas', statuses: ['confirmada'], showCount: true },
  {
    key: 'finalizada',
    title: 'Finalizadas',
    statuses: ['realizada', 'no_presentada'],
    showCount: false,
    newestFirst: true,
  },
  {
    key: 'cancelada',
    title: 'Canceladas',
    statuses: ['cancelada'],
    showCount: false,
    newestFirst: true,
  },
]

const startKey = (cls) => `${cls.date} ${cls.startTime}`

const byName = (a, b) => (a.studentName || '').localeCompare(b.studentName || '')

/**
 * Las reservas agrupadas en clases: un turno (docente, fecha, inicio) es UNA
 * clase aunque en una grupal tenga una reserva por alumno. Cada turno es
 * { key, cls, rows, active }: `rows` todas sus reservas (las canceladas
 * también, para el detalle), `active` las que siguen en pie y `cls` la que lo
 * representa en la tarjeta (la primera en pie, o la primera si no queda
 * ninguna). Para el alumno cada turno es una sola reserva: nunca tiene dos en
 * el mismo turno.
 */
export function groupTurns(classes) {
  const porTurno = new Map()
  for (const cls of classes) {
    const key = turnKey(cls)
    if (!porTurno.has(key)) porTurno.set(key, [])
    porTurno.get(key).push(cls)
  }
  return [...porTurno.entries()].map(([key, rows]) => {
    const active = rows.filter((row) => row.status !== 'cancelada').sort(byName)
    const canceladas = rows.filter((row) => row.status === 'cancelada').sort(byName)
    return { key, cls: active[0] || canceladas[0], rows: [...active, ...canceladas], active }
  })
}

/**
 * Si el turno va en la categoría: si alguna reserva en pie está en ese
 * estado. Una grupal con un alumno pendiente y otro confirmado aparece en las
 * dos, porque en cada una hay algo que ver. En Canceladas, solo la que se
 * canceló para todos: un alumno que se bajó no cancela la clase.
 */
function turnInCategory(category, turn) {
  if (category.key === 'cancelada') return turn.active.length === 0
  return turn.active.some((row) => category.statuses.includes(row.status))
}

/** Los turnos de la categoría, en su orden. */
export function turnsIn(category, turns) {
  return turns
    .filter((turn) => turnInCategory(category, turn))
    .sort((a, b) => {
      const order = startKey(a.cls).localeCompare(startKey(b.cls))
      return category.newestFirst ? -order : order
    })
}

/** Todas las reservas del turno de `cls` (canceladas incluidas): en pie primero, por nombre. */
export function turnRows(cls, classes) {
  const key = turnKey(cls)
  const rows = classes.filter((other) => turnKey(other) === key)
  const active = rows.filter((row) => row.status !== 'cancelada').sort(byName)
  return [...active, ...rows.filter((row) => row.status === 'cancelada').sort(byName)]
}

/**
 * Una sola por turno: en una grupal el docente tiene una fila por alumno, y
 * "tu próxima clase" es una, no tres iguales. Se queda con la primera fila.
 */
function oneByTurn(classes) {
  const seen = new Set()
  return classes.filter((cls) => {
    const key = turnKey(cls)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function turnKey(cls) {
  return `${cls.teacherId}|${cls.date}|${cls.startTime}`
}

/**
 * La próxima clase: la primera no cancelada que todavía no terminó, así que
 * una en curso cuenta (es la que el usuario tiene ahora). Una pendiente
 * también: el horario ya está tomado aunque falte la respuesta.
 */
export function nextClass(classes, now = nowParts()) {
  const vienen = classes
    .filter((cls) => cls.status !== 'cancelada' && !hasEnded(cls, now))
    .sort((a, b) => startKey(a).localeCompare(startKey(b)))
  return oneByTurn(vienen)[0] || null
}

/** La última clase en la que se participó: la más reciente que ya terminó y no se canceló. */
export function lastClass(classes, now = nowParts()) {
  const pasaron = classes
    .filter((cls) => cls.status !== 'cancelada' && hasEnded(cls, now))
    .sort((a, b) => startKey(b).localeCompare(startKey(a)))
  return oneByTurn(pasaron)[0] || null
}

/** Las reservas no canceladas del mismo turno que `cls` (ella incluida), por nombre de alumno. */
export function turnSiblings(cls, classes) {
  const key = turnKey(cls)
  return classes.filter((other) => other.status !== 'cancelada' && turnKey(other) === key).sort(byName)
}

// Los filtros de la lista de una categoría. Vacío = sin filtrar.
export const EMPTY_FILTERS = { subjectId: '', from: '', to: '', name: '' }

export function hasFilters(filters) {
  return Object.values(filters).some((value) => value !== '')
}

/** Las materias que aparecen en esos turnos, por nombre: para el selector. */
export function subjectsOf(turns) {
  const porId = new Map()
  for (const { cls } of turns) porId.set(String(cls.subjectId), cls.subjectName)
  return [...porId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Los nombres por los que se busca: el alumno busca a su docente; el
 * docente, a cualquier alumno de la clase (en una grupal, a todos).
 */
function namesOf(turn, viewRole) {
  if (viewRole !== 'teacher') return [turn.cls.teacherName]
  return turn.rows.map((row) => row.studentName)
}

/**
 * Los turnos que pasan los filtros. Fechas 'YYYY-MM-DD', las dos puntas
 * incluidas (se comparan como texto: el formato ordena bien). El nombre se
 * busca sin tildes ni mayúsculas y alcanza con una parte ("rami" encuentra
 * a Sofía Ramírez).
 */
export function filterTurns(turns, filters, viewRole) {
  const nombre = normalizeText(filters.name)
  return turns.filter(({ cls, ...turn }) => {
    if (filters.subjectId && String(cls.subjectId) !== String(filters.subjectId)) return false
    if (filters.from && cls.date < filters.from) return false
    if (filters.to && cls.date > filters.to) return false
    if (nombre) {
      const nombres = namesOf({ cls, ...turn }, viewRole).map(normalizeText)
      if (!nombres.some((n) => n.includes(nombre))) return false
    }
    return true
  })
}
