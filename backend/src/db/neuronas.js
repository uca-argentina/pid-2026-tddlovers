import { getPool } from './pool.js';
import {
  FEATURED_COST,
  FEATURED_DAYS,
  FEEDBACK_DAILY_CAP,
  HOMEWORK_ON_TIME_NEURONAS,
  HOMEWORK_WEEKLY_CAP_PER_TEACHER,
  MAX_FEATURED_TEACHERS,
  homeworkEarns,
  weekBounds,
  weekClassCredits,
  withinCap,
} from '../lib/neuronas.js';

// Las neuronas de cada usuario. Cuánto vale cada cosa lo decide lib/neuronas.js;
// acá se lee y se escribe. Las funciones que reciben `client` corren adentro de
// la transacción de quien las llama, para que el crédito y lo que lo origina
// queden guardados juntos o no se guarde ninguno.
//
// Tablas: neurona_credits (migración 021; una fila por source_key:
// 'booking:<reservaId>', 'taught:<claseId>', 'bonus:<reservaId>', 'submission:<id>'),
// teacher_featured (021); lee class_bookings + classes (reward_type/reward_neuronas de 021,
// pack de 014/015), student_packs (014), subjects, homeworks y
// homework_submissions (020). El saldo nunca se guarda: se calcula.
// Locks (pg_advisory_xact_lock):
//   'neuronas:' || userId  por usuario; orden siempre docente → alumno
//   'neuronas-featured'    global, en buyFeatured (después del del docente)
// Lo usan: db/availability.js (featuredActiveOn), db/bookings.js (syncClassCredits, hasBalanceFor), db/homework.js
// (creditCorrection, removeHomeworkOnTimeCredit), routes/neuronas y
// routes/bookings (findBalance, settleHomeworkCredits).

/**
 * La condición de "Destacado vigente el día `today`" para una fila de
 * teacher_featured con alias `alias`. Una sola definición para el cupo
 * (findFeaturedStatus, buyFeatured) y para el tablero (findPublishedWindows en
 * db/availability.js): si no, un docente podía contar como destacado en un
 * lado y no en el otro. `today` es el placeholder ('$2') con now().iso de
 * lib/clock.js, nunca now() de Postgres (que corre en UTC).
 */
export const featuredActiveOn = (alias, today) =>
  `(${alias}.start_date <= ${today}::date AND ${alias}.end_date >= ${today}::date)`;

/** Toma el lock 'neuronas:' || userId dentro de la transacción de `client`. */
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
 * Recalcula las neuronas de una clase desde el estado actual de sus reservas.
 * Se llama al tomar lista o registrar un pago. Es idempotente: corregir
 * presente a ausente o pagar una clase ya dada queda bien con solo volver a
 * correrla.
 *
 * Los topes (8 h por pareja en la semana, 150 por fecha para el docente) miran
 * lo anterior, así que este cambio puede mover a las clases que vienen después
 * en la semana: pagar el lunes después del miércoles le saca minutos al
 * miércoles. Por eso se recalculan también todas esas, con setCredit, y el
 * total queda igual sea cual sea el orden en que se marcaron.
 *
 * Claves: 'class:<reservaId>' (alumno), 'bonus:<reservaId>' (docente, por un
 * canje) y 'taught:<claseId>' (docente, por dar la clase).
 *
 * @param {pg.PoolClient} client - la transacción de transitionBookings (db/bookings.js).
 * @param {{classId, teacherId, date, startTime}} cls - lo que devuelve TRANSITION_SQL.
 * @returns {Promise<void>}
 * Origen: class_bookings + classes de la semana del docente (+ subjects, student_packs); escribe
 *   neurona_credits con las cuentas de weekClassCredits (lib/neuronas.js).
 * Lo usa: db/bookings.js (transitionBookings, al tomar lista o pagar).
 * Locks/transacción: 'neuronas:' || teacherId.
 */
