import { getPool } from './pool.js';

// La fila tal como la espera el front (ver PID-Front/CLAUDE.md): fechas
// 'YYYY-MM-DD' y horas 'HH:MM', sin zona horaria. Mandar un timestamp UTC
// correría el día para nuestros usuarios.
const CLASS_COLUMNS = `
  c.id,
  to_char(c.class_date, 'YYYY-MM-DD') AS date,
  to_char(c.start_time, 'HH24:MI') AS "startTime",
  to_char(c.end_time, 'HH24:MI') AS "endTime",
  c.subject_id AS "subjectId",
  s.name AS "subjectName",
  c.teacher_id AS "teacherId",
  t.nombre || ' ' || t.apellido AS "teacherName",
  c.student_id AS "studentId",
  a.nombre || ' ' || a.apellido AS "studentName",
  c.status,
  c.availability_id AS "availabilityId",
  c.modality,
  c.max_students AS "maxStudents",
  c.meeting_url AS "meetingUrl",
  c.address,
  c.locality,
  c.price_cents AS "priceCents",
  c.paid_at AS "paidAt",
  c.cancelled_by AS "cancelledBy",
  c.cancel_reason AS "cancelReason",
  c.rescheduled_from AS "rescheduledFrom",
  (
    -- Cuántos hay anotados en ese turno (una grupal son varias filas con el
    -- mismo docente, fecha e inicio). Un número y no nombres: el alumno ve
    -- cuánta gente va a haber, no quién.
    SELECT count(*)::int FROM classes o
    WHERE o.teacher_id = c.teacher_id AND o.class_date = c.class_date
      AND o.start_time = c.start_time AND o.status <> 'cancelada'
  ) AS enrolled
`;

const CLASS_JOINS = `
  FROM classes c
  JOIN subjects s ON s.id = c.subject_id
  JOIN users t ON t.id = c.teacher_id
  JOIN users a ON a.id = c.student_id
`;

/**
 * Las clases de UN usuario en un rango. Sirve para las dos pantallas: como
 * docente devuelve las que da, como alumno las que reservó, según el rol de
 * la sesión. Nadie ve la agenda de otro.
 */
export async function findClassesForUser({ userId, role, from, to, status }) {
  const ownerColumn = role === 'teacher' ? 'c.teacher_id' : 'c.student_id';
  const result = await getPool().query(
    `SELECT ${CLASS_COLUMNS}
     ${CLASS_JOINS}
     WHERE ${ownerColumn} = $1
       AND c.class_date BETWEEN $2::date AND $3::date
       AND ($4::text IS NULL OR c.status = $4::class_status)
     ORDER BY c.class_date, c.start_time`,
    [userId, from, to, status ?? null]
  );
  return result.rows;
}

/**
 * Los turnos ya tomados de un rango, de cualquier docente. NO va a una ruta:
 * la usa la expansión de disponibilidad para restar lo reservado. Una grupal
 * con tres alumnos es UN turno con enrolled 3 — el mismo docente, la misma
 * hora, la misma materia y duración. Devuelve lo mínimo, no datos de nadie:
 * el nombre de la materia hace falta para ofrecer sumarse a una grupal.
 */
export async function findTakenSlots({ from, to }) {
  const result = await getPool().query(
    `SELECT c.teacher_id AS "teacherId",
            to_char(c.class_date, 'YYYY-MM-DD') AS date,
            to_char(c.start_time, 'HH24:MI') AS start,
            to_char(c.end_time, 'HH24:MI') AS "end",
            c.subject_id AS "subjectId",
            s.name AS "subjectName",
            count(*)::int AS enrolled
     FROM classes c
     JOIN subjects s ON s.id = c.subject_id
     WHERE c.status <> 'cancelada' AND c.class_date BETWEEN $1::date AND $2::date
     GROUP BY c.teacher_id, c.class_date, c.start_time, c.end_time, c.subject_id, s.name`,
    [from, to]
  );
  return result.rows;
}

