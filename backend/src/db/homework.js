import { getPool } from './pool.js';
import { creditCorrection, removeHomeworkOnTimeCredit } from './neuronas.js';

// Las tareas, sus entregas y los mensajes de cada entrega. Quién puede hacer
// qué lo decide la ruta con lib/homework.js; acá solo se lee y escribe.

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

/** A quién le puede asignar: sus alumnos y sus clases grupales recientes o por venir. */
export async function findTargets(teacherId, sinceDate) {
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

/** Si ese alumno tiene o tuvo alguna clase no cancelada con el docente. */
export async function isStudentOf(teacherId, studentId) {
  const result = await getPool().query(
    `SELECT 1 FROM classes
     WHERE teacher_id = $1 AND student_id = $2 AND status <> 'cancelada' LIMIT 1`,
    [teacherId, studentId]
  );
  return result.rowCount > 0;
}

/** La consigna y una entrega vacía por alumno, todo o nada. Devuelve el id. */
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

/** Las tareas del docente, cada una con la entrega de todos sus alumnos. */
export function listTeacherHomeworks(teacherId) {
  return queryTeacherHomeworks('h.teacher_id = $1', [teacherId]);
}

export async function findTeacherHomework(id, teacherId) {
  const rows = await queryTeacherHomeworks('h.id = $1 AND h.teacher_id = $2', [id, teacherId]);
  return rows[0] ?? null;
}

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

/** Las tareas del alumno, cada una solo con SU entrega: no ve las de sus compañeros. */
export function listStudentHomeworks(studentId) {
  return queryStudentHomeworks('e.student_id = $1', [studentId]);
}

export async function findStudentHomework(id, studentId) {
  const rows = await queryStudentHomeworks('h.id = $1 AND e.student_id = $2', [id, studentId]);
  return rows[0] ?? null;
}

/** La entrega y a quién pertenece, para decidir el acceso; o null. */
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
 * false.
 */
export async function saveSubmission(id, { text, linkUrl, isLate }) {
  const result = await getPool().query(
    `UPDATE homework_submissions
     SET text_content = $2, link_url = $3, is_late = $4, submitted_at = now()
     WHERE id = $1 AND corrected_at IS NULL`,
    [id, text, linkUrl, isLate]
  );
  if (result.rowCount > 0 && isLate) await removeHomeworkOnTimeCredit(id);
  return result.rowCount > 0;
}

const SAVE_FEEDBACK_SQL = `
  UPDATE homework_submissions
  SET feedback = $2, corrected_at = now()
  WHERE id = $1 AND submitted_at IS NOT NULL`;

/**
 * Guarda la devolución. `award` ({ submission, credits, today }) viene solo en
 * la primera corrección: la devolución y sus neuronas se guardan juntas.
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
