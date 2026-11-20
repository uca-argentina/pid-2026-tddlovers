import { normalizeText } from './booking.js'

// El buscador de la barra (solo alumnos): las sugerencias (materias de
// GET /api/subjects y docentes de GET /api/teachers, para
// components/SearchBar.jsx) y qué significa lo buscado cuando llega a
// /disponibilidad?q=… (resolveQuery, para pages/Booking/BookingBoard.jsx).

/**
 * El nombre que se muestra y contra el que se busca un docente.
 *
 * @param {{nombre?: string, apellido?: string}|null} teacher - de GET /api/teachers.
 * @returns {string} 'Nombre Apellido'.
 * Lo usa: components/SearchBar.jsx.
 */
export function teacherFullName(teacher) {
  return [teacher?.nombre, teacher?.apellido].filter(Boolean).join(' ')
}

/**
 * Qué tan bien pega lo tipeado con un nombre: 0 si el nombre empieza así, 1
 * si empieza así alguna de sus palabras, 2 si aparece en el medio, null si no
 * aparece. Así "go" pone a "Gómez" antes que a "Hugo", que también lo
 * contiene pero es mucho menos probable que sea lo que se está buscando.
 */
function matchRank(name, texto) {
  const nombre = normalizeText(name)
  if (nombre.startsWith(texto)) return 0
  if (nombre.split(/\s+/).some((palabra) => palabra.startsWith(texto))) return 1
  if (nombre.includes(texto)) return 2
  return null
}

function rankBy(items, texto, getName) {
  return items
    .map((item) => ({ item, name: getName(item), rank: matchRank(getName(item), texto) }))
    .filter((entry) => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'es'))
    .map((entry) => entry.item)
}

/**
 * FILTRO: las sugerencias del buscador, separadas en materias y docentes. No corta
 * en ninguna cantidad: que se vean solo tres por sección es cosa del CSS, el
 * resto queda a un scroll de distancia.
 *
 * Oculta lo que no pega con lo tipeado (lo eligió el usuario al tipear). El
 * catálogo de docentes ya viene solo con los aprobados (regla del backend,
 * listTeachers en backend/src/db/users.js).
 *
 * Los docentes se buscan por nombre y no por las materias que dan: para eso
 * está la sección de materias, y mezclarlo llenaría "Docentes" de gente que
 * no se llama como lo que se tipeó.
 *
 * @param {string} query - lo tipeado en el buscador.
 * @param {{subjects?: Array<{id, name}>, teachers?: Array<{id, nombre, apellido}>}} lists -
 *   el catálogo (fetchSubjects) y los docentes aprobados (fetchTeachers).
 * @returns {{subjects: Array, teachers: Array}} los que coinciden, mejor coincidencia primero.
 * Lo usa: components/SearchBar.jsx.
 */
export function suggest(query, { subjects = [], teachers = [] } = {}) {
  const texto = normalizeText(query)
  if (!texto) return { subjects: [], teachers: [] }

  return {
    subjects: rankBy(subjects, texto, (subject) => subject.name),
    teachers: rankBy(teachers, texto, teacherFullName),
  }
}

/**
 * Qué significa el `q` de la URL: si es EXACTAMENTE el nombre de una materia
 * (sin acentos ni mayúsculas) es un filtro de materia, como si se hubiera
 * tocado el chip; si no, es texto libre, que en el tablero pega con el nombre
 * del docente o el de una materia (filterCards en utils/booking.js).
 *
 * Exacto y no "empieza con": con startsWith, "Ana" + Enter terminaba en
 * Análisis y nunca buscaba a la docente Ana. Las sugerencias mandan el nombre
 * completo de la materia, así que elegir una sigue siendo un filtro de materia,
 * y "mate" a secas busca igual en las materias como texto.
 *
 * @param {string} q - el ?q= de /disponibilidad (lo pone components/SearchBar.jsx).
 * @param {Array<{id, name}>} subjects - el catálogo de GET /api/subjects.
 * @returns {{subjectId: string|null, teacherQuery: string}} `teacherQuery` es el texto libre.
 * Lo usa: pages/Booking/BookingBoard.jsx.
 */
export function resolveQuery(q, subjects) {
  const texto = normalizeText(q)
  if (!texto) return { subjectId: null, teacherQuery: '' }

  const materia = subjects.find((subject) => normalizeText(subject.name) === texto)
  if (materia) return { subjectId: materia.id, teacherQuery: '' }

  return { subjectId: null, teacherQuery: q.trim() }
}
