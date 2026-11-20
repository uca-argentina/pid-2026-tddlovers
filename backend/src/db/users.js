import { getPool } from './pool.js';
import { hasRateInModality, ratedSubjectsJson } from './rates.js';

// Usuarios: alta, perfil (con materias y tarifas del docente) y buscador.
// Tablas: users (migración 001; nombre/apellido/telefono de 002,
// approval_status de 012, accepts_neurona_rewards de 021), teacher_subjects
// y subjects (002), teacher_rates (009). Sin advisory locks; createUser y
// updateUserProfile abren su propia transacción.
// Lo usan: routes/auth, routes/users, routes/teachers y lib/publicUser.js.

// Las columnas que necesita lib/publicUser.js (toPublicUser), en snake_case.
const PROFILE_COLUMNS =
  'id, email, role, nombre, apellido, telefono, approval_status, accepts_neurona_rewards, created_at';

/**
 * Crea un usuario (alumno o docente). Un docente nace con approval_status
 * 'pending'. Para los docentes, subjectIds vincula el usuario nuevo con el
 * catálogo de materias en la misma transacción que el insert: así una falla a
 * medio camino nunca deja un docente sin materias ni una referencia colgada.
 *
 * @param {object} datos - del body de POST /api/auth/register, ya validado:
 *   email (en minúsculas), passwordHash (argon2id de lib/password.js),
 *   role ('teacher' | 'student'), nombre, apellido, telefono (o null) y
 *   subjectIds (solo docentes; ids que existen).
 * @returns {Promise<object>} la fila con PROFILE_COLUMNS (snake_case).
 * Origen: INSERT en users y teacher_subjects.
 * Lo usa: routes/auth/index.js (POST /register).
 * Locks/transacción: transacción propia (BEGIN/COMMIT).
 */
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

    // Todo docente nace pendiente: no aparece en búsquedas ni recibe
    // reservas hasta que un admin lo apruebe (ver lib/teacherApproval.js).
    const result = await client.query(
      `INSERT INTO users (email, password_hash, role, nombre, apellido, telefono, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $3::user_role = 'teacher' THEN 'pending'::teacher_approval_status END)
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

/**
 * Las materias de un docente, como array de ids. Para un alumno da [] — no
 * tiene filas en teacher_subjects. Se devuelve en TODAS las respuestas que
 * llevan un usuario, así el front siempre recibe la misma forma.
 *
 * @param {string} teacherId - users.id.
 * @returns {Promise<string[]>} subject ids.
 * Origen: teacher_subjects.
 * Lo usan: lib/publicUser.js (campo `subjectIds`) y routes/users/index.js
 *   (validar tarifas contra las materias actuales en PATCH /me).
 */
export async function findSubjectIdsByTeacher(teacherId) {
  const result = await getPool().query(
    `SELECT subject_id FROM teacher_subjects WHERE teacher_id = $1`,
    [teacherId]
  );
  return result.rows.map((row) => row.subject_id);
}

/**
 * Los docentes para el buscador, con las materias que ofrecen. Una materia
 * cuenta si el docente le puso tarifa en alguna modalidad (ratedSubjectsJson
 * de db/rates.js, el mismo fragmento que favoritos). Solo nombre y materias —
 * el buscador no tiene por qué ver el mail ni el teléfono de nadie.
 *
 * @param {{today: string}} args - today = now().iso de lib/clock.js.
 * @returns {Promise<Array<{id, nombre, apellido, subjects: Array<{id, name}>}>>}
 * Origen: users JOIN subjects filtradas por teacher_rates; availability para
 *   saber si tiene algo publicado.
 * Lo usa: routes/teachers/index.js (GET /api/teachers).
 */
export async function listTeachers({ today }) {
  // FILTRO: el buscador no sugiere a nadie a quien no se le pueda reservar
  // nada. Solo docentes aprobados (ver TeacherApproval.canReceiveBookings),
  // con alguna materia tarifada (JOIN LATERAL ... IS NOT NULL) y con al menos
  // una ventana publicable que no haya terminado: semanal, o suelta desde hoy
  // ($1, hora argentina), en una modalidad con tarifa (el mismo
  // hasRateInModality que findPublishedWindows).
  const result = await getPool().query(
    `SELECT u.id, u.nombre, u.apellido, subj.subjects
     FROM users u
     JOIN LATERAL (${ratedSubjectsJson('u.id')}) subj ON subj.subjects IS NOT NULL
     WHERE u.role = 'teacher' AND u.approval_status = 'approved'
       AND EXISTS (
         SELECT 1 FROM availability av
         WHERE av.teacher_id = u.id
           AND (av.repeats_weekly OR av.start_date >= $1::date)
           AND ${hasRateInModality('av.teacher_id', 'av.modality')}
       )
     ORDER BY u.nombre, u.apellido`,
    [today]
  );
  return result.rows;
}

/**
 * Actualiza el perfil y, si es docente, reemplaza sus materias y sus tarifas
 * por las que llegan. Todo en una transacción: si falla una tarifa, ni el
 * teléfono ni las materias se guardan, y nunca queda un docente a medio
 * actualizar.
 *
 * `subjectIds` y `rates` se ignoran para los alumnos: el registro tampoco les
 * pide materias. Cualquiera de los dos puede venir undefined = no se toca.
 *
 * `approvalStatus` es el estado en que queda el docente después de editar
 * (lo decide TeacherApproval.afterProfileEdit en la ruta); undefined = no se
 * toca.
 *
 * @param {string} userId - request.user.id.
 * @param {object} cambios - del body de PATCH /api/users/me ya validado:
 *   telefono (string o null), subjectIds (string[]), rates
 *   ([{subjectId, modality, hourlyRateCents}] de validateRates), approvalStatus.
 * @returns {Promise<object|null>} la fila con PROFILE_COLUMNS, o null si el usuario no existe.
 * Origen: UPDATE users; reemplaza teacher_subjects y teacher_rates.
 * Lo usa: routes/users/index.js (PATCH /me).
 * Locks/transacción: transacción propia (BEGIN/COMMIT).
 */
export async function updateUserProfile(userId, { telefono, subjectIds, rates, approvalStatus }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE users
       SET telefono = $2,
           approval_status = COALESCE($3::teacher_approval_status, approval_status)
       WHERE id = $1
       RETURNING ${PROFILE_COLUMNS}`,
      [userId, telefono ?? null, approvalStatus ?? null]
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

/**
 * Guarda si el docente acepta canjes de neuronas. Lo ya reservado no cambia.
 *
 * @param {string} teacherId - request.user.id del docente.
 * @param {boolean} accepts - body.accepts de PUT /api/teachers/me/accepts-rewards.
 * @returns {Promise<void>}
 * Origen: UPDATE users.accepts_neurona_rewards (migración 021).
 * Lo usa: routes/teachers/index.js.
 */
export async function setAcceptsRewards(teacherId, accepts) {
  await getPool().query(`UPDATE users SET accepts_neurona_rewards = $2 WHERE id = $1`, [
    teacherId,
    accepts,
  ]);
}

/**
 * Busca un usuario por email, incluyendo el hash de la contraseña.
 *
 * @param {string} email - ya pasado a minúsculas por la ruta.
 * @returns {Promise<object|null>} fila snake_case (PROFILE_COLUMNS + password_hash).
 * Origen: users.
 * Lo usa: routes/auth/index.js (POST /register para ver si ya existe, POST /login).
 */
export async function findUserByEmail(email) {
  const result = await getPool().query(
    `SELECT id, email, password_hash, role, nombre, apellido, telefono, approval_status,
            accepts_neurona_rewards, created_at
     FROM users
     WHERE email = $1`,
    [email]
  );
  return result.rows[0] ?? null;
}

/**
 * Busca un usuario por id (sin el hash).
 *
 * @param {string} id - request.user.id (sale de la sesión).
 * @returns {Promise<object|null>} fila con PROFILE_COLUMNS.
 * Origen: users.
 * Lo usa: routes/auth/index.js (GET /me).
 */
export async function findUserById(id) {
  const result = await getPool().query(
    `SELECT ${PROFILE_COLUMNS}
     FROM users
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}
