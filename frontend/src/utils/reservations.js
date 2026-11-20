import { normalizeText } from './booking.js'
import { hasEnded, nowParts } from './bookingStates.js'
import { formatMoney } from './rates.js'
import { capacityLabel } from './windows.js'

// Cómo se ordena "Mis reservas": las cinco categorías, la próxima clase, la
// última y la clase de una grupal. Funciones puras para probarlas sin montar
// la pantalla.
//
// Las clases que se ven ya las decidió el backend (GET /api/bookings devuelve
// solo las del usuario de la sesión); acá solo se ordenan, agrupan y cuentan.
//
// Todas trabajan sobre las reservas tal como las devuelve GET /api/bookings
// (fetchBookings): una fila por alumno, así que en una grupal el docente
// recibe varias filas del misma clase (teacherId + date + startTime).
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
 * @param {object[]} rows - reservas de GET /api/bookings.
 * @returns {object[]}
 * Lo usan: este archivo, api/client.js (fetchMyBookings), components/
 * (ClassCard vía classCapacityLabel, ClassDetailDialog, ClassActions,
 * StudentsDialog) y pages/Calendar/DayAgenda.jsx (vía classCapacityLabel).
 */
export function activeRows(rows) {
  return rows.filter((row) => row.status !== 'cancelada')
}

/**
 * Las reservas de un misma clase en el orden en que se muestran: las que
 * siguen en pie primero y las canceladas al final, cada grupo por nombre de
 * alumno. Así la primera es siempre la que representa a la clase.
 * Lo usan: groupClasses y classRows (acá mismo).
 */
export function orderClassRows(rows) {
  const active = activeRows(rows).sort(byName)
  const canceladas = rows.filter((row) => row.status === 'cancelada').sort(byName)
  return [...active, ...canceladas]
}

/**
 * Las reservas agrupadas en clases: una clase (docente, fecha, inicio) es UNA
 * clase aunque en una grupal tenga una reserva por alumno. Cada clase es
 * { key, cls, rows, active }: `rows` todas sus reservas (las canceladas
 * también, para el detalle), `active` las que siguen en pie y `cls` la que lo
 * representa en la tarjeta (la primera en pie, o la primera si no queda
 * ninguna). Para el alumno cada clase es una sola reserva: nunca tiene dos en
 * pie en el misma clase.
 *
 * @param {object[]} bookings - las reservas de GET /api/bookings.
 * @returns {Array<{key: string, cls: object, rows: object[], active: object[]}>}
 * Lo usan: pages/Reservations/ReservationsPage.jsx, pages/Calendar/CalendarPage.jsx.
 */
export function groupClasses(bookings) {
  const porClase = new Map()
  for (const cls of bookings) {
    const key = classKey(cls)
    if (!porClase.has(key)) porClase.set(key, [])
    porClase.get(key).push(cls)
  }
  return [...porClase.entries()].map(([key, sinOrden]) => {
    const rows = orderClassRows(sinOrden)
    return { key, cls: rows[0], rows, active: activeRows(rows) }
  })
}

/**
 * FILTRO: las clases del calendario. Una clase cancelada para todos no ocupa
 * lugar en el calendario (se ve en "Mis reservas"); regla de pantalla. Cada
 * clase va una vez, como la reserva que lo representa, con `classKey` y todas
 * sus reservas en `rows` (las canceladas también, al final, como en el
 * detalle de Mis reservas).
 *
 * @param {object[]} bookings - las reservas de GET /api/bookings.
 * @returns {object[]} reservas planas (las que representan a cada clase) con classKey y rows.
 * Lo usa: pages/Calendar/CalendarPage.jsx.
 */
export function calendarClasses(bookings) {
  return groupClasses(bookings)
    .filter((entry) => entry.active.length > 0)
    .map((entry) => ({ ...entry.cls, classKey: entry.key, rows: entry.rows }))
}

/**
 * Cuántas CLASES (clases) tienen alguna reserva pendiente: una grupal con
 * tres solicitudes es una clase que espera respuesta, igual que la cuenta
 * Mis reservas (classesIn de la categoría Pendientes).
 *
 * @param {object[]} bookings - reservas de GET /api/bookings.
 * @returns {number}
 * Lo usa: pages/Calendar/CalendarPage.jsx (el aviso del docente).
 */
