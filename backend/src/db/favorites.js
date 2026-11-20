import { getPool } from './pool.js';
import { ratedSubjectsJson } from './rates.js';

// Los docentes favoritos del alumno. Solo se leen los aprobados: el favorito
// de un docente pendiente o dado de baja queda guardado pero no se muestra,
// y vuelve solo si lo aprueban de nuevo.
//
// Tablas: favorite_teachers (migración 017, PK (student_id, teacher_id));
// lee users (001/002/012), subjects (002) y teacher_rates (009). Sin locks.
// Lo usa: routes/favorites/index.js.

/**
 * Los favoritos del alumno con las materias que ofrecen, misma forma que
 * listTeachers ({ id, nombre, apellido, subjects }). Una materia cuenta si
 * tiene tarifa (el mismo criterio que el buscador). A diferencia del
 * buscador, un docente sin ninguna materia tarifada SÍ aparece, con
 * subjects vacío: el alumno lo eligió y no tiene por qué desaparecerle.
 *
 * @param {string} studentId - request.user.id del alumno.
 * @returns {Promise<Array<{id, nombre, apellido, subjects: Array<{id, name}>}>>}
 * Origen: favorite_teachers JOIN users (solo docentes aprobados), materias de teacher_rates + subjects.
 * Lo usa: routes/favorites/index.js (GET /api/favorites).
 */
export async function listFavoriteTeachers(studentId) {
  // FILTRO: solo los favoritos del propio alumno y de docentes aprobados; el
  // de un docente pendiente o dado de baja queda guardado pero no sale (y
  // vuelve si lo aprueban). Uno sin materias tarifadas sí sale, vacío.
  const result = await getPool().query(
    `SELECT u.id, u.nombre, u.apellido, COALESCE(subj.subjects, '[]'::json) AS subjects
     FROM favorite_teachers f
     JOIN users u ON u.id = f.teacher_id
     LEFT JOIN LATERAL (${ratedSubjectsJson('u.id')}) subj ON true
     WHERE f.student_id = $1 AND u.role = 'teacher' AND u.approval_status = 'approved'
     ORDER BY u.nombre, u.apellido`,
    [studentId]
  );
  return result.rows;
}

/**
 * Marca al docente como favorito. Devuelve false si ese id no es un docente
 * aprobado (no se puede marcar a alguien que el alumno no puede reservar).
 * Marcarlo dos veces no hace nada.
 *
 * @param {string} studentId - request.user.id del alumno.
 * @param {string} teacherId - params.teacherId de PUT /api/favorites/:teacherId (ya con forma de UUID).
 * @returns {Promise<boolean>} true si quedó (o ya estaba) como favorito.
 * Origen: INSERT en favorite_teachers condicionado a users; si no insertó, re-lee users.
 * Lo usa: routes/favorites/index.js.
 */
export async function addFavoriteTeacher(studentId, teacherId) {
  const result = await getPool().query(
    `INSERT INTO favorite_teachers (student_id, teacher_id)
     SELECT $1, u.id FROM users u
     WHERE u.id = $2 AND u.role = 'teacher' AND u.approval_status = 'approved'
     ON CONFLICT DO NOTHING
     RETURNING teacher_id`,
    [studentId, teacherId]
  );
  if (result.rowCount > 0) return true;

  // Sin fila insertada puede ser que ya estaba: eso cuenta como hecho.
  const existing = await getPool().query(
    `SELECT 1 FROM users WHERE id = $1 AND role = 'teacher' AND approval_status = 'approved'`,
    [teacherId]
  );
  return existing.rowCount > 0;
}

/**
 * Lo saca de favoritos. Si no estaba, no pasa nada.
 *
 * @param {string} studentId - request.user.id del alumno.
 * @param {string} teacherId - params.teacherId de DELETE /api/favorites/:teacherId.
 * @returns {Promise<void>}
 * Origen: DELETE en favorite_teachers.
 * Lo usa: routes/favorites/index.js.
 */
export async function removeFavoriteTeacher(studentId, teacherId) {
  await getPool().query(
    `DELETE FROM favorite_teachers WHERE student_id = $1 AND teacher_id = $2`,
    [studentId, teacherId]
  );
}
