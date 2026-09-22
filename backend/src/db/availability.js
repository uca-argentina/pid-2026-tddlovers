import { getPool } from './pool.js';

// La base guarda TIME ('13:00:00') y el front habla 'HH:MM'. Se recorta acá y
// no en la ruta para que ningún endpoint tenga que acordarse.
const TIME_FORMAT = `to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end"`;

/**
 * Toda la disponibilidad de un docente, agrupada por materia:
 *   { [subjectId]: { lunes: [{ start, end }], ... } }
 *
 * Es un solo pedido con TODAS las materias a propósito: la pantalla del
 * scheduler necesita las otras para pintar los horarios que ya están ocupados
 * (nadie da dos materias a la vez), y pedirlas de a una sería un N+1.
 */
export async function findAvailabilityByTeacher(teacherId) {
  const result = await getPool().query(
    `SELECT subject_id, day_key, ${TIME_FORMAT}
     FROM availability
     WHERE teacher_id = $1
     ORDER BY subject_id, day_key, start_time`,
    [teacherId]
  );

  const bySubject = {};
  for (const row of result.rows) {
    const subject = (bySubject[row.subject_id] ??= {});
    (subject[row.day_key] ??= []).push({ start: row.start, end: row.end });
  }
  return bySubject;
}

/**
 * Toda la disponibilidad publicada, con los nombres ya resueltos, lista para
 * proyectarse sobre fechas. Una entrada por (docente, materia) con su semana
 * adentro.
 *
 * Solo docentes que efectivamente dan esa materia (join con teacher_subjects):
 * si un docente se saca una materia del perfil pero le queda disponibilidad
 * vieja, no tiene que aparecer ofreciéndola.
 */
export async function findPublishedAvailability() {
  const result = await getPool().query(
    `SELECT av.teacher_id AS "teacherId",
            u.nombre || ' ' || u.apellido AS "teacherName",
            av.subject_id AS "subjectId",
            s.name AS "subjectName",
            av.day_key AS "dayKey",
            ${TIME_FORMAT}
     FROM availability av
     JOIN users u ON u.id = av.teacher_id
     JOIN subjects s ON s.id = av.subject_id
     JOIN teacher_subjects ts
       ON ts.teacher_id = av.teacher_id AND ts.subject_id = av.subject_id
     ORDER BY u.nombre, s.name, av.day_key, av.start_time`
  );

  const byPair = new Map();
  for (const row of result.rows) {
    const key = `${row.teacherId}|${row.subjectId}`;
    if (!byPair.has(key)) {
      byPair.set(key, {
        teacherId: row.teacherId,
        teacherName: row.teacherName,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        schedule: {},
      });
    }
    const entry = byPair.get(key);
    (entry.schedule[row.dayKey] ??= []).push({ start: row.start, end: row.end });
  }
  return [...byPair.values()];
}

/**
 * ¿Este docente ofrece esta materia en esta fecha y hora? Se usa antes de
 * reservar: el front solo ofrece turnos válidos, pero se puede saltear.
 */
export async function isWithinAvailability({ teacherId, subjectId, dayKey, startTime, endTime }) {
  const result = await getPool().query(
    `SELECT 1
     FROM availability
     WHERE teacher_id = $1 AND subject_id = $2 AND day_key = $3::week_day
       AND start_time <= $4::time AND end_time >= $5::time
     LIMIT 1`,
    [teacherId, subjectId, dayKey, startTime, endTime]
  );
  return result.rowCount > 0;
}

/**
 * Reemplaza la plantilla semanal de UNA materia de un docente. Es un
 * reemplazo completo y no un diff: la pantalla manda siempre la semana
 * entera, y así borrar un día es simplemente no mandarlo.
 *
 * En una transacción para que no quede una plantilla a medio guardar: si
 * falla un rango, la anterior sigue intacta.
 *
 * Ojo: esto NO toca las clases ya reservadas. Si el docente saca una hora que
 * alguien ya tenía tomada, esa clase sigue en pie — solo deja de ofrecerse
 * para el futuro.
 */
export async function replaceSubjectAvailability(teacherId, subjectId, schedule) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    await client.query(`DELETE FROM availability WHERE teacher_id = $1 AND subject_id = $2`, [
      teacherId,
      subjectId,
    ]);

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
        `INSERT INTO availability (teacher_id, subject_id, day_key, start_time, end_time)
         SELECT $1, $2, day_key::week_day, start_time::time, end_time::time
         FROM unnest($3::text[], $4::text[], $5::text[])
           AS t(day_key, start_time, end_time)`,
        [teacherId, subjectId, dayKeys, starts, ends]
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