export function pendingClassCount(bookings) {
  const pendientes = CATEGORIES.find((category) => category.key === 'pendiente')
  return classesIn(pendientes, groupClasses(bookings)).length
}

/**
 * "Individual", "Grupal · hasta 4" o "Grupal · 2 de 4". El docente cuenta las
 * reservas en pie de la clase (`rows`); el alumno no las tiene y ve `enrolled`.
 * Nadie ve nombres en la tarjeta.
 *
 * @param {object} cls - la reserva que representa a la clase.
 * @param {object[]|null} rows - todas las reservas de la clase (o null: solo `cls`).
 * @param {string} viewRole - 'teacher' | 'student'.
 * @returns {string}
 * Lo usan: components/ClassCard.jsx y pages/Calendar/DayAgenda.jsx.
 */
export function classCapacityLabel(cls, rows, viewRole) {
  if (cls.maxStudents <= 1) return capacityLabel(cls.maxStudents)
  const filas = rows && rows.length > 0 ? rows : [cls]
  const anotados = viewRole === 'teacher' ? activeRows(filas).length : cls.enrolled
  return anotados ? `Grupal · ${anotados} de ${cls.maxStudents}` : capacityLabel(cls.maxStudents)
}

/**
 * FILTRO: si la clase va en la categoría de Mis reservas (regla de pantalla): si alguna reserva en pie está en ese
 * estado. Una grupal con un alumno pendiente y otro confirmado aparece en las
 * dos, porque en cada una hay algo que ver. En Canceladas, solo la que se
 * canceló para todos: un alumno que se bajó no cancela la clase.
 */
function classInCategory(category, entry) {
  if (category.key === 'cancelada') return entry.active.length === 0
  return entry.active.some((row) => category.statuses.includes(row.status))
}

/**
 * Las clases de la categoría, en su orden.
 *
 * @param {object} category - un elemento de CATEGORIES.
 * @param {Array} entries - lo que devuelve groupClasses.
 * @returns {Array} las clases que van en ella; los cercanos primero, o los
 *   más nuevos si la categoría tiene newestFirst.
 * Lo usa: pages/Reservations/ReservationsPage.jsx.
 */
export function classesIn(category, entries) {
  return entries
    .filter((entry) => classInCategory(category, entry))
    .sort((a, b) => {
      const order = startKey(a.cls).localeCompare(startKey(b.cls))
      return category.newestFirst ? -order : order
    })
}

/**
 * Todas las reservas de la clase de `cls` (canceladas incluidas): en pie primero, por nombre.
 * `bookings` son las reservas cargadas de GET /api/bookings.
 * Lo usan: components/ClassDetailDialog.jsx, pages/Reservations/ReservationsPage.jsx.
 */
export function classRows(cls, bookings) {
  const key = classKey(cls)
  return orderClassRows(bookings.filter((other) => classKey(other) === key))
}

/**
 * Una sola por clase: en una grupal el docente tiene una fila por alumno, y
 * "tu próxima clase" es una, no tres iguales. Se queda con la primera fila.
 */
