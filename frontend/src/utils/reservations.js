import { normalizeText } from './booking.js'
import { hasEnded, nowParts } from './classStates.js'
import { formatMoney } from './rates.js'
import { capacityLabel } from './windows.js'

// Cómo se ordena "Mis reservas": las cinco categorías, la próxima clase, la
// última y el turno de una grupal. Funciones puras para probarlas sin montar
// la pantalla.
//
// Las clases que se ven ya las decidió el backend (GET /api/classes devuelve
// solo las del usuario de la sesión); acá solo se ordenan, agrupan y cuentan.
//
// Todas trabajan sobre las reservas tal como las devuelve GET /api/classes
// (fetchClasses): una fila por alumno, así que en una grupal el docente
// recibe varias filas del mismo turno (teacherId + date + startTime).
// Lo usan: pages/Reservations/ (ReservationsPage, CategoryDialog),
// pages/Calendar/ (CalendarPage, DayAgenda), components/ClassCard.jsx y
// components/ClassDetailDialog.jsx.

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
 * FILTRO: las reservas que siguen en pie (todo lo que no está `cancelada`).
 * Regla de pantalla, el mismo criterio que el backend para "ocupa el
 * horario" (las exclusiones son WHERE status <> 'cancelada'). Es el único
 * lugar del front que lo escribe.
 *
 * @param {object[]} rows - reservas de GET /api/classes.
 * @returns {object[]}
 * Lo usan: este archivo, api/client.js (fetchMyLessons), components/
 * (ClassCard vía turnCapacityLabel, ClassDetailDialog, TurnActions,
 * StudentsDialog) y pages/Calendar/DayAgenda.jsx (vía turnCapacityLabel).
 */
export function activeRows(rows) {
  return rows.filter((row) => row.status !== 'cancelada')
}

/**
 * Las reservas de un mismo turno en el orden en que se muestran: las que
 * siguen en pie primero y las canceladas al final, cada grupo por nombre de
 * alumno. Así la primera es siempre la que representa a la clase.
 * Lo usan: groupTurns y turnRows (acá mismo).
 */
export function orderTurnRows(rows) {
  const active = activeRows(rows).sort(byName)
  const canceladas = rows.filter((row) => row.status === 'cancelada').sort(byName)
  return [...active, ...canceladas]
}

/**
 * Las reservas agrupadas en clases: un turno (docente, fecha, inicio) es UNA
 * clase aunque en una grupal tenga una reserva por alumno. Cada turno es
 * { key, cls, rows, active }: `rows` todas sus reservas (las canceladas
 * también, para el detalle), `active` las que siguen en pie y `cls` la que lo
 * representa en la tarjeta (la primera en pie, o la primera si no queda
 * ninguna). Para el alumno cada turno es una sola reserva: nunca tiene dos en
 * pie en el mismo turno.
 *
 * @param {object[]} classes - las reservas de GET /api/classes.
 * @returns {Array<{key: string, cls: object, rows: object[], active: object[]}>}
 * Lo usan: pages/Reservations/ReservationsPage.jsx, pages/Calendar/CalendarPage.jsx.
 */
export function groupTurns(classes) {
  const porTurno = new Map()
  for (const cls of classes) {
    const key = turnKey(cls)
    if (!porTurno.has(key)) porTurno.set(key, [])
    porTurno.get(key).push(cls)
  }
  return [...porTurno.entries()].map(([key, sinOrden]) => {
    const rows = orderTurnRows(sinOrden)
    return { key, cls: rows[0], rows, active: activeRows(rows) }
  })
}

/**
 * FILTRO: los turnos del calendario. Una clase cancelada para todos no ocupa
 * lugar en el calendario (se ve en "Mis reservas"); regla de pantalla. Cada
 * turno va una vez, como la reserva que lo representa, con `turnKey` y todas
 * sus reservas en `rows` (las canceladas también, al final, como en el
 * detalle de Mis reservas).
 *
 * @param {object[]} classes - las reservas de GET /api/classes.
 * @returns {object[]} reservas planas (las que representan a cada turno) con turnKey y rows.
 * Lo usa: pages/Calendar/CalendarPage.jsx.
 */
export function calendarTurns(classes) {
  return groupTurns(classes)
    .filter((turn) => turn.active.length > 0)
    .map((turn) => ({ ...turn.cls, turnKey: turn.key, rows: turn.rows }))
}

