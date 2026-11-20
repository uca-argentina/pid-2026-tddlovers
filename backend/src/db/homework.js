import { getPool } from './pool.js';
import { creditCorrection, removeHomeworkOnTimeCredit } from './neuronas.js';

// Las tareas, sus entregas y los mensajes de cada entrega. Quién puede hacer
// qué lo decide la ruta con lib/homework.js; acá solo se lee y escribe.
//
// Tablas: homeworks, homework_submissions (una fila por alumno, creada vacía
// al asignar) y homework_messages, de la migración 020; lee classes (destinos),
// users y subjects. Las neuronas de entregas/correcciones las escribe
// db/neuronas.js (neurona_credits, 021).
// Locks: ninguno; createHomework y saveFeedback (primera corrección) abren
// transacción. La concurrencia de entregar/corregir se resuelve con UPDATE
// condicionales.
// Lo usa: routes/homework/index.js.

const HOMEWORK_COLUMNS = `
  h.id,
  h.title,
  h.description,
  to_char(h.due_date, 'YYYY-MM-DD') AS "dueDate",
  to_char(h.due_time, 'HH24:MI') AS "dueTime",
  to_char(h.class_date, 'YYYY-MM-DD') AS "classDate",
  to_char(h.start_time, 'HH24:MI') AS "classStartTime",
  s.name AS "subjectName",
  t.nombre || ' ' || t.apellido AS "teacherName",
  h.created_at AS "createdAt"
`;

const HOMEWORK_JOINS = `
  FROM homeworks h
  JOIN users t ON t.id = h.teacher_id
  LEFT JOIN subjects s ON s.id = h.subject_id
`;

const SUBMISSION_JSON = `
  json_build_object(
    'id', e.id,
    'studentId', e.student_id,
    'studentName', a.nombre || ' ' || a.apellido,
    'text', e.text_content,
    'linkUrl', e.link_url,
    'submittedAt', e.submitted_at,
    'isLate', e.is_late,
    'feedback', e.feedback,
    'correctedAt', e.corrected_at
  )
`;

/**
 * A quién le puede asignar: sus alumnos y sus clases grupales recientes o por venir.
 *
 * @param {string} teacherId - request.user.id del docente.
 * @param {string} sinceDate - 'YYYY-MM-DD' desde el que cuentan las grupales
 *   (recentGroupSince de lib/homework.js: hoy menos 60 días).
 * @returns {Promise<{students: Array<{id, name}>, groups: Array<{classId, date,
 *   startTime, subjectName, enrolled}>}>}
 * Origen: classes no canceladas + users / subjects.
 * Lo usa: routes/homework/index.js (GET /api/homework/targets).
 */
export async function findTargets(teacherId, sinceDate) {
  // FILTRO: alumnos = los que tienen o tuvieron una clase no cancelada con el
  // docente; grupales = turnos no cancelados con cupo > 1 desde `sinceDate`
  // (recentGroupSince): a una de hace un año ya no tiene sentido asignarle.
  const pool = getPool();
  const [students, groups] = await Promise.all([
    pool.query(
      `SELECT DISTINCT u.id, u.nombre || ' ' || u.apellido AS name
       FROM classes c
       JOIN users u ON u.id = c.student_id
       WHERE c.teacher_id = $1 AND c.status <> 'cancelada'
       ORDER BY name`,
      [teacherId]
    ),
    // Una grupal son varias filas: cualquiera de ellas identifica al turno.
    pool.query(
      `SELECT (array_agg(c.id ORDER BY c.id))[1] AS "classId",
              to_char(c.class_date, 'YYYY-MM-DD') AS date,
              to_char(c.start_time, 'HH24:MI') AS "startTime",
              s.name AS "subjectName",
              count(*)::int AS enrolled
       FROM classes c
       JOIN subjects s ON s.id = c.subject_id
       WHERE c.teacher_id = $1 AND c.status <> 'cancelada' AND c.max_students > 1
         AND c.class_date >= $2::date
       GROUP BY c.class_date, c.start_time, s.name
       ORDER BY c.class_date DESC, c.start_time DESC`,
      [teacherId, sinceDate]
    ),
  ]);
  return { students: students.rows, groups: groups.rows };
}