function onePerClass(bookings) {
  const seen = new Set()
  return bookings.filter((cls) => {
    const key = classKey(cls)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * La clave de una clase: el `classId` de la reserva (bookings.id en el
 * backend): en una grupal todas las reservas lo comparten. Es el mismo id que
 * usan /api/classes/:classId/{accept,cancel} y el material. Una clase cancelada para todos y otra reservada
 * después en el mismo horario son clases distintas, con classId distinto.
 * Solo se llama dentro de este archivo; CalendarPage guarda el resultado de
 * groupClasses como `classKey` y DayAgenda lo usa como key.
 */
export function classKey(cls) {
  return String(cls.classId)
}

/**
 * La próxima clase: la primera no cancelada que todavía no terminó, así que
 * una en curso cuenta (es la que el usuario tiene ahora). Una pendiente
 * también: el horario ya está tomado aunque falte la respuesta.
 *
 * @param {object[]} bookings - las reservas de GET /api/bookings.
 * @param {object} [now] - nowParts().
 * @returns {object|null} una reserva (la primera de su clase).
 * Lo usa: pages/Reservations/ReservationsPage.jsx ("Próxima clase").
 */
export function nextClass(bookings, now = nowParts()) {
  // FILTRO: solo las en pie que no terminaron (regla de pantalla).
  const vienen = activeRows(bookings)
    .filter((cls) => !hasEnded(cls, now))
    .sort((a, b) => startKey(a).localeCompare(startKey(b)))
  return onePerClass(vienen)[0] || null
}

/**
 * La última clase en la que se participó: la más reciente que ya terminó y no se canceló.
 * Mismos parámetros que nextClass. Lo usa: pages/Reservations/ReservationsPage.jsx ("Última clase").
 */
export function lastClass(bookings, now = nowParts()) {
  // FILTRO: solo las en pie que ya terminaron (regla de pantalla).
  const pasaron = activeRows(bookings)
    .filter((cls) => hasEnded(cls, now))
    .sort((a, b) => startKey(b).localeCompare(startKey(a)))
  return onePerClass(pasaron)[0] || null
}

/**
 * Las reservas no canceladas del misma clase que `cls` (ella incluida), por nombre de alumno.
 * Lo usa: pages/Reservations/ReservationsPage.jsx.
 */
export function classSiblings(cls, bookings) {
  return activeRows(classRows(cls, bookings))
}

/**
 * Las reservas con `hasMaterial` actualizado en la clase de `cls`: el
 * material es de la clase, así que vale para todas sus reservas en pie. Las
 * canceladas no: el backend nunca les da material (no se dieron), y
 * marcarlas acá dejaría un clip que al recargar desaparece.
 *
 * @param {object[]} bookings - las reservas en el estado de la pantalla.
 * @param {object} cls - la clase cuyo material cambió (lo avisa ClassMaterial).
 * @param {boolean} hasMaterial - cómo quedó.
 * @returns {object[]} una lista nueva.
 * Lo usa: pages/Reservations/ReservationsPage.jsx.
 */
export function withClassMaterial(bookings, cls, hasMaterial) {
  const key = classKey(cls)
  const enPie = new Set(activeRows(bookings))
  return bookings.map((item) =>
    classKey(item) === key && enPie.has(item) ? { ...item, hasMaterial } : item,
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
 * @param {object[]} rows - las reservas de la clase (`rows` de groupClasses, o classRows).
 * @returns {string}
 * Lo usan: components/ClassCard.jsx, ClassDetailDialog.jsx, pages/Calendar/DayAgenda.jsx.
 */
export function classPriceLabel(rows) {
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
 * Las materias que aparecen en esos clases, por nombre: para el selector.
 * @returns {Array<{id: string, name: string}>} de subjectId/subjectName de cada clase.
 * Lo usa: pages/Reservations/CategoryDialog.jsx.
 */
export function subjectsOf(entries) {
  const porId = new Map()
  for (const { cls } of entries) porId.set(String(cls.subjectId), cls.subjectName)
  return [...porId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Los nombres por los que se busca: el alumno busca a su docente; el
 * docente, a cualquier alumno de la clase (en una grupal, a todos).
 */
function namesOf(entry, viewRole) {
  if (viewRole !== 'teacher') return [entry.cls.teacherName]
  return entry.rows.map((row) => row.studentName)
}

/**
 * FILTRO: las clases de una categoría según lo que ELIGIÓ el usuario en
 * CategoryDialog (materia, desde/hasta, nombre). Fechas 'YYYY-MM-DD', las dos puntas
 * incluidas (se comparan como texto: el formato ordena bien). El nombre se
 * busca sin tildes ni mayúsculas y alcanza con una parte ("rami" encuentra
 * a Sofía Ramírez).
 *
 * @param {Array} entries - clases de groupClasses (ya en la categoría).
 * @param {object} filters - con la forma de EMPTY_FILTERS (estado de CategoryDialog).
 * @param {string} viewRole - el rol de la sesión: decide si se busca por docente o por alumno.
 * @returns {Array}
 * Lo usa: pages/Reservations/CategoryDialog.jsx.
 */
export function filterClasses(entries, filters, viewRole) {
  const nombre = normalizeText(filters.name)
  return entries.filter(({ cls, ...entry }) => {
    if (filters.subjectId && String(cls.subjectId) !== String(filters.subjectId)) return false
    if (filters.from && cls.date < filters.from) return false
    if (filters.to && cls.date > filters.to) return false
    if (nombre) {
      const nombres = namesOf({ cls, ...entry }, viewRole).map(normalizeText)
      if (!nombres.some((n) => n.includes(nombre))) return false
    }
    return true
  })
}
