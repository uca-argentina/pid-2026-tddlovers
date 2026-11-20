// Lo que hace la pantalla del alumno con las filas que manda el backend, y el
// ÚNICO lugar de los filtros que ELIGE el usuario en el tablero (día, materia,
// modalidad, individual/grupal, horario, texto, solo favoritos).
//
// Cada fila es UNA ventana de un docente en UNA fecha (ver
// lib/availabilityExpansion.js en el backend): modalidad, cupo, las materias
// que se pueden reservar con su tarifa (`subjects`), los inicios que ESTE
// alumno puede reservar con su duración máxima (`starts`) y las grupales a
// las que se puede sumar (`groups`). Qué se ve y qué no (lo completo, lo que
// le choca con sus clases, lo pasado, lo ya anotado, el destacado de
// licencia) lo decide el backend: acá no se vuelve a calcular.
//
// La dirección de imports es siempre booking -> {calendar, availability} y
// nunca al revés, así que no hay ciclo posible. (windows.js y search.js
// importan de acá, y acá no se importa de ellos por lo mismo.)
//
// Origen de los datos: las filas ("cards") son la respuesta de
// GET /api/availability (fetchAvailability), cada una { id, windowId, date,
// dayKey, teacherId, teacherName, teacherAcceptsRewards, teacherFeatured,
// start, end, modality, maxStudents, locality, subjects, starts, groups,
// onVacation } — la arma bookableRows de
// backend/src/lib/availabilityExpansion.js.
//
// Lo usan: pages/Booking/ (BookingBoard, BookingCard, BookingDialog,
// BookingFilters, BookingResults), utils/windows.js, utils/search.js y
// utils/reservations.js (normalizeText).
//
// ---------------------------------------------------------------------------
// ÍNDICE: Filtros del frontend. Cada uno lleva un comentario `FILTRO:` que
// dice qué oculta, si lo eligió el usuario o es regla, y quién decide.
//
// Reservar (tablero del alumno)
//   utils/booking.js:filterCards — los filtros que elige el alumno (día, materia, modalidad,
//     tipo, horario, texto, favoritos).
//   utils/booking.js:countBookableByDate — el número verde / "N para reservar" sin licencias.
//   utils/booking.js:filterSubjectsFor — chips de materia: solo las del rango cargado.
//   pages/Booking/BookingBoard.jsx:getFilters — "Solo favoritos" pasa a lista de docentes.
//   pages/Booking/BookingBoard.jsx:getFilteredByDate — aplica filterCards y agrupa por día.
//   pages/Booking/BookingBoard.jsx:getFreeByDate — número verde (countBookableByDate).
//   pages/Booking/BookingBoard.jsx:getFilterSubjects — chips de materia (filterSubjectsFor).
//   pages/Booking/BookingBoard.jsx:componentDidUpdate — apaga "Solo favoritos" si no es alumno.
//   pages/Booking/BookingBoard.jsx:renderQuickFilters — chip de favoritos solo para alumnos.
//   pages/Booking/BookingBoard.jsx:renderMobile — buscador solo para alumnos.
//   pages/Booking/BookingFilters.jsx:BookingFilters — el panel donde se eligen los filtros.
//   pages/Booking/BookingFilters.jsx:renderFavorites — "Solo favoritos" solo para alumnos.
//   pages/Booking/BookingResults.jsx:render — "N clases para reservar" sin licencias.
//   pages/Booking/BookingCard.jsx:renderPack — resumen del paquete solo si sirve ese día.
//   utils/packs.js:usablePackFor — el paquete usable con ese docente ese día (`usable` del back).
//   api/client.js:fetchAvailability — qué filas vienen lo decide el backend (bookableRows).
//
// Búsqueda y sugerencias
//   utils/search.js:suggest — sugerencias que pegan con lo tipeado.
//   components/SearchBar.jsx:getSuggestions — usa suggest; docentes aprobados del backend.
//
// Calendario
//   pages/Calendar/CalendarPage.jsx:getClassesByDate — sin turnos cancelados para todos.
//   pages/Calendar/CalendarPage.jsx:loadPending — clases (turnos) con solicitudes pendientes.
//   pages/Calendar/CalendarPage.jsx:renderPending — el aviso solo para el docente.
//   utils/reservations.js:calendarTurns — un turno por clase, sin los cancelados para todos.
//   pages/Calendar/DayAgenda.jsx:renderPlace — dirección exacta solo pagada (la decide el back).
//   pages/Calendar/DayAgenda.jsx:renderFavorite — corazón solo para alumnos.
//   pages/Calendar/DayAgenda.jsx:getDays — días con clases más el elegido.
//   api/client.js:fetchMyLessons — clases propias en pie (líneas del calendario del tablero).
//
// Mis reservas
//   utils/reservations.js:activeRows — reservas en pie (sin canceladas).
//   utils/reservations.js:turnInCategory — en qué categoría va cada turno.
//   utils/reservations.js:nextClass — próxima: en pie y sin terminar.
//   utils/reservations.js:lastClass — última: en pie y terminada.
//   utils/reservations.js:filterTurns — filtros que elige el usuario en la categoría.
//   pages/Reservations/ReservationsPage.jsx:lastBadge — "Falta tomar lista" solo al docente.
//   pages/Reservations/ReservationsPage.jsx:renderCategories — cuenta los turnos de cada una.
//   pages/Reservations/CategoryDialog.jsx:render — aplica filterTurns.
//   components/ClassCard.jsx:render — corazón solo para alumnos.
//
// Detalle, acciones y asistencia
//   utils/classStates.js:allowedActions — qué botones (espejo de checkAction del backend).
//   components/ClassActions.jsx:render — botones de allowedActions menos `exclude`.
//   components/TurnActions.jsx:active — acciones solo sobre las reservas en pie.
//   components/StudentsDialog.jsx:renderRow — el pago solo en reservas en pie.
//   components/AttendanceDialog.jsx:handleAllPresent — "Todos presentes" solo a los sin marca.
//   components/ClassDetailDialog.jsx:getRows — el alumno ve solo su reserva.
//   components/ClassDetailDialog.jsx:renderTeacherStatus — alumnos solo antes de empezar.
//   components/ClassDetailDialog.jsx:renderAttendance — "Tomar asistencia" si ya empezó.
//   components/ClassDetailDialog.jsx:render — material solo si la clase pudo tenerlo.
//
// Material
//   utils/classMaterials.js:canHaveMaterial — clase dada (espejo del backend).
//   components/ClassMaterial.jsx:renderBody — se ve con la clase dada y terminada.
//
// Disponibilidad del docente
//   pages/Availability/AvailabilityPage.jsx:renderBody — docente: su disponibilidad; otro: tablero.
//   pages/Availability/DayWindowsDialog.jsx:canEdit — un día pasado no se edita.
//   utils/windows.js:windowsOn — las ventanas que caen ese día.
//   utils/windows.js:windowOffered — si los alumnos la ven (tiene tarifa en esa modalidad).
//   utils/vacations.js:isOnVacation — días de licencia rayados para el docente.
//
// Paquetes
//   pages/Packs/PacksPage.jsx:PacksPage — el catálogo solo trae activas de aprobados (backend).
//   pages/Packs/PacksPage.jsx:handleRemove — la oferta desactivada sale de la lista.
//   pages/Packs/PacksPage.jsx:renderMyPack — "ya reservadas" solo en paquetes vigentes.
//
// Neuronas
//   pages/Neuronas/NeuronasPage.jsx:renderRewards — canjes solo para el alumno.
//   pages/Neuronas/NeuronasPage.jsx:featuredProblem — por qué no se puede comprar Destacado.
//   pages/Neuronas/NeuronasPage.jsx:renderFeatured — Destacado solo para el docente.
//
// Tareas
//   pages/Homework/HomeworkPage.jsx:load — qué tareas y entregas vienen (backend, por rol).
//   pages/Homework/NewHomeworkDialog.jsx:NewHomeworkDialog — destinos posibles (backend).
//
// Favoritos
//   pages/Favorites/FavoritesPage.jsx:load — solo alumnos; solo docentes aprobados (backend).
//   routes/withFavorites.jsx:load — pide favoritos solo si es alumno.
//
// Admin
//   pages/Admin/AdminPage.jsx:esAdmin — la pantalla solo carga para el admin.
//   pages/Admin/AdminPage.jsx:load — los docentes de la pestaña elegida (backend ?status=).
//   pages/Admin/AdminPage.jsx:handleDecision — el que cambió de estado sale de la pestaña.
//
// Navbar
//   components/NavBar.jsx:render — qué links/buscador ve cada rol.
//
// El índice del backend está en backend/src/lib/availabilityExpansion.js, y
// `grep -rn "FILTRO:"` los encuentra todos (front y back).
// ---------------------------------------------------------------------------

