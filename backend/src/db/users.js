import { getPool } from './pool.js';

const PROFILE_COLUMNS = 'id, email, role, nombre, apellido, telefono, created_at';

// Para los docentes, subjectIds vincula el usuario nuevo con el catálogo de
// materias en la misma transacción que el insert: así una falla a medio camino
// nunca deja un docente sin materias ni una referencia colgada.
export async function createUser({
  email,
  passwordHash,
  role,
  nombre,
  apellido,
  telefono,
  subjectIds = [],
}) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO users (email, password_hash, role, nombre, apellido, telefono)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${PROFILE_COLUMNS}`,
      [email, passwordHash, role, nombre, apellido, telefono ?? null]
    );
    const user = result.rows[0];

    if (role === 'teacher' && subjectIds.length > 0) {
      await client.query(
        `INSERT INTO teacher_subjects (teacher_id, subject_id)
         SELECT $1, subject_id
         FROM unnest($2::uuid[]) AS subject_id`,
        [user.id, subjectIds]
      );
    }

    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Las materias de un docente, como array de ids. Para un alumno da [] — no
// tiene filas en teacher_subjects. Se devuelve en TODAS las respuestas que
// llevan un usuario, así el front siempre recibe la misma forma.
export async function findSubjectIdsByTeacher(teacherId) {
  const result = await getPool().query(
    `SELECT subject_id FROM teacher_subjects WHERE teacher_id = $1`,
    [teacherId]
  );
  return result.rows.map((row) => row.subject_id);
}

/**
 * Actualiza el perfil y, si es docente, reemplaza sus materias y sus tarifas
 * por las que llegan. Todo en una transacción: si falla una tarifa, ni el
 * teléfono ni las materias se guardan, y nunca queda un docente a medio
 * actualizar.
 *
 * `subjectIds` y `rates` se ignoran para los alumnos: el registro tampoco les
 * pide materias. Cualquiera de los dos puede venir undefined = no se toca.
 */
export async function updateUserProfile(userId, { telefono, subjectIds, rates }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE users SET telefono = $2 WHERE id = $1 RETURNING ${PROFILE_COLUMNS}`,
      [userId, telefono ?? null]
    );
    const user = result.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return null;
    }

    if (user.role === 'teacher' && Array.isArray(subjectIds)) {
      // Reemplazo completo: se borra lo que ya no está y se agrega lo nuevo.
      await client.query(
        `DELETE FROM teacher_subjects
         WHERE teacher_id = $1 AND NOT (subject_id = ANY($2::uuid[]))`,
        [userId, subjectIds]
      );
      if (subjectIds.length > 0) {
        await client.query(
          `INSERT INTO teacher_subjects (teacher_id, subject_id)
           SELECT $1, subject_id
           FROM unnest($2::uuid[]) AS subject_id
           ON CONFLICT DO NOTHING`,
          [userId, subjectIds]
        );
      }
    }

    // Después de las materias: sacar una materia ya se llevó sus tarifas
    // (FK con cascada), y las nuevas solo pueden ser de materias que quedan.
    if (user.role === 'teacher' && Array.isArray(rates)) {
      await client.query(`DELETE FROM teacher_rates WHERE teacher_id = $1`, [userId]);
      if (rates.length > 0) {
        await client.query(
          `INSERT INTO teacher_rates (teacher_id, subject_id, modality, hourly_rate_cents)
           SELECT $1, r.subject_id, r.modality, r.cents
           FROM unnest($2::uuid[], $3::class_modality[], $4::int[])
             AS r(subject_id, modality, cents)`,
          [
            userId,
            rates.map((rate) => rate.subjectId),
            rates.map((rate) => rate.modality),
            rates.map((rate) => rate.hourlyRateCents),
          ]
        );
      }
    }

    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findUserByEmail(email) {
  const result = await getPool().query(
    `SELECT id, email, password_hash, role, nombre, apellido, telefono, created_at
     FROM users
     WHERE email = $1`,
    [email]
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id) {
  const result = await getPool().query(
    `SELECT ${PROFILE_COLUMNS}
     FROM users
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function emailExists(email) {
  const result = await getPool().query(`SELECT 1 FROM users WHERE email = $1`, [email]);
  return result.rowCount > 0;
}
