import { getPool } from './pool.js';

// Los docentes favoritos del alumno. Solo se leen los aprobados: el favorito
// de un docente pendiente o dado de baja queda guardado pero no se muestra,
// y vuelve solo si lo aprueban de nuevo.

/**
 * Los favoritos del alumno con las materias que ofrecen, misma forma que
 * listTeachers ({ id, nombre, apellido, subjects }). Una materia cuenta si
 * tiene tarifa (el mismo criterio que el buscador). A diferencia del
 * buscador, un docente sin ninguna materia tarifada SÍ aparece, con
 * subjects vacío: el alumno lo eligió y no tiene por qué desaparecerle.
 */
export async function listFavoriteTeachers(studentId) {
  const result = await getPool().query(
    `SELECT u.id, u.nombre, u.apellido, COALESCE(subj.subjects, '[]'::json) AS subjects
     FROM favorite_teachers f
     JOIN users u ON u.id = f.teacher_id
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name) AS subjects
       FROM subjects s
       WHERE EXISTS (
         SELECT 1 FROM teacher_rates r WHERE r.teacher_id = u.id AND r.subject_id = s.id
       )
     ) subj ON true
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

/** Lo saca de favoritos. Si no estaba, no pasa nada. */
export async function removeFavoriteTeacher(studentId, teacherId) {
  await getPool().query(
    `DELETE FROM favorite_teachers WHERE student_id = $1 AND teacher_id = $2`,
    [studentId, teacherId]
  );
}
