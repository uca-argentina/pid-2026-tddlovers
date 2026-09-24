import { getPool } from './pool.js';
import { toMinutes, toTime } from '../lib/availabilityExpansion.js';

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
  c.price,
  (
    -- Cuántos hay anotados en ese turno (una grupal son varias filas con el
    -- mismo docente, fecha e inicio). Un número y no nombres: el alumno ve
    -- cuánta gente va a haber, no quién.
    SELECT count(*)::int FROM classes o
    WHERE o.teacher_id = c.teacher_id AND o.class_date = c.class_date
      AND o.start_time = c.start_time AND o.status = 'reservada'
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
 * hora. Devuelve lo mínimo, no datos de nadie.
 */
export async function findTakenSlots({ from, to }) {
  const result = await getPool().query(
    `SELECT teacher_id AS "teacherId",
            to_char(class_date, 'YYYY-MM-DD') AS date,
            to_char(start_time, 'HH24:MI') AS start,
            to_char(end_time, 'HH24:MI') AS "end",
            subject_id AS "subjectId",
            count(*)::int AS enrolled
     FROM classes
     WHERE status = 'reservada' AND class_date BETWEEN $1::date AND $2::date
     GROUP BY teacher_id, class_date, start_time, end_time, subject_id`,
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
export async function hasOverlappingClass({ userId, role, date, startTime, endTime }) {
  const column = role === 'teacher' ? 'teacher_id' : 'student_id';
  const result = await getPool().query(
    `SELECT 1 FROM classes
     WHERE ${column} = $1 AND class_date = $2::date AND status = 'reservada'
       AND start_time < $4::time AND end_time > $3::time
     LIMIT 1`,
    [userId, date, startTime, endTime]
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
 * Reserva un turno de una ventana. Si ya hay una clase del docente a esa hora
 * es sumarse a ella (solo en una grupal, de la misma materia y con cupo); si
 * no, es arrancar una nueva con la duración de la ventana.
 *
 * El cupo no lo puede cuidar una restricción de la tabla (no cuenta filas),
 * así que todo va en una transacción con un lock por docente y fecha: dos
 * alumnos sumándose al último lugar a la vez no pueden pasar los dos.
 *
 * Los datos de la clase (modalidad, link, dirección, precio) se copian de la ventana:
 * si el docente la cambia después, lo que el alumno ya reservó no se mueve.
 *
 * Devuelve { id } o { conflict } con el mensaje para el alumno.
 */
export async function bookClass({ window, studentId, date, startTime }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('classes:' || $1 || $2))`, [
      window.teacherId,
      date,
    ]);

    const existing = await client.query(
      `SELECT to_char(end_time, 'HH24:MI') AS "end", subject_id AS "subjectId",
              count(*)::int AS enrolled
       FROM classes
       WHERE teacher_id = $1 AND class_date = $2::date AND start_time = $3::time
         AND status = 'reservada'
       GROUP BY end_time, subject_id`,
      [window.teacherId, date, startTime]
    );
    const group = existing.rows[0];

    let endTime;
    if (group) {
      if (window.maxStudents <= 1 || String(group.subjectId) !== String(window.subjectId)) {
        await client.query('ROLLBACK');
        return { conflict: TAKEN_BY_SOMEONE_ELSE };
      }
      if (group.enrolled >= window.maxStudents) {
        await client.query('ROLLBACK');
        return { conflict: 'La clase grupal ya se llenó.' };
      }
      // Se usa el fin de la clase ya armada y no el de la ventana: si el
      // docente cambió la duración, el grupo sigue siendo el mismo turno.
      endTime = group.end;
    } else {
      endTime = toTime(toMinutes(startTime) + window.durationMinutes);
      if (toMinutes(endTime) > toMinutes(window.end)) {
        await client.query('ROLLBACK');
        return { conflict: 'Ese horario no entra en la disponibilidad del docente.' };
      }
    }

    const result = await client.query(
      `INSERT INTO classes (
         teacher_id, student_id, subject_id, class_date, start_time, end_time,
         availability_id, modality, max_students, meeting_url, address, locality, price
       )
       VALUES ($1, $2, $3, $4::date, $5::time, $6::time, $7, $8::class_modality, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        window.teacherId,
        studentId,
        window.subjectId,
        date,
        startTime,
        endTime,
        window.id,
        window.modality,
        window.maxStudents,
        window.meetingUrl,
        window.address,
        window.locality,
        window.price,
      ]
    );

    await client.query('COMMIT');
    return { id: result.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    // 23P01 = exclusion_violation: alguien ya tiene ese horario.
    if (err.code === '23P01') {
      const mine = err.constraint === 'classes_student_no_overlap';
      return { conflict: mine ? 'Ya tenés una clase reservada en ese horario.' : TAKEN_BY_SOMEONE_ELSE };
    }
    throw err;
  } finally {
    client.release();
  }
}