/**
 * ¿Este usuario ya tiene una clase que se pisa con ese horario? Se consulta
 * antes de reservar solo para poder dar un mensaje útil: cuando el alumno se
 * choca consigo mismo, la restricción que salta primero es la del docente y
 * el mensaje quedaría al revés ("lo reservó otra persona").
 *
 * No reemplaza a las restricciones de la tabla: entre este SELECT y el INSERT
 * puede entrar otra transacción. Son ellas las que deciden.
 */
export async function hasOverlappingClass({ userId, role, date, startTime, endTime, excludeId = null }) {
  const column = role === 'teacher' ? 'teacher_id' : 'student_id';
  // excludeId: al reprogramar, la clase vieja se va a cancelar en la misma
  // transacción, así que no cuenta como choque.
  const result = await getPool().query(
    `SELECT 1 FROM classes
     WHERE ${column} = $1 AND class_date = $2::date AND status <> 'cancelada'
       AND start_time < $4::time AND end_time > $3::time
       AND ($5::uuid IS NULL OR id <> $5::uuid)
     LIMIT 1`,
    [userId, date, startTime, endTime, excludeId]
  );
  return result.rowCount > 0;
}

export async function findClassById(id) {
  const result = await getPool().query(
    `SELECT ${CLASS_COLUMNS} ${CLASS_JOINS} WHERE c.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

const TAKEN_BY_SOMEONE_ELSE = 'Ese horario ya fue reservado por otra persona.';

/**
 * Reserva una clase en una ventana. El alumno eligió materia, inicio y
 * duración; si ya hay una clase del docente que arranca a esa hora, es
 * sumarse a ella, y eso solo se puede en una grupal, con cupo, y eligiendo la
 * MISMA materia y duración (es la misma clase, no otra a la misma hora).
 *
 * La restricción de exclusión de la tabla deja pasar dos filas del docente
 * con el mismo inicio aunque terminen distinto, y el cupo tampoco lo puede
 * cuidar (no cuenta filas): todo eso va en una transacción con un lock por
 * docente y fecha, así dos alumnos sumándose al último lugar a la vez no
 * pueden pasar los dos.
 *
 * Modalidad, link y dirección se copian de la ventana, y el precio es el que
 * calculó la ruta con la tarifa de ese momento: si el docente cambia algo
 * después, lo que el alumno ya reservó no se mueve.
 *
 * Devuelve { id } o { conflict } con el mensaje para el alumno.
 */
export async function bookClass(booking) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const created = await insertClass(client, booking);
    await client.query(created.conflict ? 'ROLLBACK' : 'COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    return overlapConflict(err);
  } finally {
    client.release();
  }
}

/**
 * Traduce una violación de las restricciones de exclusión al mensaje para el
 * alumno; cualquier otro error sigue de largo.
 */
function overlapConflict(err) {
  // 23P01 = exclusion_violation: alguien ya tiene ese horario.
  if (err.code === '23P01') {
    const mine = err.constraint === 'classes_student_no_overlap';
    return { conflict: mine ? 'Ya tenés una clase reservada en ese horario.' : TAKEN_BY_SOMEONE_ELSE };
  }
  throw err;
}

/**
 * El corazón de reservar, adentro de una transacción que abre quien llama:
 * así reprogramar puede cancelar la clase vieja y reservar la nueva de una
 * sola vez. Devuelve { id } o { conflict }; con conflict, quien llama hace
 * ROLLBACK.
 */
async function insertClass(
  client,
  { window, studentId, date, startTime, endTime, subjectId, priceCents, rescheduledFrom = null }
) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('classes:' || $1 || $2))`, [
    window.teacherId,
    date,
  ]);

  const existing = await client.query(
    `SELECT to_char(end_time, 'HH24:MI') AS "end", subject_id AS "subjectId",
            count(*)::int AS enrolled
     FROM classes
     WHERE teacher_id = $1 AND class_date = $2::date AND start_time = $3::time
       AND status <> 'cancelada'
     GROUP BY end_time, subject_id`,
    [window.teacherId, date, startTime]
  );
  const group = existing.rows[0];

  if (group) {
    if (window.maxStudents <= 1) return { conflict: TAKEN_BY_SOMEONE_ELSE };
    if (String(group.subjectId) !== String(subjectId) || group.end !== endTime) {
      return {
        conflict:
          'A esa hora ya hay una clase grupal de otra materia o duración. Sumate a esa o elegí otro horario.',
      };
    }
    if (group.enrolled >= window.maxStudents) return { conflict: 'La clase grupal ya se llenó.' };
  }

  const result = await client.query(
    `INSERT INTO classes (
       teacher_id, student_id, subject_id, class_date, start_time, end_time,
       availability_id, modality, max_students, meeting_url, address, locality, price_cents,
       rescheduled_from
     )
     VALUES ($1, $2, $3, $4::date, $5::time, $6::time, $7, $8::class_modality, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      window.teacherId,
      studentId,
      subjectId,
      date,
      startTime,
      endTime,
      window.id,
      window.modality,
      window.maxStudents,
      window.meetingUrl,
      window.address,
      window.locality,
      priceCents,
      rescheduledFrom,
    ]
  );
  return { id: result.rows[0].id };
}

/**
 * Las pendientes que llegaron a su hora sin que el docente respondiera pasan
 * a canceladas, como si el docente las hubiera cancelado justo al empezar.
 *
 * Sin cron: se llama antes de leer o tocar clases. Nadie mira una clase sin
 * pasar por ahí, así que da lo mismo que se actualice "tarde".
 */
export async function expireStartedPending({ iso, time }) {
  await getPool().query(
    `UPDATE classes
     SET status = 'cancelada', cancel_reason = 'vencida', cancelled_by = 'teacher',
         cancelled_at = now()
     WHERE status = 'pendiente'
       AND (class_date < $1::date OR (class_date = $1::date AND start_time <= $2::time))`,
    [iso, time]
  );
}

/**
 * Cambia el estado de una clase, pero solo si sigue en el estado en que la
 * vio la ruta (`from`): si en el medio el otro la canceló, no se pisa. true
 * si se actualizó.
 *
 * `paid` marca el pago, que va aparte del estado. `cancelledBy` y
 * `cancelReason` solo tienen sentido al pasar a cancelada.
 */
export async function transitionClass(id, { from, to, paid = false, cancelledBy = null, cancelReason = null }) {
  const result = await getPool().query(
    `UPDATE classes
     SET status = $3::class_status,
         paid_at = CASE WHEN $4 THEN now() ELSE paid_at END,
         cancelled_at = CASE WHEN $3::class_status = 'cancelada' THEN now() ELSE cancelled_at END,
         cancelled_by = COALESCE($5::user_role, cancelled_by),
         cancel_reason = COALESCE($6, cancel_reason)
     WHERE id = $1 AND status = $2::class_status AND (NOT $4 OR paid_at IS NULL)`,
    [id, from, to, paid, cancelledBy, cancelReason]
  );
  return result.rowCount > 0;
}

/**
 * Reprogramar: la clase vieja queda cancelada ("reprogramada") y se reserva
 * la nueva, todo en una transacción. Primero se cancela la vieja, así su
 * horario ya está libre si la nueva se pisa con ella (moverla media hora).
 *
 * Devuelve { id } de la nueva o { conflict }.
 */
export async function rescheduleClass(oldId, booking) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const cancelled = await client.query(
      `UPDATE classes
       SET status = 'cancelada', cancel_reason = 'reprogramada', cancelled_by = 'student',
           cancelled_at = now()
       WHERE id = $1 AND status = 'confirmada'`,
      [oldId]
    );
    if (cancelled.rowCount === 0) {
      await client.query('ROLLBACK');
      return { conflict: 'La clase cambió mientras la reprogramabas. Volvé a intentar.' };
    }

    const created = await insertClass(client, { ...booking, rescheduledFrom: oldId });
    await client.query(created.conflict ? 'ROLLBACK' : 'COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    return overlapConflict(err);
  } finally {
    client.release();
  }
}
