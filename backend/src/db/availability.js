import { getPool } from './pool.js';

// La ventana tal como la espera el front: fecha 'YYYY-MM-DD' y horas 'HH:MM'.
// Se recorta acá y no en la ruta para que ningún endpoint tenga que acordarse.
const WINDOW_COLUMNS = `
  av.id,
  av.teacher_id AS "teacherId",
  to_char(av.start_date, 'YYYY-MM-DD') AS date,
  av.repeats_weekly AS "repeatsWeekly",
  to_char(av.start_time, 'HH24:MI') AS start,
  to_char(av.end_time, 'HH24:MI') AS "end",
  av.subject_id AS "subjectId",
  s.name AS "subjectName",
  av.duration_minutes AS "durationMinutes",
  av.price,
  av.modality,
  av.max_students AS "maxStudents",
  av.meeting_url AS "meetingUrl",
  av.locality,
  av.address
`;

// ¿Cae alguna vez en [$from, $to]? Una suelta, si su fecha está adentro; una
// semanal, si arrancó antes del final. Puede que igual no caiga (una semanal
// de los lunes en un rango miércoles–jueves): eso lo termina de decidir
// occursOn en JS, esto solo evita traer ventanas que seguro no van.
const OCCURS_IN_RANGE = (from, to) => `
  (
    (NOT av.repeats_weekly AND av.start_date BETWEEN ${from}::date AND ${to}::date)
    OR (av.repeats_weekly AND av.start_date <= ${to}::date)
  )
`;

/**
 * Las ventanas del docente que caen en el rango, sin expandir: la pantalla del
 * docente necesita la ventana entera (id, si se repite, su fecha original)
 * para poder editarla.
 */
export async function findTeacherWindows({ teacherId, from, to }) {
  const result = await getPool().query(
    `SELECT ${WINDOW_COLUMNS}
     FROM availability av
     JOIN subjects s ON s.id = av.subject_id
     WHERE av.teacher_id = $1 AND ${OCCURS_IN_RANGE('$2', '$3')}
     ORDER BY av.start_time, av.start_date`,
    [teacherId, from, to]
  );
  return result.rows;
}

/**
 * Lo que se ofrece a los alumnos en el rango. Solo ventanas de materias que el
 * docente sigue dando: si la sacó del perfil, la ventana queda guardada pero
 * no se ofrece (la pantalla del docente se lo avisa).
 */
export async function findPublishedWindows({ from, to }) {
  const result = await getPool().query(
    `SELECT ${WINDOW_COLUMNS},
            u.nombre || ' ' || u.apellido AS "teacherName"
     FROM availability av
     JOIN subjects s ON s.id = av.subject_id
     JOIN users u ON u.id = av.teacher_id
     JOIN teacher_subjects ts
       ON ts.teacher_id = av.teacher_id AND ts.subject_id = av.subject_id
     WHERE ${OCCURS_IN_RANGE('$1', '$2')}
     ORDER BY av.start_time, u.nombre, u.apellido`,
    [from, to]
  );
  return result.rows;
}