import { DAY_KEYS } from './availability.js'
import { fromISODate, mondayIndex } from './calendar.js'
import { MIN_CLASS_MINUTES } from './rates.js'

/** '2026-09-14' -> 'lunes' (null si la fecha no es válida). Lo usa: utils/windows.js. */
export function dayKeyFromIso(iso) {
  const date = fromISODate(iso)
  if (Number.isNaN(date.getTime())) return null
  return DAY_KEYS[mondayIndex(date)]
}

/**
 * 'HH:MM' -> minutos desde medianoche ('24:00' -> 1440), o -1 si no es hora.
 * Lo usan: utils/windows.js, pages/Booking/BookingDialog.jsx, pages/Availability/WindowForm.jsx
 * y WeekCalendar.jsx (estos dos lo reciben reexportado desde utils/windows.js).
 */
export function toMinutes(time) {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(time ?? '')
  if (!match) return -1
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * La tarifa más baja de la ventana, para el "desde $ X/h" de la tarjeta.
 * Mira los `subjects` de la fila (con hourlyRateCents). null si no hay ninguna.
 * Lo usa: pages/Booking/BookingCard.jsx.
 */
export function lowestRate(card) {
  const tarifas = (card.subjects || []).map((subject) => subject.hourlyRateCents)
  return tarifas.length > 0 ? Math.min(...tarifas) : null
}

/**
 * { [iso]: Card[] }, cada lista ordenada por hora y docente, con los destacados
 * primero. `teacherFeatured` ya viene en false si el docente está de licencia
 * ese día (lo decide el backend): acá no se vuelve a mirar.
 *
 * @param {object[]} cards - filas ya filtradas (filterCards).
 * @returns {Object<string, object[]>}
 * Lo usa: pages/Booking/BookingBoard.jsx.
 */
export function groupCardsByDate(cards) {
  const porFecha = {}

  for (const card of cards) {
    if (!porFecha[card.date]) porFecha[card.date] = []
    porFecha[card.date].push(card)
  }

  for (const iso of Object.keys(porFecha)) {
    const destacada = (card) => (card.teacherFeatured ? 0 : 1)
    porFecha[iso].sort((a, b) => {
      const prioridad = destacada(a) - destacada(b)
      if (prioridad !== 0) return prioridad
      const inicio = a.start.localeCompare(b.start)
      if (inicio !== 0) return inicio
      return a.teacherName.localeCompare(b.teacherName)
    })
  }

  return porFecha
}

/**
 * FILTRO: el número verde de cada día del calendario y el "N clases para
 * reservar" cuentan solo las tarjetas que se pueden reservar. Regla: las de
 * licencia (`onVacation`, del backend) se ven en gris pero no cuentan.
 *
 * @param {Object<string, object[]>} cardsByDate - lo de groupCardsByDate.
 * @returns {Object<string, number>}
 * Lo usan: pages/Booking/BookingBoard.jsx (getFreeByDate) y BookingResults.jsx.
 */
export function countBookableByDate(cardsByDate) {
  const counts = {}
  for (const [iso, cards] of Object.entries(cardsByDate)) {
    counts[iso] = cards.filter((card) => !card.onVacation).length
  }
  return counts
}

/**
 * Minúsculas y sin acentos, para comparar lo tipeado contra nombres con tilde.
 * Lo usan: este archivo, utils/search.js y utils/reservations.js.
 */
export function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Los inicios de la fila: los de clases nuevas (`starts`) y los de grupales a
 * las que sumarse (`groups`), cada uno con su materia (null = cualquiera de
 * `subjects`). Una fila de licencia no tiene ninguno.
 */
function rowStarts(card) {
  return [
    ...(card.starts || []).map((option) => ({ start: option.start, subjectId: null })),
    ...(card.groups || []).map((group) => ({ start: group.start, subjectId: group.subjectId })),
  ]
}

/**
 * ¿Alguna clase puede ARRANCAR entre `fromTime` y `toTime`? Cualquiera de
 * los dos puede venir vacío (sin límite). Cuenta los inicios de clases nuevas
 * (`starts`) y sumarse a una grupal (`groups`). Una fila de licencia no tiene
 * inicios: se mira su rango, para que siga apareciendo en gris donde
 * aparecería si no estuviera de licencia.
 * Lo usa: filterCards (acá mismo), para el filtro de horario.
 */
export function offersStartBetween(card, fromTime, toTime) {
  const desde = fromTime ? toMinutes(fromTime) : 0
  const hasta = toTime ? toMinutes(toTime) : Infinity
  if (card.onVacation) {
    const inicio = toMinutes(card.start)
    const ultimo = toMinutes(card.end) - MIN_CLASS_MINUTES
    return inicio <= hasta && ultimo >= desde
  }
  return rowStarts(card).some(({ start }) => {
    const inicio = toMinutes(start)
    return inicio >= desde && inicio <= hasta
  })
}

/**
 * ¿Se puede reservar alguna de `subjectIds` en la fila? Pasa si la materia
 * está entre las de la fila y hay algún inicio nuevo (que se puede tomar en
 * cualquier materia tarifada), o si hay una grupal DE ESA materia: una grupal
 * de otra materia no sirve para tomar esta. En una de licencia se miran las
 * materias que ofrecería. Los ids se comparan como string: pueden venir de la URL.
 */
function offersSubject(card, subjectIds) {
  const elegidas = new Set(subjectIds.map(String))
  const tieneTarifa = (card.subjects || []).some((subject) => elegidas.has(String(subject.id)))
  if (card.onVacation) return tieneTarifa
  if (tieneTarifa && (card.starts || []).length > 0) return true
  return (card.groups || []).some((group) => elegidas.has(String(group.subjectId)))
}

/**
 * 'individual' o 'group': el tipo de clase para el filtro, según `maxStudents` de la fila.
 * Lo usan: filterCards (acá mismo), pages/Booking/BookingFilters.jsx.
 */
export function cardKind(card) {
  return card.maxStudents > 1 ? 'group' : 'individual'
}

/**
 * Los filtros del tablero sin nada elegido. Listas vacías y strings vacíos son
 * "no filtra"; `onlyFavorites` se traduce a `teacherIds` al filtrar, porque
 * los favoritos los conoce el tablero y no el filtro. `teacherQuery` es el
 * texto libre de la búsqueda (el ?q= que no resultó ser una materia): pega
 * con el nombre del docente o con el de una materia.
 * Lo usan: pages/Booking/BookingBoard.jsx (estado inicial) y BookingFilters.jsx.
 */
export const EMPTY_BOOKING_FILTERS = Object.freeze({
  dayKeys: [],
  subjectIds: [],
  modalities: [],
  kinds: [],
  fromTime: '',
  toTime: '',
  teacherQuery: '',
  onlyFavorites: false,
})

/**
 * Cuántos filtros hay prendidos, para el "Filtros (3)" del teléfono. El
 * horario cuenta como uno aunque tenga las dos puntas: es un solo rango.
 * Recibe filtros con la forma de EMPTY_BOOKING_FILTERS. Lo usa: pages/Booking/BookingBoard.jsx.
 */
export function countBookingFilters(filters) {
  return (
    filters.dayKeys.length +
    filters.subjectIds.length +
    filters.modalities.length +
    filters.kinds.length +
    (filters.fromTime || filters.toTime ? 1 : 0) +
    (filters.teacherQuery ? 1 : 0) +
    (filters.onlyFavorites ? 1 : 0)
  )
}

/**
 * ¿El texto libre pega con la fila? Con el nombre del docente o con el de
 * alguna materia que se reserva ahí, sin acentos ni mayúsculas.
 */
function matchesText(card, texto) {
  if (normalizeText(card.teacherName).includes(texto)) return true
  return (card.subjects || []).some((subject) => normalizeText(subject.name).includes(texto))
}

/**
 * FILTRO: las tarjetas del tablero según lo que ELIGIÓ el alumno (día,
 * materia, modalidad, individual/grupal, horario de arranque, texto libre,
 * solo favoritos). Es el único filtro del tablero que corre en el front: lo
 * que NO se ve por regla (lo completo, lo que le choca, lo pasado, lo que no
 * tiene tarifa) ya lo sacó el backend (lib/availabilityExpansion.js).
 *
 * Se combinan con Y: una lista vacía o un string vacío significa "no
 * filtra". Dentro de un mismo grupo de chips es O (Virtual o Presencial).
 *
 * El filtro de materia deja pasar la ventana si se puede reservar ALGUNA de
 * las elegidas: un inicio nuevo con tarifa en esa materia, o una grupal de
 * esa materia (ver offersSubject).
 *
 * OJO: el filtro de horas elige qué TARJETAS entran, pero NO esconde horarios
 * adentro de la tarjeta.
 *
 * @param {object[]} cards - las filas de GET /api/availability.
 * @param {object} [filters] - los de EMPTY_BOOKING_FILTERS más `teacherIds`
 *   (los favoritos de withFavorites cuando está "Solo favoritos", o null).
 * @returns {object[]}
 * Lo usa: pages/Booking/BookingBoard.jsx.
 */
export function filterCards(cards, filters = {}) {
  const {
    dayKeys = [],
    subjectIds = [],
    modalities = [],
    kinds = [],
    fromTime = '',
    toTime = '',
    teacherQuery = '',
    teacherIds = null,
  } = filters
  const texto = normalizeText(teacherQuery)
  // null = sin filtro por docente; un array (aunque esté vacío) = solo esos.
  // Vacío no muestra nada a propósito: "Solo favoritos" sin favoritos es eso.
  const docentes = teacherIds ? new Set(teacherIds.map(String)) : null

  return cards.filter((card) => {
    if (dayKeys.length > 0 && !dayKeys.includes(card.dayKey)) return false
    if (subjectIds.length > 0 && !offersSubject(card, subjectIds)) return false
    if (modalities.length > 0 && !modalities.includes(card.modality)) return false
    if (kinds.length > 0 && !kinds.includes(cardKind(card))) return false
    if (texto && !matchesText(card, texto)) return false
    if (docentes && !docentes.has(String(card.teacherId))) return false
    if ((fromTime || toTime) && !offersStartBetween(card, fromTime, toTime)) return false
    return true
  })
}

/**
 * FILTRO: los chips de materia del tablero muestran solo las del catálogo que
 * se pueden reservar en algún horario del rango cargado (en `subjects` o en
 * una grupal de alguna fila). Regla de pantalla, no del backend: un chip que
 * no deja nada sería ruido. Las ya elegidas se agregan igual: si no, un chip
 * seleccionado que se queda sin resultados desaparecería y no habría forma de
 * sacarlo.
 *
 * @param {object[]} cards - las filas de GET /api/availability (sin filtrar).
 * @param {Array<{id, name}>} catalog - GET /api/subjects.
 * @param {Array<string|number>} selectedIds - `filters.subjectIds`.
 * @returns {Array<{id, name}>} en el orden del catálogo.
 * Lo usa: pages/Booking/BookingBoard.jsx.
 */
export function filterSubjectsFor(cards, catalog, selectedIds = []) {
  // Todo se normaliza a string: el id elegido puede venir de la URL (siempre
  // string) y el de las tarjetas del backend, y un Set compara con ===.
  const presentes = new Set(selectedIds.map(String))
  for (const card of cards) {
    for (const subject of card.subjects || []) presentes.add(String(subject.id))
    for (const group of card.groups || []) presentes.add(String(group.subjectId))
  }
  return catalog.filter((subject) => presentes.has(String(subject.id)))
}

/**
 * '2 de 5 anotados'. `enrolled` y `maxStudents` son los de un elemento de
 * `groups` de la fila (el cupo del turno, no el de la ventana).
 * Lo usan: pages/Booking/BookingCard.jsx, BookingDialog.jsx.
 */
export function formatEnrolled(enrolled, maxStudents) {
  return `${enrolled} de ${maxStudents} ${maxStudents === 1 ? 'anotado' : 'anotados'}`
}