/**
 * Si ese alumno tiene o tuvo alguna clase no cancelada con el docente.
 *
 * @param {string} teacherId - request.user.id.
 * @param {string} studentId - body.studentId de POST /api/homework.
 * @returns {Promise<boolean>}
 * Origen: classes.
 * Lo usa: routes/homework/index.js (resolveTarget).
 */
export async function isStudentOf(teacherId, studentId) {
  const result = await getPool().query(
    `SELECT 1 FROM classes
     WHERE teacher_id = $1 AND student_id = $2 AND status <> 'cancelada' LIMIT 1`,
    [teacherId, studentId]
  );
  return result.rowCount > 0;
}

/**
 * La consigna y una entrega vacía por alumno, todo o nada. Devuelve el id.
 *
 * @param {object} tarea - teacherId (request.user.id); title, description,
 *   dueDate, dueTime de validateHomework; studentIds y, si es a una grupal,
 *   subjectId/classDate/startTime de resolveTarget en la ruta.
 * @returns {Promise<string>} id de la tarea nueva.
 * Origen: INSERT en homeworks y homework_submissions.
 * Lo usa: routes/homework/index.js (POST /api/homework).
 * Locks/transacción: transacción propia.
 */
export async function createHomework({
  teacherId,
  title,
  description,
  dueDate,
  dueTime,
  subjectId = null,
  classDate = null,
  startTime = null,
  studentIds,
}) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO homeworks
         (teacher_id, title, description, due_date, due_time, subject_id, class_date, start_time)
       VALUES ($1, $2, $3, $4::date, $5::time, $6, $7::date, $8::time)
       RETURNING id`,
      [teacherId, title, description, dueDate, dueTime, subjectId, classDate, startTime]
    );
    const { id } = created.rows[0];
    await client.query(
      `INSERT INTO homework_submissions (homework_id, student_id)
       SELECT $1, unnest($2::uuid[])`,
      [id, studentIds]
    );
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Tareas vistas por el docente: HOMEWORK_COLUMNS + `submissions` (todas las
 * entregas, SUBMISSION_JSON, por nombre de alumno). Más nuevas primero.
 */
async function queryTeacherHomeworks(where, params) {
  const result = await getPool().query(
    `SELECT ${HOMEWORK_COLUMNS},
            COALESCE((
              SELECT json_agg(${SUBMISSION_JSON} ORDER BY a.nombre, a.apellido)
              FROM homework_submissions e
              JOIN users a ON a.id = e.student_id
              WHERE e.homework_id = h.id
            ), '[]'::json) AS submissions
     ${HOMEWORK_JOINS}
     WHERE ${where}
     ORDER BY h.due_date DESC, h.due_time DESC, h.created_at DESC`,
    params
  );
  return result.rows;
}

/**
 * Las tareas del docente, cada una con la entrega de todos sus alumnos.
 *
 * @param {string} teacherId - request.user.id.
 * @returns {Promise<Array<{id, title, description, dueDate, dueTime, classDate,
 *   classStartTime, subjectName, teacherName, createdAt, submissions}>>}
 * Origen: homeworks + users + subjects + homework_submissions.
 * Lo usa: routes/homework/index.js (GET /api/homework como docente).
 */
export function listTeacherHomeworks(teacherId) {
  // FILTRO: solo las tareas que asignó este docente.
  return queryTeacherHomeworks('h.teacher_id = $1', [teacherId]);
}

/**
 * Una tarea del docente, con la misma forma que listTeacherHomeworks; null si
 * no existe o es de otro.
 *
 * @param {string} id - id de la tarea (recién creada, o homeworkId de la entrega corregida).
 * @param {string} teacherId - request.user.id.
 * Lo usa: routes/homework/index.js (respuesta de POST / y de POST /submissions/:id/feedback).
 */
export async function findTeacherHomework(id, teacherId) {
  const rows = await queryTeacherHomeworks('h.id = $1 AND h.teacher_id = $2', [id, teacherId]);
  return rows[0] ?? null;
}

/**
 * Tareas vistas por el alumno: HOMEWORK_COLUMNS + `submission` (solo la suya,
 * SUBMISSION_JSON). Por vencimiento, la más próxima primero.
 */
async function queryStudentHomeworks(where, params) {
  const result = await getPool().query(
    `SELECT ${HOMEWORK_COLUMNS}, ${SUBMISSION_JSON} AS submission
     ${HOMEWORK_JOINS}
     JOIN homework_submissions e ON e.homework_id = h.id
     JOIN users a ON a.id = e.student_id
     WHERE ${where}
     ORDER BY h.due_date, h.due_time, h.created_at`,
    params
  );
  return result.rows;
}

/**
 * Las tareas del alumno, cada una solo con SU entrega: no ve las de sus compañeros.
 *
 * @param {string} studentId - request.user.id.
 * @returns {Promise<Array<object>>} HOMEWORK_COLUMNS + submission.
 * Origen: homeworks + homework_submissions + users + subjects.
 * Lo usa: routes/homework/index.js (GET /api/homework como alumno).
 */
export function listStudentHomeworks(studentId) {
  // FILTRO: solo la propia entrega de cada tarea: el alumno no ve las de sus compañeros.
  return queryStudentHomeworks('e.student_id = $1', [studentId]);
}

/**
 * Una tarea del alumno con su entrega (forma de listStudentHomeworks); null si
 * no existe o no le fue asignada.
 *
 * @param {string} id - params.id de PUT /api/homework/:id/submission.
 * @param {string} studentId - request.user.id.
 * Lo usa: routes/homework/index.js.
 */
export async function findStudentHomework(id, studentId) {
  const rows = await queryStudentHomeworks('h.id = $1 AND e.student_id = $2', [id, studentId]);
  return rows[0] ?? null;
}

/**
 * La entrega y a quién pertenece, para decidir el acceso; o null.
 *
 * @param {string} id - params.id de /api/homework/submissions/:id/*.
 * @returns {Promise<{id, homeworkId, studentId, teacherId, submittedAt, correctedAt,
 *   isLate, title, createdAt, dueDate, dueTime}|null>}
 * Origen: homework_submissions JOIN homeworks.
 * Lo usa: routes/homework/index.js (loadOwnSubmission).
 */
export async function findSubmission(id) {
  const result = await getPool().query(
    `SELECT e.id, e.homework_id AS "homeworkId", e.student_id AS "studentId",
            h.teacher_id AS "teacherId", e.submitted_at AS "submittedAt",
            e.corrected_at AS "correctedAt", e.is_late AS "isLate",
            h.title, h.created_at AS "createdAt",
            to_char(h.due_date, 'YYYY-MM-DD') AS "dueDate",
            to_char(h.due_time, 'HH24:MI') AS "dueTime"
     FROM homework_submissions e
     JOIN homeworks h ON h.id = e.homework_id
     WHERE e.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Guarda la entrega. El WHERE repite la regla de lib/homework.js: si el
 * docente corrigió entre que se leyó y se escribió, no pisa nada y devuelve
 * false. Si quedó fuera de término, le saca al alumno la neurona de "a
 * tiempo" que pudiera tener (removeHomeworkOnTimeCredit), en la misma
 * transacción: o se guardan las dos cosas o ninguna.
 *
 * @param {string} id - homework.submission.id (de findStudentHomework).
 * @param {{text, linkUrl, isLate}} entrega - text/linkUrl de validateSubmission;
 *   isLate de isPastDue (lib/homework.js).
 * @returns {Promise<boolean>}
 * Origen: UPDATE homework_submissions; DELETE en neurona_credits si es tardía.
 * Lo usa: routes/homework/index.js (PUT /:id/submission).
 * Locks/transacción: transacción propia; 'neuronas:' || alumno si es tardía.
 */
