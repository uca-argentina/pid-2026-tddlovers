import { getPool } from './pool.js';

// Las vacaciones del docente (en pantalla, "Licencia"). Las reglas (qué
// rango vale, si un día cae adentro) viven en lib/vacations.js; acá se lee y
// se escribe.
//
// Tablas: teacher_vacations (migración 016, con exclusion constraint para que
// los rangos de un docente no se pisen); class_bookings (cancela las reservas del rango).
// Locks: 'vacations:' || teacherId EXCLUSIVO en createVacation; las reservas
// (db/bookings.js lockTeacherVacations) lo toman compartido.
// Lo usan: routes/teachers (/me/vacations), routes/availability
// (listVacationsInRange), routes/bookings y db/bookings.js (isTeacherOnVacation).

const VACATION_COLUMNS = `
  v.id,
  v.teacher_id AS "teacherId",
  to_char(v.start_date, 'YYYY-MM-DD') AS "startDate",
  to_char(v.end_date, 'YYYY-MM-DD') AS "endDate"
`;

// Las reservas que se caen si el docente se va de vacaciones esos días: las
// que siguen en pie y todavía no empezaron. Las que ya pasaron (o ya
// arrancaron hoy) quedan como están: el docente toma lista de esas.
// Va sobre `FROM class_bookings b JOIN classes c ON c.id = b.class_id`.
const CANCELLABLE = (teacher, from, to, nowIso, nowTime) => `
  c.teacher_id = ${teacher}
  AND c.class_date BETWEEN ${from}::date AND ${to}::date
  AND b.status IN ('pendiente', 'aceptada', 'confirmada')
  AND (c.class_date > ${nowIso}::date
       OR (c.class_date = ${nowIso}::date AND c.start_time > ${nowTime}::time))
`;

/**
 * Las vacaciones del docente que todavía no terminaron (las pasadas ya no
 * bloquean nada), en orden.
 *
 * @param {string} teacherId - request.user.id.
 * @param {{today: string}} opciones - todayIso() de lib/clock.js.
 * @returns {Promise<Array<{id, teacherId, startDate, endDate}>>} (VACATION_COLUMNS).
 * Origen: teacher_vacations.
 * Lo usa: routes/teachers/index.js (GET /me/vacations).
 */
export async function listTeacherVacations(teacherId, { today }) {
  // FILTRO: solo las del docente que no terminaron: las pasadas ya no se
  // pueden tocar y solo ensucian la lista.
  const result = await getPool().query(
    `SELECT ${VACATION_COLUMNS}
     FROM teacher_vacations v
     WHERE v.teacher_id = $1 AND v.end_date >= $2::date
     ORDER BY v.start_date`,
    [teacherId, today]
  );
  return result.rows;
}

/**
 * Las vacaciones de cualquier docente que tocan el rango. NO va a una ruta
 * tal cual: la usa el tablero del alumno para marcar las ventanas.
 *
 * @param {{from: string, to: string}} rango - query de GET /api/availability.
 * @returns {Promise<Array<{id, teacherId, startDate, endDate}>>}
 * Origen: teacher_vacations.
 * Lo usa: routes/availability/index.js (se le pasa a bookableRows).
 */
export async function listVacationsInRange({ from, to }) {
  // FILTRO: solo las que tocan el rango pedido (el tablero marca en gris esas fechas).
  const result = await getPool().query(
    `SELECT ${VACATION_COLUMNS}
     FROM teacher_vacations v
     WHERE v.start_date <= $2::date AND v.end_date >= $1::date`,
    [from, to]
  );
  return result.rows;
}

/**
 * ¿Está de vacaciones ese día? Para rechazar una reserva aunque la UI se
 * saltee. `client` deja usarla adentro de la transacción de una reserva, que
 * es donde el chequeo vale de verdad (ver createBooking en db/bookings.js).
 *
 * @param {string} teacherId - el docente de la ventana (findWindowById).
 * @param {string} date - 'YYYY-MM-DD' de la reserva (body.date).
 * @param {pg.Pool|pg.PoolClient} [client] - por defecto el pool.
 * @returns {Promise<boolean>}
 * Origen: teacher_vacations.
 * Lo usan: routes/bookings/index.js (checkWindowSlot) y db/bookings.js (insertBooking).
 */
export async function isTeacherOnVacation(teacherId, date, client = getPool()) {
  const result = await client.query(
    `SELECT 1 FROM teacher_vacations
     WHERE teacher_id = $1 AND $2::date BETWEEN start_date AND end_date
     LIMIT 1`,
    [teacherId, date]
  );
  return result.rowCount > 0;
}