/** Una ventana con el nombre del docente, o null. Para reservar. */
export async function findWindowById(id) {
  const result = await getPool().query(
    `SELECT ${WINDOW_COLUMNS},
            u.nombre || ' ' || u.apellido AS "teacherName"
     FROM availability av
     JOIN subjects s ON s.id = av.subject_id
     JOIN users u ON u.id = av.teacher_id
     WHERE av.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * La primera ventana del docente que se pisa con esta en ALGUNA fecha. Con la
 * repetición semanal eso depende de qué se repite:
 *   - las dos semanales del mismo día de la semana: se cruzan tarde o temprano;
 *   - una semanal y una suelta: si la suelta cae después de que arranque la
 *     semanal;
 *   - las dos sueltas: si son el mismo día.
 * Tocarse en el borde NO es pisarse: 13:00-14:00 y 14:00-15:00 conviven.
 */
async function findOverlappingWindow(client, teacherId, window, excludeId) {
  const result = await client.query(
    `SELECT to_char(start_time, 'HH24:MI') AS start,
            to_char(end_time, 'HH24:MI') AS "end",
            repeats_weekly AS "repeatsWeekly"
     FROM availability
     WHERE teacher_id = $1
       AND ($2::uuid IS NULL OR id <> $2::uuid)
       AND EXTRACT(ISODOW FROM start_date) = EXTRACT(ISODOW FROM $3::date)
       AND start_time < $6::time AND end_time > $5::time
       AND CASE
         WHEN repeats_weekly AND $4::boolean THEN true
         WHEN repeats_weekly THEN start_date <= $3::date
         WHEN $4::boolean THEN start_date >= $3::date
         ELSE start_date = $3::date
       END
     LIMIT 1`,
    [teacherId, excludeId, window.date, window.repeatsWeekly, window.start, window.end]
  );
  return result.rows[0] ?? null;
}

function overlapMessage(other) {
  const semanal = other.repeatsWeekly ? ', que se repite todas las semanas' : '';
  return `Se pisa con otra clase tuya de ${other.start} a ${other.end}${semanal}.`;
}

/**
 * Corre `work` en una transacción con el docente bloqueado: dos pestañas
 * guardando a la vez podrían pasar las dos el chequeo de superposición antes
 * de que cualquiera inserte. El lock es por docente y se suelta solo al
 * terminar la transacción.
 */
async function withTeacherLock(teacherId, work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('availability:' || $1))`, [
      teacherId,
    ]);
    const result = await work(client);
    await client.query(result?.conflict || result === null ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function selectWindow(client, id) {
  const result = await client.query(
    `SELECT ${WINDOW_COLUMNS}
     FROM availability av
     JOIN subjects s ON s.id = av.subject_id
     WHERE av.id = $1`,
    [id]
  );
  return result.rows[0];
}

const WINDOW_VALUES = (w) => [
  w.date,
  w.repeatsWeekly,
  w.start,
  w.end,
  w.subjectId,
  w.durationMinutes,
  w.price,
  w.modality,
  w.maxStudents,
  w.meetingUrl,
  w.address,
  w.locality,
];

/** { window } o { conflict } con el mensaje para el docente. */
export async function createWindow(teacherId, window) {
  return withTeacherLock(teacherId, async (client) => {
    const other = await findOverlappingWindow(client, teacherId, window, null);
    if (other) return { conflict: overlapMessage(other) };

    const result = await client.query(
      `INSERT INTO availability (
         teacher_id, start_date, repeats_weekly, start_time, end_time, subject_id,
         duration_minutes, price, modality, max_students, meeting_url, address, locality
       )
       VALUES ($1, $2::date, $3, $4::time, $5::time, $6, $7, $8, $9::class_modality, $10, $11, $12, $13)
       RETURNING id`,
      [teacherId, ...WINDOW_VALUES(window)]
    );
    return { window: await selectWindow(client, result.rows[0].id) };
  });
}

/**
 * { window }, { conflict }, o null si no existe o no es de este docente — las
 * dos cosas se contestan igual, para no confirmar ids ajenos.
 *
 * Ojo: esto NO toca las clases ya reservadas. Si el docente achica o cambia
 * una ventana que alguien ya tenía tomada, esa clase sigue en pie con lo que
 * se copió al reservarla.
 */
export async function updateWindow(teacherId, id, window) {
  return withTeacherLock(teacherId, async (client) => {
    const exists = await client.query(
      `SELECT 1 FROM availability WHERE id = $1 AND teacher_id = $2`,
      [id, teacherId]
    );
    if (exists.rowCount === 0) return null;

    const other = await findOverlappingWindow(client, teacherId, window, id);
    if (other) return { conflict: overlapMessage(other) };

    await client.query(
      `UPDATE availability SET
         start_date = $3::date, repeats_weekly = $4, start_time = $5::time, end_time = $6::time,
         subject_id = $7, duration_minutes = $8, price = $9, modality = $10::class_modality,
         max_students = $11, meeting_url = $12, address = $13, locality = $14
       WHERE id = $1 AND teacher_id = $2`,
      [id, teacherId, ...WINDOW_VALUES(window)]
    );
    return { window: await selectWindow(client, id) };
  });
}

/** true si se borró. Las clases ya reservadas quedan (ver updateWindow). */
export async function deleteWindow(teacherId, id) {
  const result = await getPool().query(
    `DELETE FROM availability WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  );
  return result.rowCount > 0;
}