/**
 * Cuántas CLASES (turnos) tienen alguna reserva pendiente: una grupal con
 * tres solicitudes es una clase que espera respuesta, igual que la cuenta
 * Mis reservas (turnsIn de la categoría Pendientes).
 *
 * @param {object[]} classes - reservas de GET /api/classes.
 * @returns {number}
 * Lo usa: pages/Calendar/CalendarPage.jsx (el aviso del docente).
 */
export function pendingTurnCount(classes) {
  const pendientes = CATEGORIES.find((category) => category.key === 'pendiente')
  return turnsIn(pendientes, groupTurns(classes)).length
}

/**
 * "Individual", "Grupal · hasta 4" o "Grupal · 2 de 4". El docente cuenta las
 * reservas en pie del turno (`rows`); el alumno no las tiene y ve `enrolled`.
 * Nadie ve nombres en la tarjeta.
 *
 * @param {object} cls - la reserva que representa al turno.
 * @param {object[]|null} rows - todas las reservas del turno (o null: solo `cls`).
 * @param {string} viewRole - 'teacher' | 'student'.
 * @returns {string}
 * Lo usan: components/ClassCard.jsx y pages/Calendar/DayAgenda.jsx.
 */
export function turnCapacityLabel(cls, rows, viewRole) {
  if (cls.maxStudents <= 1) return capacityLabel(cls.maxStudents)
  const filas = rows && rows.length > 0 ? rows : [cls]
  const anotados = viewRole === 'teacher' ? activeRows(filas).length : cls.enrolled
  return anotados ? `Grupal · ${anotados} de ${cls.maxStudents}` : capacityLabel(cls.maxStudents)
}

/**
 * FILTRO: si el turno va en la categoría de Mis reservas (regla de pantalla): si alguna reserva en pie está en ese
 * estado. Una grupal con un alumno pendiente y otro confirmado aparece en las
 * dos, porque en cada una hay algo que ver. En Canceladas, solo la que se
 * canceló para todos: un alumno que se bajó no cancela la clase.
 */
function turnInCategory(category, turn) {
  if (category.key === 'cancelada') return turn.active.length === 0
  return turn.active.some((row) => category.statuses.includes(row.status))
}

/**
 * Los turnos de la categoría, en su orden.
 *
 * @param {object} category - un elemento de CATEGORIES.
 * @param {Array} turns - lo que devuelve groupTurns.
 * @returns {Array} los turnos que van en ella; los cercanos primero, o los
 *   más nuevos si la categoría tiene newestFirst.
 * Lo usa: pages/Reservations/ReservationsPage.jsx.
 */
export function turnsIn(category, turns) {
  return turns
    .filter((turn) => turnInCategory(category, turn))
    .sort((a, b) => {
      const order = startKey(a.cls).localeCompare(startKey(b.cls))
      return category.newestFirst ? -order : order
    })
}

/**
 * Todas las reservas del turno de `cls` (canceladas incluidas): en pie primero, por nombre.
 * `classes` son las reservas cargadas de GET /api/classes.
 * Lo usan: components/ClassDetailDialog.jsx, pages/Reservations/ReservationsPage.jsx.
 */