export async function syncClassCredits(client, { classId, teacherId, date, startTime }) {
  await lockUser(client, teacherId);
  const { monday, sunday } = weekBounds(date);

  const result = await client.query(
    `SELECT b.id,
            b.class_id AS "classId",
            b.student_id AS "studentId",
            b.status,
            to_char(c.class_date, 'YYYY-MM-DD') AS date,
            to_char(c.start_time, 'HH24:MI') AS "startTime",
            to_char(c.end_time, 'HH24:MI') AS "endTime",
            b.price_cents AS "priceCents",
            b.paid_at AS "paidAt",
            b.reward_type AS "rewardType",
            b.reward_neuronas AS "rewardNeuronas",
            s.name AS "subjectName",
            COALESCE(sp.price_cents, 0) AS "packPriceCents"
     FROM class_bookings b
     JOIN classes c ON c.id = b.class_id
     JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN student_packs sp ON sp.id = b.student_pack_id
     WHERE c.teacher_id = $1
       AND c.class_date BETWEEN $2::date AND $3::date
       AND (b.status = 'realizada' OR b.class_id = $4)`,
    [teacherId, monday, sunday, classId]
  );

  // Las clases anteriores no cambian: los topes solo miran hacia atrás. Las
  // posteriores sin realizadas no están en la consulta, pero tampoco tienen
  // neuronas: al dejar de tener realizadas cada una ya puso las suyas en 0.
  const changed = `${date}T${startTime}`;
  const toSave = weekClassCredits(result.rows).filter(
    (cls) => `${cls.date}T${cls.startTime}` >= changed
  );

  for (const cls of toSave) {
    const detail = cls.rows[0].subjectName;
    for (const booking of cls.bookings) {
      await setCredit(client, {
        userId: booking.studentId,
        reason: 'class_attended',
        key: `booking:${booking.bookingId}`,
        amount: booking.student,
        detail,
        earnedOn: cls.date,
      });
      await setCredit(client, {
        userId: teacherId,
        reason: 'reward_bonus',
        key: `bonus:${booking.bookingId}`,
        amount: booking.bonus,
        detail,
        earnedOn: cls.date,
      });
    }
    await setCredit(client, {
      userId: teacherId,
      reason: 'class_taught',
      key: `taught:${cls.classId}`,
      amount: cls.teacher,
      detail,
      earnedOn: cls.date,
    });
  }
}

/**
 * Las neuronas del alumno por una tarea a tiempo, con el tope semanal por docente.
 * El tope se cuenta bajo el lock del alumno: se llega acá desde la corrección
 * (que ya tiene el del docente) y desde settleHomeworkCredits (que tiene el del
 * alumno), y con locks distintos dos requests a la vez podían acreditar una
 * cuarta. El orden es siempre docente → alumno y ningún camino toma el de un
 * docente teniendo el de un alumno, así que no se puede trabar. El lock es
 * reentrante dentro de la transacción: tomarlo de nuevo desde settle no espera.
 *
 * @param {string} today - 'YYYY-MM-DD' (hora argentina), fecha del crédito.
 * Origen: cuenta neurona_credits 'homework_on_time' de la semana con ese docente.
 * Locks/transacción: 'neuronas:' || studentId.
 */
