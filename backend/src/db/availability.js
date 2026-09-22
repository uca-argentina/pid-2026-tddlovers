import { getPool } from './pool.js';

// La base guarda TIME ('13:00:00') y el front habla 'HH:MM'. Se recorta acá y
// no en la ruta para que ningún endpoint tenga que acordarse.
const TIME_FORMAT = `to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end"`;

/**
 * La semana de un docente: { lunes: [{ start, end }], ... }. Una sola, sin
 * materia: el docente ofrece horarios y es el alumno el que elige para qué
 * materia reserva.
 */
export async function findAvailabilityByTeacher(teacherId) {
  const result = await getPool().query(
    `SELECT day_key, ${TIME_FORMAT}
     FROM availability
     WHERE teacher_id = $1
     ORDER BY day_key, start_time`,
    [teacherId]
  );

  const schedule = {};
  for (const row of result.rows) {
    (schedule[row.day_key] ??= []).push({ start: row.start, end: row.end });
  }
  return schedule;
}

/**
 * Toda la disponibilidad publicada, lista para proyectarse sobre fechas. Una
 * entrada por docente con su semana y las materias que da, que son entre las
 * que el alumno elige al reservar.
 *
 * Solo docentes con al menos una materia en el perfil: sin materias no hay
 * nada que reservarles.
 */
export async function findPublishedAvailability() {
  const result = await getPool().query(
    `SELECT av.teacher_id AS "teacherId",
            u.nombre || ' ' || u.apellido AS "teacherName",
            av.day_key AS "dayKey",
            ${TIME_FORMAT},
            subj.subjects
     FROM availability av
     JOIN users u ON u.id = av.teacher_id
     JOIN LATERAL (
       SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name) AS subjects
       FROM teacher_subjects ts
       JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = av.teacher_id
     ) subj ON subj.subjects IS NOT NULL
     ORDER BY u.nombre, u.apellido, av.day_key, av.start_time`
  );

  const byTeacher = new Map();
  for (const row of result.rows) {
    if (!byTeacher.has(row.teacherId)) {
      byTeacher.set(row.teacherId, {
        teacherId: row.teacherId,
        teacherName: row.teacherName,
        subjects: row.subjects,
        schedule: {},
      });
    }
    const entry = byTeacher.get(row.teacherId);
    (entry.schedule[row.dayKey] ??= []).push({ start: row.start, end: row.end });
  }
  return [...byTeacher.values()];
}

/**
 * ¿Este docente ofrece esa fecha y hora? Se usa antes de reservar: el front
 * solo ofrece turnos válidos, pero se puede saltear.
 */
export async function isWithinAvailability({ teacherId, dayKey, startTime, endTime }) {
  const result = await getPool().query(
    `SELECT 1
     FROM availability
     WHERE teacher_id = $1 AND day_key = $2::week_day
       AND start_time <= $3::time AND end_time >= $4::time
     LIMIT 1`,
    [teacherId, dayKey, startTime, endTime]
  );
  return result.rowCount > 0;
}

/**
 * Reemplaza la semana entera de un docente. Es un reemplazo completo y no un
 * diff: la pantalla manda siempre la semana entera, y así borrar un día es
 * simplemente no mandarlo.
 *
 * En una transacción para que no quede una plantilla a medio guardar: si
 * falla un rango, la anterior sigue intacta.
 *
 * Ojo: esto NO toca las clases ya reservadas. Si el docente saca una hora que
 * alguien ya tenía tomada, esa clase sigue en pie — solo deja de ofrecerse
 * para el futuro.
 */
export async function replaceTeacherAvailability(teacherId, schedule) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    await client.query(`DELETE FROM availability WHERE teacher_id = $1`, [teacherId]);

    const dayKeys = [];
    const starts = [];
    const ends = [];
    for (const [dayKey, ranges] of Object.entries(schedule)) {
      for (const range of ranges) {
        dayKeys.push(dayKey);
        starts.push(range.start);
        ends.push(range.end);
      }
    }

    if (dayKeys.length > 0) {
      // unnest en vez de un INSERT por rango: una sola ida a la base.
      await client.query(
        `INSERT INTO availability (teacher_id, day_key, start_time, end_time)
         SELECT $1, day_key::week_day, start_time::time, end_time::time
         FROM unnest($2::text[], $3::text[], $4::text[])
           AS t(day_key, start_time, end_time)`,
        [teacherId, dayKeys, starts, ends]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
