import { getPool } from './pool.js';

// Las tarifas por hora del docente, una por materia y modalidad. Se guardan
// junto con el perfil (ver updateUserProfile en db/users.js); acá solo se
// leen.
//
// Tablas: teacher_rates (migración 009; FK a teacher_subjects, así que sacar
// una materia del perfil borra sus tarifas). Sin locks.
// Lo usan: lib/publicUser.js, routes/classes (precio al reservar) y
// routes/teachers (validar la modalidad de una ventana).

/**
 * Todas las tarifas de un docente, ordenadas para que el perfil las muestre
 * siempre igual. Para un alumno da [].
 *
 * @param {string} teacherId - users.id del docente.
 * @returns {Promise<Array<{subjectId: string, modality: string, hourlyRateCents: number}>>}
 * Origen: teacher_rates.
 * Lo usa: lib/publicUser.js (toPublicUser, campo `rates`).
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
 *
 * @param {{teacherId: string, subjectId: string, modality: string}} args -
 *   docente y modalidad salen de la ventana (findWindowById); subjectId del body de la reserva.
 * @returns {Promise<number|null>} centavos por hora (0 = gratis) o null.
 * Origen: teacher_rates.
 * Lo usa: routes/classes/index.js (reservar y reprogramar).
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
 *
 * @param {string} teacherId - request.user.id (docente logueado).
 * @param {string} modality - 'virtual' | 'in_person' | 'hybrid', del body de la ventana ya validado.
 * @returns {Promise<boolean>}
 * Origen: teacher_rates.
 * Lo usa: routes/teachers/index.js (POST/PUT /me/availability).
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
