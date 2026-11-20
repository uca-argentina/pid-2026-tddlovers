import { normalizeText } from './booking.js'

// Las sugerencias del buscador de la barra (solo alumnos): materias de
// GET /api/subjects y docentes de GET /api/teachers. Lo usa
// components/SearchBar.jsx. Lo que se elige termina en /disponibilidad?q=…,
// y ahí lo interpreta resolveQuery de utils/booking.js.

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
 * Las sugerencias del buscador, separadas en materias y docentes. No corta
 * en ninguna cantidad: que se vean solo tres por sección es cosa del CSS, el
 * resto queda a un scroll de distancia.
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