export function turnRows(cls, classes) {
  const key = turnKey(cls)
  return orderTurnRows(classes.filter((other) => turnKey(other) === key))
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

/**
 * La clave de un turno: 'teacherId|date|startTime'. Es la misma identidad que
 * usa el backend para el turno (material, /turn/{accept,cancel}).
 * Solo se llama dentro de este archivo; CalendarPage guarda el resultado de
 * groupTurns como `turnKey` y DayAgenda lo usa como key.
 */
export function turnKey(cls) {
  return `${cls.teacherId}|${cls.date}|${cls.startTime}`
}

/**
 * La próxima clase: la primera no cancelada que todavía no terminó, así que
 * una en curso cuenta (es la que el usuario tiene ahora). Una pendiente
 * también: el horario ya está tomado aunque falte la respuesta.
 *
 * @param {object[]} classes - las reservas de GET /api/classes.
 * @param {object} [now] - nowParts().
 * @returns {object|null} una reserva (la primera de su turno).
 * Lo usa: pages/Reservations/ReservationsPage.jsx ("Próxima clase").
 */
export function nextClass(classes, now = nowParts()) {
  // FILTRO: solo las en pie que no terminaron (regla de pantalla).
  const vienen = activeRows(classes)
    .filter((cls) => !hasEnded(cls, now))
    .sort((a, b) => startKey(a).localeCompare(startKey(b)))
  return oneByTurn(vienen)[0] || null
}

/**
 * La última clase en la que se participó: la más reciente que ya terminó y no se canceló.
 * Mismos parámetros que nextClass. Lo usa: pages/Reservations/ReservationsPage.jsx ("Última clase").
 */
export function lastClass(classes, now = nowParts()) {
  // FILTRO: solo las en pie que ya terminaron (regla de pantalla).
  const pasaron = activeRows(classes)
    .filter((cls) => hasEnded(cls, now))
    .sort((a, b) => startKey(b).localeCompare(startKey(a)))
  return oneByTurn(pasaron)[0] || null
}

/**
 * Las reservas no canceladas del mismo turno que `cls` (ella incluida), por nombre de alumno.
 * Lo usa: pages/Reservations/ReservationsPage.jsx.
 */
export function turnSiblings(cls, classes) {
  return activeRows(turnRows(cls, classes))
}

/**
 * Las reservas con `hasMaterial` actualizado en el turno de `cls`: el
 * material es del turno, así que vale para todas sus reservas en pie. Las
 * canceladas no: el backend nunca les da material (no se dieron), y
 * marcarlas acá dejaría un clip que al recargar desaparece.
 *
 * @param {object[]} classes - las reservas en el estado de la pantalla.
 * @param {object} cls - la clase cuyo material cambió (lo avisa ClassMaterial).
 * @param {boolean} hasMaterial - cómo quedó.
 * @returns {object[]} una lista nueva.
 * Lo usa: pages/Reservations/ReservationsPage.jsx.
 */
export function withTurnMaterial(classes, cls, hasMaterial) {
  const key = turnKey(cls)
  const enPie = new Set(activeRows(classes))
  return classes.map((item) =>
    turnKey(item) === key && enPie.has(item) ? { ...item, hasMaterial } : item,
  )
}

/**
 * Lo que paga cada alumno de una grupal, para el docente: cada reserva tiene
 * su precio (una usa paquete, otra canjeó neuronas, otra paga todo), así que
 * un solo número rotulado "por alumno" mentiría. Si todos pagan lo mismo es
 * ese monto; si no, el rango "$ 2.500 – $ 5.000". Mira las reservas en pie
 * (o todas, si no queda ninguna). El detalle de cada uno está en "Ver
 * alumnos".
 *
 * @param {object[]} rows - las reservas del turno (`rows` de groupTurns, o turnRows).
 * @returns {string}
 * Lo usan: components/ClassCard.jsx, ClassDetailDialog.jsx, pages/Calendar/DayAgenda.jsx.
 */
export function turnPriceLabel(rows) {
  const enPie = activeRows(rows)
  const precios = (enPie.length > 0 ? enPie : rows).map((row) => row.priceCents)
  const min = Math.min(...precios)
  const max = Math.max(...precios)
  return min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`
}

// Los filtros de la lista de una categoría (pages/Reservations/CategoryDialog.jsx).
// Vacío = sin filtrar.
export const EMPTY_FILTERS = { subjectId: '', from: '', to: '', name: '' }

/** Si hay algún filtro puesto. Lo usa: pages/Reservations/CategoryDialog.jsx. */
export function hasFilters(filters) {
  return Object.values(filters).some((value) => value !== '')
}

/**
 * Las materias que aparecen en esos turnos, por nombre: para el selector.
 * @returns {Array<{id: string, name: string}>} de subjectId/subjectName de cada clase.
 * Lo usa: pages/Reservations/CategoryDialog.jsx.
 */
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
 * FILTRO: los turnos de una categoría según lo que ELIGIÓ el usuario en
 * CategoryDialog (materia, desde/hasta, nombre). Fechas 'YYYY-MM-DD', las dos puntas
 * incluidas (se comparan como texto: el formato ordena bien). El nombre se
 * busca sin tildes ni mayúsculas y alcanza con una parte ("rami" encuentra
 * a Sofía Ramírez).
 *
 * @param {Array} turns - turnos de groupTurns (ya en la categoría).
 * @param {object} filters - con la forma de EMPTY_FILTERS (estado de CategoryDialog).
 * @param {string} viewRole - el rol de la sesión: decide si se busca por docente o por alumno.
 * @returns {Array}
 * Lo usa: pages/Reservations/CategoryDialog.jsx.
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
