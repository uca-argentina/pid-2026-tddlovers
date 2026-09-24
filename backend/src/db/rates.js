import { getPool } from './pool.js';

// Las tarifas por hora del docente, una por materia y modalidad. Se guardan
// junto con el perfil (ver updateUserProfile en db/users.js); acá solo se
// leen.

/**
 * Todas las tarifas de un docente, ordenadas para que el perfil las muestre
 * siempre igual. Para un alumno da [].
 */
export async function findRatesByTeacher(teacherId) {
  const result = await getPool().query(
    `SELECT subject_id AS "subjectId", modality, hourly_rate_cents AS "hourlyRateCents"
     FROM teacher_rates
     WHERE teacher_id = $1
     ORDER BY subject_id, modality`,
    [teacherId]
  );
  return result.rows;
}

/**
 * La tarifa por hora (en centavos) de esa materia en esa modalidad, o null si
 * el docente no la da así. Es lo que ata la materia que elige el alumno al
 * docente: sin tarifa, esa clase no se ofrece.
 */
export async function findRate({ teacherId, subjectId, modality }) {
  const result = await getPool().query(
    `SELECT hourly_rate_cents AS "hourlyRateCents"
     FROM teacher_rates
     WHERE teacher_id = $1 AND subject_id = $2 AND modality = $3::class_modality`,
    [teacherId, subjectId, modality]
  );
  return result.rows[0]?.hourlyRateCents ?? null;
}

/**
 * ¿Tiene alguna tarifa en esa modalidad? Una ventana presencial de un docente
 * que no tiene ninguna materia tarifada como presencial no le serviría a
 * nadie: no se deja guardar.
 */
export async function teacherHasRateFor(teacherId, modality) {
  const result = await getPool().query(
    `SELECT 1 FROM teacher_rates
     WHERE teacher_id = $1 AND modality = $2::class_modality
     LIMIT 1`,
    [teacherId, modality]
  );
  return result.rowCount > 0;
}
