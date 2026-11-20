import { getPool } from './pool.js';

// Las clases (classes, migración 023): una fila por clase, con docente,
// materia, fecha, horario y lo copiado de la ventana en la primera reserva.
// Una grupal con varios alumnos es UNA clase. Lo de cada alumno (estado,
// pago...) está en class_bookings y se lee desde db/bookings.js; las
// reservas de una clase, con findClassBookings de ahí.
// Las clases se crean al reservar (insertBooking en db/bookings.js) y
// classes.active lo mantiene el trigger class_bookings_sync_active.
// Lo usan: routes/availability, routes/classes y routes/homework.

/**
 * Una clase por su id, sin sus reservas. No chequea dueño: eso lo hace quien
 * llama.
 *
 * @param {string} classId - classes.id: el `classId` de una reserva, o el de
 *   GET /api/homework/targets que el docente manda de vuelta.
 * @returns {Promise<{id, teacherId, subjectId, date, startTime, endTime,
 *   maxStudents, active}|null>}
 * Origen: classes.
 * Lo usan: routes/classes/index.js (loadOwnClass) y routes/homework/index.js
 *   (resolveTarget).
 */
export async function findClass(classId) {
  const result = await getPool().query(
    `SELECT id, teacher_id AS "teacherId", subject_id AS "subjectId",
            to_char(class_date, 'YYYY-MM-DD') AS date,
            to_char(start_time, 'HH24:MI') AS "startTime",
            to_char(end_time, 'HH24:MI') AS "endTime",
            max_students AS "maxStudents", active
     FROM classes WHERE id = $1`,
    [classId]
  );
  return result.rows[0] ?? null;
}

/**
 * Las clases en pie de un rango, de cualquier docente. NO va a una ruta:
 * la usa la expansión de disponibilidad para restar lo reservado y ofrecer
 * sumarse a las grupales. Una grupal con tres alumnos es UNA clase con
 * enrolled 3. Devuelve lo mínimo, no datos de nadie: el nombre de la materia
 * hace falta para ofrecer sumarse a una grupal.
 *
 * `maxStudents` y `modality` son los de la clase (copiados de la ventana en
 * la primera reserva, ver insertBooking en db/bookings.js): sumarse se mide
 * contra eso y no contra la ventana actual, que el docente pudo haber editado.
 *
 * @param {{from: string, to: string}} rango - query de GET /api/availability.
 * @returns {Promise<Array<{classId, teacherId, date, start, end, subjectId, subjectName,
 *   enrolled, maxStudents, modality}>>}
 * Origen: classes activas + subjects, con sus reservas no canceladas contadas.
 * Lo usa: routes/availability/index.js (se le pasa a bookableRows).
 */
export async function findActiveClasses({ from, to }) {
  // FILTRO: las clases canceladas para todos (active = false) no ocupan el
  // horario del docente.
  const result = await getPool().query(
    `SELECT c.id AS "classId",
            c.teacher_id AS "teacherId",
            to_char(c.class_date, 'YYYY-MM-DD') AS date,
            to_char(c.start_time, 'HH24:MI') AS start,
            to_char(c.end_time, 'HH24:MI') AS "end",
            c.subject_id AS "subjectId",
            s.name AS "subjectName",
            (SELECT count(*)::int FROM class_bookings b
             WHERE b.class_id = c.id AND b.status <> 'cancelada') AS enrolled,
            c.max_students AS "maxStudents",
            c.modality
     FROM classes c
     JOIN subjects s ON s.id = c.subject_id
     WHERE c.active AND c.class_date BETWEEN $1::date AND $2::date`,
    [from, to]
  );
  return result.rows;
}