/**
 * Cuántas reservas se cancelarían con esas vacaciones, para avisarle al
 * docente antes de guardar.
 *
 * @param {string} teacherId - request.user.id.
 * @param {{startDate: string, endDate: string}} rango - query de
 *   GET /api/teachers/me/vacations/impact, validado por VacationRange.validate.
 * @param {{iso: string, time: string}} ahora - now() de lib/clock.js.
 * @returns {Promise<number>}
 * Origen: class_bookings + classes (CANCELLABLE).
 * Lo usa: routes/teachers/index.js.
 */
export async function countClassesToCancel(teacherId, { startDate, endDate }, { iso, time }) {
  const result = await getPool().query(
    `SELECT count(*)::int AS count
     FROM class_bookings b JOIN classes c ON c.id = b.class_id
     WHERE ${CANCELLABLE('$1', '$2', '$3', '$4', '$5')}`,
    [teacherId, startDate, endDate, iso, time]
  );
  return result.rows[0].count;
}

/**
 * Guarda las vacaciones y cancela las reservas de esos días, todo en una
 * transacción: o quedan las dos cosas, o ninguna. Con un lock por docente,
 * para que dos pestañas guardando a la vez no carguen dos rangos que se
 * pisan (la exclusión de la tabla también lo frena, pero con un error que no
 * se le puede mostrar a nadie).
 *
 * Devuelve { vacation, cancelled } o { conflict } con el rango que se pisa.
 *
 * @param {string} teacherId - request.user.id.
 * @param {{startDate: string, endDate: string}} rango - body de
 *   POST /api/teachers/me/vacations, validado por VacationRange.validate.
 * @param {{iso: string, time: string}} ahora - now() de lib/clock.js.
 * @returns {Promise<{vacation: {id, teacherId, startDate, endDate}, cancelled: number}
 *   | {conflict: {id, teacherId, startDate, endDate}}>}
 * Origen: INSERT en teacher_vacations; UPDATE class_bookings (cancel_reason 'vacaciones').
 * Lo usa: routes/teachers/index.js.
 * Locks/transacción: transacción propia; 'vacations:' || teacherId exclusivo.
 */
export async function createVacation(teacherId, { startDate, endDate }, { iso, time }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Exclusivo: las reservas toman este mismo lock compartido (db/bookings.js
    // lockTeacherVacations), así ninguna queda viva en un día de licencia.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('vacations:' || $1))`, [teacherId]);

    const overlap = await client.query(
      `SELECT ${VACATION_COLUMNS}
       FROM teacher_vacations v
       WHERE v.teacher_id = $1 AND v.start_date <= $3::date AND v.end_date >= $2::date
       ORDER BY v.start_date
       LIMIT 1`,
      [teacherId, startDate, endDate]
    );
    if (overlap.rows[0]) {
      await client.query('ROLLBACK');
      return { conflict: overlap.rows[0] };
    }

    const inserted = await client.query(
      `INSERT INTO teacher_vacations (teacher_id, start_date, end_date)
       VALUES ($1, $2::date, $3::date)
       RETURNING id`,
      [teacherId, startDate, endDate]
    );

    // Como si el docente las hubiera cancelado una por una, pero con el
    // motivo a la vista. Las clases con paquete devuelven sus clases solas:
    // lo que queda del paquete se cuenta sin las canceladas.
    const cancelled = await client.query(
      `UPDATE class_bookings
       SET status = 'cancelada', cancel_reason = 'vacaciones', cancelled_by = 'teacher',
           cancelled_at = now()
       WHERE id IN (
         SELECT b.id FROM class_bookings b JOIN classes c ON c.id = b.class_id
         WHERE ${CANCELLABLE('$1', '$2', '$3', '$4', '$5')}
       )`,
      [teacherId, startDate, endDate, iso, time]
    );

    const vacation = await client.query(
      `SELECT ${VACATION_COLUMNS} FROM teacher_vacations v WHERE v.id = $1`,
      [inserted.rows[0].id]
    );

    await client.query('COMMIT');
    return { vacation: vacation.rows[0], cancelled: cancelled.rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Borra un rango de vacaciones. true si se borró. Las reservas que se
 * cancelaron al cargarlas NO vuelven: los alumnos ya se enteraron y pudieron
 * reservar otra cosa.
 *
 * @param {string} teacherId - request.user.id.
 * @param {string} id - params.id de DELETE /api/teachers/me/vacations/:id.
 * @returns {Promise<boolean>}
 * Origen: DELETE en teacher_vacations.
 * Lo usa: routes/teachers/index.js.
 */
export async function deleteVacation(teacherId, id) {
  const result = await getPool().query(
    `DELETE FROM teacher_vacations WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  );
  return result.rowCount > 0;
}
