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
  c.status
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
 * Todas las clases reservadas de un rango, de cualquiera. NO va a una ruta:
 * la usa la expansión de disponibilidad para restar los horarios ya tomados.
 * Devuelve lo mínimo, no datos de nadie.
 */
export async function findBookedSlots({ from, to }) {
  const result = await getPool().query(
    `SELECT teacher_id AS "teacherId",
            to_char(class_date, 'YYYY-MM-DD') AS date,
            to_char(start_time, 'HH24:MI') AS start,
            to_char(end_time, 'HH24:MI') AS "end"
     FROM classes
     WHERE status = 'reservada' AND class_date BETWEEN $1::date AND $2::date`,
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

/**
 * Reserva. Puede fallar por las restricciones de exclusión de la tabla: dos
 * alumnos pueden apretar el botón a la vez y validar antes no alcanza, así
 * que el error de la base se traduce y se muestra tal cual en el modal.
 */
export async function createClass({ teacherId, studentId, subjectId, date, startTime, endTime }) {
  try {
    const result = await getPool().query(
      `INSERT INTO classes (teacher_id, student_id, subject_id, class_date, start_time, end_time)
       VALUES ($1, $2, $3, $4::date, $5::time, $6::time)
       RETURNING id`,
      [teacherId, studentId, subjectId, date, startTime, endTime]
    );
    return { id: result.rows[0].id };
  } catch (err) {
    // 23P01 = exclusion_violation: alguien ya tiene ese horario.
    if (err.code === '23P01') {
      const mine = err.constraint === 'classes_student_no_overlap';
      return {
        conflict: mine
          ? 'Ya tenés una clase reservada en ese horario.'
          : 'Ese horario ya fue reservado por otra persona.',
      };
    }
    throw err;
  }
}
