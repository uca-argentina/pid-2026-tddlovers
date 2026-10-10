import { getPool } from './pool.js';

// La revisión de docentes que hace el administrador. Las reglas de qué
// decisión se puede tomar en cada estado viven en lib/teacherApproval.js;
// acá solo se lee y se escribe.

// Lo que el admin necesita para decidir: quién es, cómo contactarlo y qué
// materias dice dar (con cuántas tarifas cargó). Fechas como timestamp ISO:
// son momentos, no días de calendario, y el front los muestra con Intl.
const TEACHER_REVIEW_COLUMNS = `
  u.id,
  u.email,
  u.nombre,
  u.apellido,
  u.telefono,
  u.approval_status AS "approvalStatus",
  u.approval_reviewed_at AS "reviewedAt",
  u.created_at AS "createdAt",
  COALESCE(
    (
      SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
      FROM teacher_subjects ts
      JOIN subjects s ON s.id = ts.subject_id
      WHERE ts.teacher_id = u.id
    ),
    '[]'::json
  ) AS subjects,
  (SELECT count(*)::int FROM teacher_rates r WHERE r.teacher_id = u.id) AS "ratesCount"
`;

/**
 * Los docentes para la pantalla del admin, opcionalmente de un solo estado.
 * Los más viejos primero: el que hace más tiempo que espera, arriba.
 */
export async function listTeachersForReview({ status } = {}) {
  const result = await getPool().query(
    `SELECT ${TEACHER_REVIEW_COLUMNS}
     FROM users u
     WHERE u.role = 'teacher'
       AND ($1::teacher_approval_status IS NULL OR u.approval_status = $1::teacher_approval_status)
     ORDER BY u.created_at, u.nombre, u.apellido`,
    [status ?? null]
  );
  return result.rows;
}

/** Un docente con sus datos de revisión, o null si no existe o no es docente. */
export async function findTeacherForReview(id) {
  const result = await getPool().query(
    `SELECT ${TEACHER_REVIEW_COLUMNS}
     FROM users u
     WHERE u.id = $1 AND u.role = 'teacher'`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Cambia el estado, pero solo si sigue en el que vio la ruta (`from`): si dos
 * admins deciden a la vez, el segundo no pisa al primero. Misma idea que
 * transitionClass en db/classes.js. true si se actualizó.
 */
export async function setTeacherApproval(id, { from, to, reviewedBy }) {
  const result = await getPool().query(
    `UPDATE users
     SET approval_status = $3::teacher_approval_status,
         approval_reviewed_at = now(),
         approval_reviewed_by = $4
     WHERE id = $1 AND role = 'teacher' AND approval_status = $2::teacher_approval_status`,
    [id, from, to, reviewedBy]
  );
  return result.rowCount > 0;
}
