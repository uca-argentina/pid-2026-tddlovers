import { getPool } from './pool.js';
import {
  FEATURED_COST,
  FEATURED_DAYS,
  FEEDBACK_DAILY_CAP,
  HOMEWORK_ON_TIME_NEURONAS,
  HOMEWORK_WEEKLY_CAP_PER_TEACHER,
  MAX_FEATURED_TEACHERS,
  TEACHER_CLASS_DAILY_CAP,
  homeworkEarns,
  turnCredits,
  weekBounds,
  withinCap,
} from '../lib/neuronas.js';

// Las neuronas de cada usuario. Cuánto vale cada cosa lo decide lib/neuronas.js;
// acá se lee y se escribe. Las funciones que reciben `client` corren adentro de
// la transacción de quien las llama, para que el crédito y lo que lo origina
// queden guardados juntos o no se guarde ninguno.

async function lockUser(client, userId) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('neuronas:' || $1))`, [userId]);
}

/** Deja el crédito en `amount`. Con 0 lo borra: el CHECK no admite filas en cero. */
async function setCredit(client, { userId, reason, key, amount, detail, earnedOn }) {
  if (amount <= 0) {
    await client.query(`DELETE FROM neurona_credits WHERE user_id = $1 AND source_key = $2`, [
      userId,
      key,
    ]);
    return;
  }
  await client.query(
    `INSERT INTO neurona_credits (user_id, reason, source_key, amount, detail, earned_on)
     VALUES ($1, $2, $3, $4, $5, $6::date)
     ON CONFLICT (user_id, source_key) DO UPDATE SET amount = $4, detail = $5`,
    [userId, reason, key, amount, detail, earnedOn]
  );
}

/** A diferencia de setCredit no pisa: lo que ya se acreditó por una entrega no se recalcula. */
async function addCreditOnce(client, { userId, reason, key, amount, detail, earnedOn }) {
  if (amount <= 0) return;
  await client.query(
    `INSERT INTO neurona_credits (user_id, reason, source_key, amount, detail, earned_on)
     VALUES ($1, $2, $3, $4, $5, $6::date)
     ON CONFLICT (user_id, source_key) DO NOTHING`,
    [userId, reason, key, amount, detail, earnedOn]
  );
}

/**
 * Recalcula las neuronas de un turno desde el estado actual de sus reservas. Se
 * llama al tomar lista o registrar un pago. Es idempotente: corregir presente a
 * ausente o pagar una clase ya dada queda bien con solo volver a correrla.
 */
export async function syncTurnCredits(client, { teacherId, date, startTime }) {
  await lockUser(client, teacherId);
  const { monday, sunday } = weekBounds(date);

  const result = await client.query(
    `SELECT c.id,
            c.student_id AS "studentId",
            c.status,
            to_char(c.class_date, 'YYYY-MM-DD') AS date,
            to_char(c.start_time, 'HH24:MI') AS "startTime",
            to_char(c.end_time, 'HH24:MI') AS "endTime",
            c.price_cents AS "priceCents",
            c.paid_at AS "paidAt",
            c.reward_type AS "rewardType",
            c.reward_neuronas AS "rewardNeuronas",
            s.name AS "subjectName",
            COALESCE(sp.price_cents, 0) AS "packPriceCents"
     FROM classes c
     JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN student_packs sp ON sp.id = c.student_pack_id
     WHERE c.teacher_id = $1
       AND c.class_date BETWEEN $2::date AND $3::date
       AND (c.status = 'realizada' OR (c.class_date = $4::date AND c.start_time = $5::time))`,
    [teacherId, monday, sunday, date, startTime]
  );

  const turnRows = result.rows.filter((row) => row.date === date && row.startTime === startTime);
  if (turnRows.length === 0) return;
  const detail = turnRows[0].subjectName;
  const credits = turnCredits(turnRows, result.rows);

  for (const booking of credits.bookings) {
    await setCredit(client, {
      userId: booking.studentId,
      reason: 'class_attended',
      key: `class:${booking.classId}`,
      amount: booking.student,
      detail,
      earnedOn: date,
    });
    await setCredit(client, {
      userId: teacherId,
      reason: 'reward_bonus',
      key: `bonus:${booking.classId}`,
      amount: booking.bonus,
      detail,
      earnedOn: date,
    });
  }

  const key = `turn:${date}:${startTime}`;
  const others = await client.query(
    `SELECT COALESCE(sum(amount), 0)::int AS total
     FROM neurona_credits
     WHERE user_id = $1 AND reason = 'class_taught' AND earned_on = $2::date AND source_key <> $3`,
    [teacherId, date, key]
  );
  await setCredit(client, {
    userId: teacherId,
    reason: 'class_taught',
    key,
    amount: withinCap(credits.teacher, TEACHER_CLASS_DAILY_CAP, others.rows[0].total),
    detail,
    earnedOn: date,
  });
}

/** Las neuronas del alumno por una tarea a tiempo, con el tope semanal por docente. */
async function creditHomeworkOnTime(client, { studentId, teacherId, submissionId, title }, today) {
  const { monday, sunday } = weekBounds(today);
  const count = await client.query(
    `SELECT count(*)::int AS total
     FROM neurona_credits n
     JOIN homework_submissions e ON n.source_key = 'submission:' || e.id::text
     JOIN homeworks h ON h.id = e.homework_id
     WHERE n.user_id = $1 AND n.reason = 'homework_on_time' AND h.teacher_id = $2
       AND n.earned_on BETWEEN $3::date AND $4::date`,
    [studentId, teacherId, monday, sunday]
  );
  if (count.rows[0].total >= HOMEWORK_WEEKLY_CAP_PER_TEACHER) return;
  await addCreditOnce(client, {
    userId: studentId,
    reason: 'homework_on_time',
    key: `submission:${submissionId}`,
    amount: HOMEWORK_ON_TIME_NEURONAS,
    detail: title,
    earnedOn: today,
  });
}

/** Las neuronas de la primera corrección, `credits` como las da correctionCredits. */
export async function creditCorrection(client, submission, credits, today) {
  await lockUser(client, submission.teacherId);
  const earned = await client.query(
    `SELECT COALESCE(sum(amount), 0)::int AS total
     FROM neurona_credits
     WHERE user_id = $1 AND reason = 'homework_feedback' AND earned_on = $2::date`,
    [submission.teacherId, today]
  );
  await addCreditOnce(client, {
    userId: submission.teacherId,
    reason: 'homework_feedback',
    key: `submission:${submission.id}`,
    amount: withinCap(credits.teacher, FEEDBACK_DAILY_CAP, earned.rows[0].total),
    detail: submission.title,
    earnedOn: today,
  });
  if (credits.student > 0) {
    await creditHomeworkOnTime(
      client,
      {
        studentId: submission.studentId,
        teacherId: submission.teacherId,
        submissionId: submission.id,
        title: submission.title,
      },
      today
    );
  }
}

/**
 * Si el docente nunca corrigió, el alumno cobra a los 7 días del vencimiento:
 * no tiene por qué perderlas por la demora de otro. Sin cron, como
 * expireStartedPending: se liquida cuando el alumno mira o usa su saldo.
 */
export async function settleHomeworkCredits(studentId, { iso, time }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockUser(client, studentId);
    const pending = await client.query(
      `SELECT e.id, h.teacher_id AS "teacherId", h.title, h.created_at AS "createdAt",
              to_char(h.due_date, 'YYYY-MM-DD') AS "dueDate",
              to_char(h.due_time, 'HH24:MI') AS "dueTime"
       FROM homework_submissions e
       JOIN homeworks h ON h.id = e.homework_id
       WHERE e.student_id = $1
         AND e.submitted_at IS NOT NULL AND NOT e.is_late AND e.corrected_at IS NULL
         AND h.due_date + h.due_time + interval '7 days' <= $2::timestamp
         AND NOT EXISTS (
           SELECT 1 FROM neurona_credits n
           WHERE n.user_id = e.student_id AND n.source_key = 'submission:' || e.id::text
         )
       ORDER BY h.due_date, h.due_time`,
      [studentId, `${iso} ${time}`]
    );
    for (const row of pending.rows) {
      if (!homeworkEarns(row)) continue;
      await creditHomeworkOnTime(
        client,
        { studentId, teacherId: row.teacherId, submissionId: row.id, title: row.title },
        iso
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

/** Editar después del vencimiento la deja fuera de término: ya no vale lo liquidado. */
export async function removeHomeworkOnTimeCredit(submissionId) {
  await getPool().query(
    `DELETE FROM neurona_credits
     WHERE reason = 'homework_on_time' AND source_key = $1`,
    [`submission:${submissionId}`]
  );
}

/**
 * Saldo y acreditado total. El saldo se calcula siempre: cancelar una clase
 * devuelve su canje porque deja de sumarse. Puede dar negativo si se corrigió
 * una asistencia después de gastar lo que dio; solo impide nuevos canjes.
 */
export async function findBalance(userId, db = getPool()) {
  const result = await db.query(
    `SELECT earned, earned - spent_classes - spent_featured AS balance
     FROM (
       SELECT
         (SELECT COALESCE(sum(amount), 0)::int FROM neurona_credits WHERE user_id = $1) AS earned,
         (SELECT COALESCE(sum(reward_neuronas), 0)::int FROM classes
          WHERE student_id = $1 AND status <> 'cancelada') AS spent_classes,
         (SELECT COALESCE(sum(cost_neuronas), 0)::int FROM teacher_featured
          WHERE teacher_id = $1) AS spent_featured
     ) totals`,
    [userId]
  );
  return result.rows[0];
}

/**
 * Adentro de la transacción de la reserva: entre el chequeo de la ruta y el
 * INSERT el alumno puede estar gastando lo mismo en otra pestaña.
 */
export async function hasBalanceFor(client, studentId, cost) {
  await lockUser(client, studentId);
  const { balance } = await findBalance(studentId, client);
  return balance >= cost;
}

/** Cuánto de cada cosa lleva acreditada el usuario, para las insignias. */
export async function findCreditCounts(userId) {
  const result = await getPool().query(
    `SELECT count(*) FILTER (WHERE reason = 'class_attended')::int AS "classesAttended",
            count(*) FILTER (WHERE reason = 'homework_on_time')::int AS "homeworksOnTime"
     FROM neurona_credits
     WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0];
}