async function creditHomeworkOnTime(client, { studentId, teacherId, submissionId, title }, today) {
  await lockUser(client, studentId);
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

/**
 * Las neuronas de la primera corrección, `credits` como las da correctionCredits.
 * Al docente, con el tope diario; al alumno (si `credits.student` > 0), la de
 * tarea a tiempo vía creditHomeworkOnTime.
 *
 * @param {pg.PoolClient} client - la transacción de saveFeedback (db/homework.js).
 * @param {object} submission - fila de findSubmission (id, teacherId, studentId, title).
 * @param {{teacher: number, student: number}} credits - de correctionCredits (lib/neuronas.js).
 * @param {string} today - now().iso.
 * @returns {Promise<void>}
 * Origen: neurona_credits ('homework_feedback' y 'homework_on_time').
 * Lo usa: db/homework.js (saveFeedback).
 * Locks/transacción: 'neuronas:' del docente y después el del alumno.
 */
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
 *
 * @param {string} studentId - request.user.id del alumno.
 * @param {{iso: string, time: string}} ahora - now() de lib/clock.js.
 * @returns {Promise<void>}
 * Origen: homework_submissions + homeworks sin crédito todavía; escribe neurona_credits.
 * Lo usan: routes/neuronas/index.js (GET /) y routes/bookings/index.js (priceBooking, al canjear).
 * Locks/transacción: transacción propia; 'neuronas:' || studentId.
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

/**
 * Editar después del vencimiento la deja fuera de término: ya no vale lo liquidado.
 *
 * Corre en la misma transacción que guarda la entrega (si el borrado fallara
 * aparte, la entrega quedaría tardía con la neurona de "a tiempo"), y bajo el
 * lock de neuronas del alumno, el mismo que toma settleHomeworkCredits: así
 * una liquidación simultánea no puede volver a acreditarla después de borrada.
 *
 * @param {pg.PoolClient} client - transacción abierta por saveSubmission.
 * @param {string} submissionId - id de la entrega recién guardada como tardía.
 * @param {string} studentId - dueño de la entrega (RETURNING del UPDATE); con
 *   él el DELETE usa el UNIQUE (user_id, source_key) en vez de recorrer la tabla.
 * @returns {Promise<void>}
 * Origen: DELETE en neurona_credits (source_key 'submission:<id>').
 * Lo usa: db/homework.js (saveSubmission).
 * Locks: 'neuronas:' || studentId.
 */
export async function removeHomeworkOnTimeCredit(client, submissionId, studentId) {
  await lockUser(client, studentId);
  await client.query(
    `DELETE FROM neurona_credits
     WHERE user_id = $1 AND source_key = $2 AND reason = 'homework_on_time'`,
    [studentId, `submission:${submissionId}`]
  );
}

/**
 * Saldo y acreditado total. El saldo se calcula siempre: cancelar una clase
 * devuelve su canje porque deja de sumarse. Puede dar negativo si se corrigió
 * una asistencia después de gastar lo que dio; solo impide nuevos canjes.
 *
 * @param {string} userId - request.user.id (o el alumno/docente dentro de una transacción).
 * @param {pg.Pool|pg.PoolClient} [db] - por defecto el pool.
 * @returns {Promise<{earned: number, balance: number}>} earned = Σ créditos (define el nivel).
 * Origen: neurona_credits − class_bookings.reward_neuronas no canceladas − teacher_featured.cost_neuronas.
 * Lo usan: hasBalanceFor y buyFeatured (acá), routes/neuronas/index.js y routes/bookings/index.js.
 */
export async function findBalance(userId, db = getPool()) {
  // FILTRO: los canjes de clases canceladas no restan: cancelar devuelve las neuronas.
  const result = await db.query(
    `SELECT earned, earned - spent_bookings - spent_featured AS balance
     FROM (
       SELECT
         (SELECT COALESCE(sum(amount), 0)::int FROM neurona_credits WHERE user_id = $1) AS earned,
         (SELECT COALESCE(sum(reward_neuronas), 0)::int FROM class_bookings
          WHERE student_id = $1 AND status <> 'cancelada') AS spent_bookings,
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
 *
 * @param {pg.PoolClient} client - transacción de insertBooking (db/bookings.js).
 * @param {string} studentId - booking.studentId.
 * @param {number} cost - booking.rewardNeuronas.
 * @returns {Promise<boolean>}
 * Lo usa: db/bookings.js (insertBooking).
 * Locks/transacción: 'neuronas:' || studentId.
 */
export async function hasBalanceFor(client, studentId, cost) {
  await lockUser(client, studentId);
  const { balance } = await findBalance(studentId, client);
  return balance >= cost;
}

/**
 * Cuánto de cada cosa lleva acreditada el usuario, para las insignias.
 *
 * @param {string} userId - request.user.id (alumno).
 * @returns {Promise<{classesAttended: number, homeworksOnTime: number}>}
 * Origen: neurona_credits.
 * Lo usa: routes/neuronas/index.js (badgesFor).
 */
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

/**
 * El historial: lo acreditado (en positivo) y lo gastado (en negativo), lo último primero.
 *
 * @param {string} userId - request.user.id.
 * @param {number} [limit] - cuántos movimientos (50).
 * @returns {Promise<Array<{id, reason, amount, detail, createdAt}>>} reason es la de
 *   neurona_credits, 'class_reward' (canje) o 'featured' (Destacado).
 * Origen: neurona_credits ∪ reservas (class_bookings + classes) con canje no canceladas ∪
 *   teacher_featured.
 * Lo usa: routes/neuronas/index.js (GET /).
 */
export async function listMovements(userId, limit = 50) {
  // FILTRO: solo los del usuario, sin los canjes de clases canceladas (ya
  // volvieron al saldo), los últimos `limit`.
  const result = await getPool().query(
    `SELECT id, reason, amount, detail, "createdAt" FROM (
       SELECT id, reason, amount, detail, created_at AS "createdAt"
       FROM neurona_credits
       WHERE user_id = $1
       UNION ALL
       SELECT b.id, 'class_reward', -b.reward_neuronas, s.name, b.created_at
       FROM class_bookings b
       JOIN classes c ON c.id = b.class_id
       JOIN subjects s ON s.id = c.subject_id
       WHERE b.student_id = $1 AND b.reward_type IS NOT NULL AND b.status <> 'cancelada'
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

/**
 * Hasta cuándo está destacado el docente, y cuántos lugares quedan.
 *
 * @param {string} teacherId - request.user.id.
 * @param {string} today - now().iso.
 * @returns {Promise<{activeUntil: string|null, slotsLeft: number}>}
 * Origen: teacher_featured.
 * Lo usa: routes/neuronas/index.js (GET / como docente).
 */
export async function findFeaturedStatus(teacherId, today) {
  // FILTRO: el cupo global cuenta solo Destacados vigentes de docentes
  // aprobados: uno dado de baja no se muestra en el tablero, así que no
  // tiene por qué ocupar un lugar.
  const result = await getPool().query(
    `SELECT
       (SELECT to_char(max(f.end_date), 'YYYY-MM-DD') FROM teacher_featured f
        WHERE f.teacher_id = $1 AND ${featuredActiveOn('f', '$2')}) AS "activeUntil",
       (SELECT count(*)::int FROM teacher_featured f
        JOIN users u ON u.id = f.teacher_id
        WHERE ${featuredActiveOn('f', '$2')} AND u.approval_status = 'approved') AS active`,
    [teacherId, today]
  );
  const { activeUntil, active } = result.rows[0];
  return { activeUntil, slotsLeft: Math.max(0, MAX_FEATURED_TEACHERS - active) };
}

/**
 * Compra 7 días de Destacado desde hoy. Dos locks porque se cuidan dos cosas: el
 * saldo del docente y el cupo, que es de todos. Si cualquiera pudiera destacarse,
 * "Destacado" dejaría de distinguir a nadie. Devuelve { endDate } o { conflict }.
 *
 * @param {string} teacherId - request.user.id (docente aprobado).
 * @param {string} today - now().iso.
 * @returns {Promise<{endDate: string}|{conflict: string}>}
 * Origen: teacher_featured (activos y INSERT); saldo con findBalance.
 * Lo usa: routes/neuronas/index.js (POST /featured).
 * Locks/transacción: transacción propia; 'neuronas:' || teacherId y después 'neuronas-featured'.
 */
export async function buyFeatured(teacherId, today) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockUser(client, teacherId);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('neuronas-featured'))`);

    // FILTRO: como findFeaturedStatus, solo los vigentes de docentes aprobados
    // (quien compra lo es: la ruta lo exige).
    const active = await client.query(
      `SELECT f.teacher_id AS "teacherId"
       FROM teacher_featured f
       JOIN users u ON u.id = f.teacher_id
       WHERE ${featuredActiveOn('f', '$1')} AND u.approval_status = 'approved'`,
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
