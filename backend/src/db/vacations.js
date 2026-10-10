import { getPool } from './pool.js';

// Las vacaciones del docente. Las reglas (qué rango vale, si un día cae
// adentro) viven en lib/vacations.js; acá se lee y se escribe.

const VACATION_COLUMNS = `
  v.id,
  v.teacher_id AS "teacherId",
  to_char(v.start_date, 'YYYY-MM-DD') AS "startDate",
  to_char(v.end_date, 'YYYY-MM-DD') AS "endDate"
`;

// Las reservas que se caen si el docente se va de vacaciones esos días: las
// que siguen en pie y todavía no empezaron. Las que ya pasaron (o ya
// arrancaron hoy) quedan como están: el docente toma lista de esas.
const CANCELLABLE = (teacher, from, to, nowIso, nowTime) => `
  teacher_id = ${teacher}
  AND class_date BETWEEN ${from}::date AND ${to}::date
  AND status IN ('pendiente', 'aceptada', 'confirmada')
  AND (class_date > ${nowIso}::date OR (class_date = ${nowIso}::date AND start_time > ${nowTime}::time))
`;

/**
 * Las vacaciones del docente que todavía no terminaron (las pasadas ya no
 * bloquean nada), en orden.
 */
export async function listTeacherVacations(teacherId, { today }) {
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
 */
export async function listVacationsInRange({ from, to }) {
  const result = await getPool().query(
    `SELECT ${VACATION_COLUMNS}
     FROM teacher_vacations v
     WHERE v.start_date <= $2::date AND v.end_date >= $1::date`,
    [from, to]
  );
  return result.rows;
}

/** ¿Está de vacaciones ese día? Para rechazar una reserva aunque la UI se saltee. */
export async function isTeacherOnVacation(teacherId, date) {
  const result = await getPool().query(
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
 */
export async function countClassesToCancel(teacherId, { startDate, endDate }, { iso, time }) {
  const result = await getPool().query(
    `SELECT count(*)::int AS count FROM classes
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
 */
export async function createVacation(teacherId, { startDate, endDate }, { iso, time }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
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
      `UPDATE classes
       SET status = 'cancelada', cancel_reason = 'vacaciones', cancelled_by = 'teacher',
           cancelled_at = now()
       WHERE ${CANCELLABLE('$1', '$2', '$3', '$4', '$5')}`,
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
 * true si se borró. Las reservas que se cancelaron al cargarlas NO vuelven:
 * los alumnos ya se enteraron y pudieron reservar otra cosa.
 */
export async function deleteVacation(teacherId, id) {
  const result = await getPool().query(
    `DELETE FROM teacher_vacations WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  );
  return result.rowCount > 0;
}