/** El historial: lo acreditado (en positivo) y lo gastado (en negativo), lo último primero. */
export async function listMovements(userId, limit = 50) {
  const result = await getPool().query(
    `SELECT id, reason, amount, detail, "createdAt" FROM (
       SELECT id, reason, amount, detail, created_at AS "createdAt"
       FROM neurona_credits
       WHERE user_id = $1
       UNION ALL
       SELECT c.id, 'class_reward', -c.reward_neuronas, s.name, c.created_at
       FROM classes c
       JOIN subjects s ON s.id = c.subject_id
       WHERE c.student_id = $1 AND c.reward_type IS NOT NULL AND c.status <> 'cancelada'
       UNION ALL
       SELECT id, 'featured', -cost_neuronas, '', created_at
       FROM teacher_featured
       WHERE teacher_id = $1
     ) movements
     ORDER BY "createdAt" DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

/** Hasta cuándo está destacado el docente, y cuántos lugares quedan. */
export async function findFeaturedStatus(teacherId, today) {
  const result = await getPool().query(
    `SELECT
       (SELECT to_char(max(end_date), 'YYYY-MM-DD') FROM teacher_featured
        WHERE teacher_id = $1 AND end_date >= $2::date) AS "activeUntil",
       (SELECT count(*)::int FROM teacher_featured WHERE end_date >= $2::date) AS active`,
    [teacherId, today]
  );
  const { activeUntil, active } = result.rows[0];
  return { activeUntil, slotsLeft: Math.max(0, MAX_FEATURED_TEACHERS - active) };
}

/**
 * Compra 7 días de Destacado desde hoy. Dos locks porque se cuidan dos cosas: el
 * saldo del docente y el cupo, que es de todos. Si cualquiera pudiera destacarse,
 * "Destacado" dejaría de distinguir a nadie. Devuelve { endDate } o { conflict }.
 */
export async function buyFeatured(teacherId, today) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockUser(client, teacherId);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('neuronas-featured'))`);

    const active = await client.query(
      `SELECT teacher_id AS "teacherId" FROM teacher_featured WHERE end_date >= $1::date`,
      [today]
    );
    const conflict = async (message) => {
      await client.query('ROLLBACK');
      return { conflict: message };
    };
    if (active.rows.some((row) => String(row.teacherId) === String(teacherId))) {
      return await conflict('Ya estás destacado: vas a poder renovarlo cuando termine.');
    }
    if (active.rows.length >= MAX_FEATURED_TEACHERS) {
      return await conflict('Ya no quedan lugares de Destacado. Probá de nuevo en unos días.');
    }
    const { balance } = await findBalance(teacherId, client);
    if (balance < FEATURED_COST) return await conflict('No te alcanzan las neuronas.');

    const created = await client.query(
      `INSERT INTO teacher_featured (teacher_id, start_date, end_date, cost_neuronas)
       VALUES ($1, $2::date, $2::date + $3::int, $4)
       RETURNING to_char(end_date, 'YYYY-MM-DD') AS "endDate"`,
      [teacherId, today, FEATURED_DAYS - 1, FEATURED_COST]
    );
    await client.query('COMMIT');
    return { endDate: created.rows[0].endDate };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