export async function saveSubmission(id, { text, linkUrl, isLate }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE homework_submissions
       SET text_content = $2, link_url = $3, is_late = $4, submitted_at = now()
       WHERE id = $1 AND corrected_at IS NULL
       RETURNING student_id AS "studentId"`,
      [id, text, linkUrl, isLate]
    );
    const saved = result.rows[0];
    if (saved && isLate) await removeHomeworkOnTimeCredit(client, id, saved.studentId);
    await client.query('COMMIT');
    return Boolean(saved);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const SAVE_FEEDBACK_SQL = `
  UPDATE homework_submissions
  SET feedback = $2, corrected_at = now()
  WHERE id = $1 AND submitted_at IS NOT NULL`;

/**
 * Guarda la devolución. `award` ({ submission, credits, today }) viene solo en
 * la primera corrección: la devolución y sus neuronas se guardan juntas.
 *
 * @param {string} id - id de la entrega (loadOwnSubmission).
 * @param {string} feedback - body.feedback validado por validateFeedback.
 * @param {object|null} [award] - submission de findSubmission, credits de
 *   correctionCredits (lib/neuronas.js), today = now().iso.
 * @returns {Promise<boolean>} false si la entrega no estaba entregada.
 * Origen: UPDATE homework_submissions; neurona_credits vía creditCorrection.
 * Lo usa: routes/homework/index.js (POST /submissions/:id/feedback).
 * Locks/transacción: transacción propia solo cuando hay `award`.
 */
export async function saveFeedback(id, feedback, award = null) {
  if (!award) {
    const result = await getPool().query(SAVE_FEEDBACK_SQL, [id, feedback]);
    return result.rowCount > 0;
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(SAVE_FEEDBACK_SQL, [id, feedback]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await creditCorrection(client, award.submission, award.credits, award.today);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const MESSAGE_COLUMNS = `
  m.id,
  m.sender_id AS "senderId",
  u.nombre || ' ' || u.apellido AS "senderName",
  u.role AS "senderRole",
  m.body,
  m.created_at AS "createdAt"
`;

/**
 * Los mensajes del chat de una entrega, en orden.
 *
 * @param {string} submissionId - id de la entrega (loadOwnSubmission).
 * @returns {Promise<Array<{id, senderId, senderName, senderRole, body, createdAt}>>}
 * Origen: homework_messages JOIN users.
 * Lo usa: routes/homework/index.js (GET /submissions/:id/messages).
 */
export async function listMessages(submissionId) {
  const result = await getPool().query(
    `SELECT ${MESSAGE_COLUMNS}
     FROM homework_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.submission_id = $1
     ORDER BY m.created_at, m.id`,
    [submissionId]
  );
  return result.rows;
}

/**
 * Agrega un mensaje al chat de una entrega.
 *
 * @param {{submissionId, senderId, body}} mensaje - senderId = request.user.id;
 *   body validado por validateMessage.
 * @returns {Promise<object>} el mensaje creado, misma forma que listMessages.
 * Origen: INSERT en homework_messages (CTE) JOIN users.
 * Lo usa: routes/homework/index.js (POST /submissions/:id/messages).
 */
export async function addMessage({ submissionId, senderId, body }) {
  const result = await getPool().query(
    `WITH m AS (
       INSERT INTO homework_messages (submission_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING *
     )
     SELECT ${MESSAGE_COLUMNS} FROM m JOIN users u ON u.id = m.sender_id`,
    [submissionId, senderId, body]
  );
  return result.rows[0];
}
