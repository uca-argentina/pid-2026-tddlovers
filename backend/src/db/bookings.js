import { getPool } from './pool.js';
import { formatAddress } from '../lib/addresses.js';
import { toMinutes } from '../lib/availabilityExpansion.js';
import { StudentPack } from '../lib/classPacks.js';
import { now } from '../lib/clock.js';
import { VACATION_MESSAGE } from '../lib/vacations.js';
import { hasBalanceFor, syncClassCredits } from './neuronas.js';
import { findStudentPack } from './packs.js';
import { isTeacherOnVacation } from './vacations.js';

// Las reservas: leerlas, reservar, reprogramar y cambiarles el estado.
// Tablas (migración 023): class_bookings = lo de CADA ALUMNO en una clase
// (estado, pago, paquete, canje, cancelación, reprogramación) y classes = la
// CLASE (docente, materia, fecha, horario y lo copiado de la ventana; una
// grupal es una fila). Cada lectura une las dos con BOOKING_JOINS
// (class_bookings b JOIN classes c): `b.` es de la reserva y `c.` de la clase.
// classes.active (tiene alguna reserva no cancelada) lo mantiene el trigger
// class_bookings_sync_active: cancelar una reserva nunca toca classes a mano.
// Lee también subjects y users (002), class_materials y class_material_files
// (018, por class_id desde la 024). Vía otros módulos: student_packs
// (db/packs.js), teacher_vacations (db/vacations.js) y neurona_credits
// (db/neuronas.js). Lo que es de la clase sola está en db/classes.js.
// Locks de una reserva, en este orden (pg_advisory_xact_lock*):
//   1. 'vacations:' || teacherId  COMPARTIDO (createVacation lo toma exclusivo)
//   2. 'pack:' || studentPackId   solo si la reserva usa paquete
//   3. 'classes:' || teacherId || date   crear la clase o sumarse a una grupal
// Además, las exclusion constraints classes_teacher_no_overlap (clases
// activas de un docente) y class_bookings_student_no_overlap (reservas no
// canceladas de un alumno) deciden los choques.
// Lo usan: routes/bookings, routes/classes, routes/availability y routes/homework.

// La fila tal como la espera el front (ver CLAUDE.md en la raíz): fechas
// 'YYYY-MM-DD' y horas 'HH:MM', sin zona horaria. Mandar un timestamp UTC
// correría el día para nuestros usuarios.
// `id` es el de la RESERVA (class_bookings.id): es el que usan
// /api/bookings/:id y ?reprogramar=. `classId` es el de la CLASE
// (classes.id), compartido por todos los alumnos de una grupal: es el que
// usan /api/classes/:classId/… (acciones sobre la clase entera y material).
// FILTRO: `hasMaterial` solo es true para reservas que pudieron darse
// (aceptada/confirmada/realizada/no_presentada): una cancelada no muestra el
// material de su clase.
const BOOKING_COLUMNS = `
  b.id,
  b.class_id AS "classId",
  to_char(c.class_date, 'YYYY-MM-DD') AS date,
  to_char(c.start_time, 'HH24:MI') AS "startTime",
  to_char(c.end_time, 'HH24:MI') AS "endTime",
  c.subject_id AS "subjectId",
  s.name AS "subjectName",
  c.teacher_id AS "teacherId",
  t.nombre || ' ' || t.apellido AS "teacherName",
  b.student_id AS "studentId",
  a.nombre || ' ' || a.apellido AS "studentName",
  b.status,
  c.availability_id AS "availabilityId",
  c.modality,
  c.max_students AS "maxStudents",
  c.meeting_url AS "meetingUrl",
  c.address,
  c.locality,
  b.price_cents AS "priceCents",
  b.paid_at AS "paidAt",
  b.cancelled_by AS "cancelledBy",
  b.cancel_reason AS "cancelReason",
  b.rescheduled_from AS "rescheduledFrom",
  b.student_pack_id AS "studentPackId",
  b.pack_tokens AS "packTokens",
  b.reward_type AS "rewardType",
  b.reward_neuronas AS "rewardNeuronas",
  (
    -- Cuántos hay anotados en esa clase (una reserva no cancelada por
    -- alumno). Un número y no nombres: el alumno ve cuánta gente va a haber,
    -- no quién.
    SELECT count(*)::int FROM class_bookings o
    WHERE o.class_id = b.class_id AND o.status <> 'cancelada'
  ) AS enrolled,
  (
    -- Si la clase tiene material (resumen o archivos), para marcarlo en la
    -- tarjeta. El material es de la clase, no de la reserva (migración 024).
    -- Solo para reservas que pudieron darse (como checkViewMaterial).
    b.status IN ('aceptada', 'confirmada', 'realizada', 'no_presentada') AND EXISTS (
      SELECT 1 FROM class_materials m
      WHERE m.class_id = b.class_id
        AND (m.summary <> '' OR EXISTS (
          SELECT 1 FROM class_material_files f WHERE f.class_id = m.class_id
        ))
    )
  ) AS "hasMaterial"
`;

// Una reserva (b) con su clase (c), la materia y los nombres de docente y alumno.
const BOOKING_JOINS = `
  FROM class_bookings b
  JOIN classes c ON c.id = b.class_id
  JOIN subjects s ON s.id = c.subject_id
  JOIN users t ON t.id = c.teacher_id
  JOIN users a ON a.id = b.student_id
`;

/**
 * Las reservas de UN usuario en un rango. Sirve para las dos pantallas: como
 * docente devuelve las de las clases que da, como alumno las suyas, según el
 * rol de la sesión. Nadie ve la agenda de otro.
 *
 * @param {object} args
 * @param {string} args.userId - request.user.id.
 * @param {string} args.role - request.user.role: 'teacher' filtra por el docente
 *   de la clase, si no por el alumno de la reserva.
 * @param {string} args.from - query.from ('YYYY-MM-DD', inclusive).
 * @param {string} args.to - query.to (inclusive).
 * @param {string} [args.status] - query.status, un booking_status ya validado.
 * @returns {Promise<Array<object>>} filas con BOOKING_COLUMNS (id, classId, date, startTime,
 *   endTime, subjectId, subjectName, teacherId, teacherName, studentId,
 *   studentName, status, …, enrolled, hasMaterial), sin filtrar la dirección:
 *   eso lo hace forViewer en la ruta.
 * Origen: class_bookings + classes + subjects + users (docente y alumno) +
 *   class_materials/files.
 * Lo usa: routes/bookings/index.js (GET /api/bookings).
 */
export async function findBookingsForUser({ userId, role, from, to, status }) {
  // FILTRO: solo las del usuario de la sesión (como docente las de sus
  // clases, como alumno las suyas), del rango y, si viene, del estado pedido.
  // Nadie ve la agenda de otro.
  const ownerColumn = role === 'teacher' ? 'c.teacher_id' : 'b.student_id';
  const result = await getPool().query(
    `SELECT ${BOOKING_COLUMNS}
     ${BOOKING_JOINS}
     WHERE ${ownerColumn} = $1
       AND c.class_date BETWEEN $2::date AND $3::date
       AND ($4::text IS NULL OR b.status = $4::booking_status)
     ORDER BY c.class_date, c.start_time`,
    [userId, from, to, status ?? null]
  );
  return result.rows;
}

/**
 * ¿Este alumno ya tiene una reserva en pie que se pisa con ese horario? Se
 * consulta antes de reservar solo para poder dar un mensaje útil: cuando el
 * alumno se choca consigo mismo, la restricción que salta primero es la del
 * docente y el mensaje quedaría al revés ("lo reservó otra persona").
 *
 * No reemplaza a las restricciones de la tabla: entre este SELECT y el INSERT
 * puede entrar otra transacción. Son ellas las que deciden.
 *
 * @param {object} args - studentId (request.user.id), date/startTime/endTime de
 *   la reserva validada y excludeBookingId (la reserva vieja al reprogramar).
 * @returns {Promise<boolean>}
 * Origen: class_bookings no canceladas (su copia de fecha y horario, que la FK
 *   compuesta mantiene igual a la de la clase).
 * Lo usa: routes/bookings/index.js (checkWindowSlot).
 */
export async function studentHasOverlappingBooking({
  studentId,
  date,
  startTime,
  endTime,
  excludeBookingId = null,
}) {
  // excludeBookingId: al reprogramar, la reserva vieja se va a cancelar en la
  // misma transacción, así que no cuenta como choque.
  const result = await getPool().query(
    `SELECT 1 FROM class_bookings
     WHERE student_id = $1 AND class_date = $2::date AND status <> 'cancelada'
       AND start_time < $4::time AND end_time > $3::time
       AND ($5::uuid IS NULL OR id <> $5::uuid)
     LIMIT 1`,
    [studentId, date, startTime, endTime, excludeBookingId]
  );
  return result.rowCount > 0;
}

/**
 * Una reserva por id, con la misma forma que findBookingsForUser. No chequea
 * dueño: eso lo hace quien llama.
 *
 * @param {string} id - params.id de /api/bookings/:id, o el id recién creado/actualizado.
 * @returns {Promise<object|null>} fila con BOOKING_COLUMNS.
 * Origen: class_bookings + classes + subjects + users + class_materials/files.
 * Lo usan: routes/bookings/index.js (loadOwnBooking y las respuestas) y
 *   routes/availability/index.js (la reserva que se reprograma).
 */
export async function findBookingById(id) {
  const result = await getPool().query(
    `SELECT ${BOOKING_COLUMNS} ${BOOKING_JOINS} WHERE b.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

const TAKEN_BY_SOMEONE_ELSE = 'Ese horario ya fue reservado por otra persona.';

/**
 * Reserva un lugar en una clase de una ventana. El alumno eligió materia, inicio y
 * duración; si ya hay una clase del docente que arranca a esa hora, es
 * sumarse a ella, y eso solo se puede en una grupal, con cupo, y eligiendo la
 * MISMA materia y duración (es la misma clase, no otra a la misma hora).
 *
 * El cupo no lo puede cuidar ninguna restricción (no cuenta filas): va en
 * una transacción con un lock por docente y fecha, así dos alumnos sumándose
 * al último lugar a la vez no pueden pasar los dos.
 *
 * Modalidad, link y dirección se copian de la ventana al crear la clase, y el
 * precio de cada reserva es el que calculó la ruta con la tarifa de ese
 * momento: si el docente cambia algo después, lo ya reservado no se mueve.
 *
 * Devuelve { id } o { conflict } con el mensaje para el alumno.
 *
 * @param {object} booking - armado por validateBooking en routes/bookings:
 *   window (fila de findWindowById), studentId (request.user.id), date,
 *   startTime, endTime, subjectId, priceCents (calculado por bookingPriceCents),
 *   studentPackId, packTokens, rewardType, rewardNeuronas.
 * @returns {Promise<{id: string}|{conflict: string}>}
 * Origen: INSERT en class_bookings, y en classes si es la primera reserva (ver insertBooking).
 * Lo usa: routes/bookings/index.js (POST /api/bookings).
 * Locks/transacción: transacción propia; lockTeacherVacations (compartido) y
 *   después los de insertBooking ('pack:', 'classes:').
 */
export async function createBooking(booking) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockTeacherVacations(client, booking.window.teacherId);
    const created = await insertBooking(client, booking);
    await client.query(created.conflict ? 'ROLLBACK' : 'COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    return overlapConflict(err);
  } finally {
    client.release();
  }
}

/**
 * El lock de licencias del docente, compartido: varias reservas pueden ir a
 * la vez, pero createVacation (db/vacations.js) lo toma exclusivo, así que
 * una licencia y una reserva de ese docente no se cruzan. Sin esto, una
 * reserva que miró "no hay licencia" antes de que se guardara quedaba viva en
 * un día de licencia, porque el UPDATE que cancela no la veía todavía.
 *
 * Va primero en la transacción: si se tomara después de tocar filas de
 * class_bookings, podría trabarse con el UPDATE que hace createVacation.
 */
async function lockTeacherVacations(client, teacherId) {
  // La misma forma de hash que createVacation, o serían locks distintos.
  await client.query(`SELECT pg_advisory_xact_lock_shared(hashtext('vacations:' || $1))`, [
    teacherId,
  ]);
}

/**
 * Traduce una violación de las restricciones de exclusión al mensaje para el
 * alumno; cualquier otro error sigue de largo.
 *
 * @returns {{conflict: string}} o tira el error original.
 */
function overlapConflict(err) {
  // 23P01 = exclusion_violation: alguien ya tiene ese horario.
  if (err.code === '23P01') {
    const mine = err.constraint === 'class_bookings_student_no_overlap';
    return { conflict: mine ? 'Ya tenés una clase reservada en ese horario.' : TAKEN_BY_SOMEONE_ELSE };
  }
  throw err;
}

/**
 * El corazón de reservar, adentro de una transacción que abre quien llama:
 * así reprogramar puede cancelar la reserva vieja y crear la nueva de una
 * sola vez. Devuelve { id } o { conflict }; con conflict, quien llama hace
 * ROLLBACK.
 *
 * Re-chequea bajo lock lo que la ruta ya miró: lugar en el paquete, saldo de
 * neuronas, licencia, y el cupo/materia/duración si se suma a una grupal.
 *
 * @param {pg.PoolClient} client - transacción abierta por createBooking o rescheduleBooking.
 * @param {object} booking - ver createBooking; rescheduledFrom = id de la reserva vieja.
 * @returns {Promise<{id: string}|{conflict: string}>}
 * Origen: lee la clase en pie de ese horario (classes activa); INSERT en
 *   classes (si no hay) y en class_bookings.
 * Locks/transacción: 'pack:' (reservePackSlot, si hay paquete) y
 *   'classes:' || teacherId || date.
 */
async function insertBooking(
  client,
  {
    window,
    studentId,
    date,
    startTime,
    endTime,
    subjectId,
    priceCents,
    rescheduledFrom = null,
    studentPackId = null,
    packTokens = 0,
    rewardType = null,
    rewardNeuronas = 0,
  }
) {
  if (studentPackId) {
    const packConflict = await reservePackSlot(client, {
      studentPackId,
      date,
      packTokens,
      minutes: toMinutes(endTime) - toMinutes(startTime),
      excludeBookingId: rescheduledFrom,
    });
    if (packConflict) return { conflict: packConflict };
  }

  // La ruta ya miró el saldo, pero el alumno puede estar gastando lo mismo en
  // otra pestaña. Al reprogramar la reserva vieja ya se canceló, así que su canje
  // ya volvió al saldo.
  if (rewardType && !(await hasBalanceFor(client, studentId, rewardNeuronas))) {
    return { conflict: 'No te alcanzan las neuronas.' };
  }

  await client.query(`SELECT pg_advisory_xact_lock(hashtext('classes:' || $1 || $2))`, [
    window.teacherId,
    date,
  ]);

  // La ruta ya lo chequeó, pero el docente puede haber cargado la licencia
  // entre ese chequeo y esta reserva. Con el lock de licencias tomado al
  // empezar la transacción, lo que se lee acá ya no cambia hasta el COMMIT.
  if (await isTeacherOnVacation(window.teacherId, date, client)) {
    return { conflict: VACATION_MESSAGE };
  }

  // ¿Ya hay una clase en pie que arranca a esa hora? Entonces es sumarse a
  // ella: se mide contra SU cupo y modalidad, no contra la ventana actual,
  // que el docente pudo haber editado desde la primera reserva.
  const existing = await client.query(
    `SELECT c.id, to_char(c.end_time, 'HH24:MI') AS "end", c.subject_id AS "subjectId",
            c.modality, c.max_students AS "maxStudents",
            (SELECT count(*)::int FROM class_bookings b
             WHERE b.class_id = c.id AND b.status <> 'cancelada') AS enrolled
     FROM classes c
     WHERE c.teacher_id = $1 AND c.class_date = $2::date AND c.start_time = $3::time
       AND c.active`,
    [window.teacherId, date, startTime]
  );
  const group = existing.rows[0];

  if (group) {
    if (group.maxStudents <= 1) return { conflict: TAKEN_BY_SOMEONE_ELSE };
    // La tarifa (y el precio) se buscó en la modalidad de la ventana, pero
    // quien se suma toma la de la clase: si el docente cambió la modalidad de
    // la ventana, se pagaría una y se tomaría otra.
    if (group.modality !== window.modality) {
      return {
        conflict:
          'Esa clase grupal se da en otra modalidad que este horario del docente. Elegí otro horario.',
      };
    }
    if (String(group.subjectId) !== String(subjectId) || group.end !== endTime) {
      return {
        conflict:
          'A esa hora ya hay una clase grupal de otra materia o duración. Sumate a esa o elegí otro horario.',
      };
    }
    if (group.enrolled >= group.maxStudents) return { conflict: 'La clase grupal ya se llenó.' };
  }

  // Primera reserva de ese horario: se crea la clase con lo de la ventana. La
  // dirección se copia armada: si el docente la edita después, la clase no se
  // mueve. Si se pisa con otra clase del docente, salta
  // classes_teacher_no_overlap (ver overlapConflict).
  const classId = group
    ? group.id
    : (
        await client.query(
          `INSERT INTO classes (
             teacher_id, subject_id, class_date, start_time, end_time,
             availability_id, modality, max_students, meeting_url, address, locality
           )
           VALUES ($1, $2, $3::date, $4::time, $5::time, $6, $7::class_modality, $8, $9, $10, $11)
           RETURNING id`,
          [
            window.teacherId,
            subjectId,
            date,
            startTime,
            endTime,
            window.id,
            window.modality,
            window.maxStudents,
            window.meetingUrl,
            window.address ? formatAddress(window.address) : null,
            window.address?.locality ?? null,
          ]
        )
      ).rows[0].id;

  // La reserva del alumno. Fecha y horario se copian de la clase (la FK
  // compuesta lo exige) para que class_bookings_student_no_overlap pueda
  // frenar dos clases superpuestas del mismo alumno.
  const result = await client.query(
    `INSERT INTO class_bookings (
       class_id, student_id, class_date, start_time, end_time, price_cents,
       rescheduled_from, student_pack_id, pack_tokens, reward_type, reward_neuronas
     )
     SELECT c.id, $2, c.class_date, c.start_time, c.end_time, $3, $4, $5, $6, $7, $8
     FROM classes c WHERE c.id = $1
     RETURNING id`,
    [
      classId,
      studentId,
      priceCents,
      rescheduledFrom,
      studentPackId,
      packTokens,
      rewardType,
      rewardNeuronas,
    ]
  );
  return { id: result.rows[0].id };
}

/**
 * La ruta ya eligió el paquete y chequeó que le queden clases, pero entre ese
 * chequeo y el INSERT el alumno puede estar reservando otra clase con el
 * mismo paquete en otra pestaña (otro día, así que el lock por docente y
 * fecha no los frena). Acá se vuelve a contar con el paquete bloqueado, con
 * la misma regla que la ruta (StudentPack): vive en un solo lugar.
 *
 * `excludeBookingId`: al reprogramar, la reserva vieja no ocupa lugar. Ya está
 * cancelada en esta transacción, pero se excluye igual para no depender del
 * orden. null si hay lugar, o el mensaje.
 *
 * @returns {Promise<string|null>}
 * Origen: student_packs + sus clases (findStudentPack de db/packs.js).
 * Locks/transacción: 'pack:' || studentPackId, dentro de la transacción de quien llama.
 */
async function reservePackSlot(
  client,
  { studentPackId, date, packTokens, minutes, excludeBookingId }
) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('pack:' || $1))`, [studentPackId]);
  const row = await findStudentPack(client, { id: studentPackId, excludeBookingId });
  if (!row) return 'Tu paquete ya no sirve para esa fecha.';
  const problem = new StudentPack(row).bookingProblem({
    date,
    today: now().iso,
    tokens: packTokens,
    minutes,
  });
  return problem ? problem.message : null;
}

/**
 * Las pendientes que llegaron a su hora sin que el docente respondiera pasan
 * a canceladas, como si el docente las hubiera cancelado justo al empezar.
 *
 * Sin cron: se llama antes de leer o tocar clases. Nadie mira una clase sin
 * pasar por ahí, así que da lo mismo que se actualice "tarde".
 *
 * @param {{iso: string, time: string}} ahora - now() de lib/clock.js (hora argentina).
 * @returns {Promise<void>}
 * Origen: UPDATE class_bookings (status 'cancelada', cancel_reason 'vencida'); usa
 *   la copia de fecha y horario de la reserva, que la FK mantiene igual a la clase.
 * Lo usan: routes/bookings/index.js (GET /, loadOwnBooking, POST /),
 *   routes/classes/index.js (loadOwnClass) y routes/availability/index.js (GET /).
 */
export async function expireStartedPending({ iso, time }) {
  await getPool().query(
    `UPDATE class_bookings
     SET status = 'cancelada', cancel_reason = 'vencida', cancelled_by = 'teacher',
         cancelled_at = now()
     WHERE status = 'pendiente'
       AND (class_date < $1::date OR (class_date = $1::date AND start_time <= $2::time))`,
    [iso, time]
  );
}

// Cambia el estado de una reserva, pero solo si sigue en el estado en que la
// vio la ruta (`from`). `paid` marca el pago, que va aparte del estado.
// `cancelledBy` y `cancelReason` solo tienen sentido al pasar a cancelada.
// Devuelve su clase (id, docente, fecha, inicio), para recalcular las neuronas.
const TRANSITION_SQL = `
  UPDATE class_bookings b
  SET status = $3::booking_status,
      paid_at = CASE WHEN $4 THEN now() ELSE b.paid_at END,
      cancelled_at = CASE WHEN $3::booking_status = 'cancelada' THEN now() ELSE b.cancelled_at END,
      cancelled_by = COALESCE($5::user_role, b.cancelled_by),
      cancel_reason = COALESCE($6, b.cancel_reason)
  FROM classes c
  WHERE b.id = $1 AND c.id = b.class_id
    AND b.status = $2::booking_status AND (NOT $4 OR b.paid_at IS NULL)
  RETURNING c.id AS "classId",
            c.teacher_id AS "teacherId",
            to_char(c.class_date, 'YYYY-MM-DD') AS date,
            to_char(c.start_time, 'HH24:MI') AS "startTime"`;

// Solo tomar lista y pagar pueden cambiar quién gana neuronas (aceptar una
// clase cubierta entera también marca el pago). Pasar a realizada o
// no_presentada cubre también salir de una a la otra al corregir la lista.
const affectsNeuronas = ({ to, paid = false }) =>
  paid || to === 'realizada' || to === 'no_presentada';

/**
 * Una transición: true si se aplicó, false si la reserva ya no estaba en
 * `from` (en el medio el otro la canceló, y no se pisa).
 *
 * @param {string} id - id de la reserva (ya cargada por loadOwnBooking).
 * @param {{from, to, paid?, cancelledBy?, cancelReason?}} change - `from` es
 *   el estado leído; el resto sale del `apply` de cada acción (lib/bookingStates.js).
 * @returns {Promise<boolean>}
 * Lo usa: routes/bookings/index.js (POST /:id/{accept,cancel,pay,attendance}).
 * Locks/transacción: la de transitionBookings.
 */
export function transitionBooking(id, change) {
  return transitionBookings([{ id, ...change }]);
}

/**
 * La reserva de un alumno en una clase, o null si no tiene. Si tuvo más de una
 * (canceló y volvió a reservar), la que sigue en pie; si no, la más nueva.
 * Incluye canceladas: así la ruta le explica por qué no ve el material en vez
 * de decirle que la clase no existe.
 *
 * @param {string} classId - params.classId de /api/classes/:classId/….
 * @param {string} studentId - request.user.id.
 * @returns {Promise<object|null>} fila con BOOKING_COLUMNS.
 * Origen: class_bookings + classes + subjects + users.
 * Lo usa: routes/classes/index.js (loadOwnClass).
 */
export async function findStudentBooking(classId, studentId) {
  const result = await getPool().query(
    `SELECT ${BOOKING_COLUMNS} ${BOOKING_JOINS}
     WHERE b.class_id = $1 AND b.student_id = $2
     ORDER BY (b.status <> 'cancelada') DESC, b.created_at DESC
     LIMIT 1`,
    [classId, studentId]
  );
  return result.rows[0] ?? null;
}

/**
 * Las reservas en pie de una clase: en una grupal, una por alumno. Para las
 * acciones sobre la clase entera y para saber a quién va una tarea.
 *
 * @param {string} classId - classes.id (el `classId` de una reserva ya leída).
 * @returns {Promise<Array<object>>} filas con BOOKING_COLUMNS, ordenadas por alumno.
 * Origen: class_bookings no canceladas + classes + subjects + users.
 * Lo usan: routes/classes/index.js (POST /:classId/{accept,cancel}) y
 *   routes/homework/index.js (destinatarios de una tarea a una clase grupal).
 */
export async function findClassBookings(classId) {
  // FILTRO: las reservas canceladas ya no son parte de la clase.
  const result = await getPool().query(
    `SELECT ${BOOKING_COLUMNS} ${BOOKING_JOINS}
     WHERE b.class_id = $1 AND b.status <> 'cancelada'
     ORDER BY a.nombre, a.apellido`,
    [classId]
  );
  return result.rows;
}

/**
 * Varias transiciones, todo o nada: si alguna reserva ya no está en el
 * estado en que la vio la ruta (otro la tocó en el medio), no se cambia
 * ninguna. `changes` = [{ id, from, to, paid, cancelledBy, cancelReason }].
 * true si se aplicaron todas.
 *
 * Las neuronas de la clase se recalculan en la misma transacción: si no, una
 * falla dejaría una asistencia o un pago sin sus neuronas. Una vez por clase,
 * después de todas sus reservas, porque el cálculo mira la clase entera.
 *
 * @param {Array<object>} changes - armados por la ruta a partir de las filas leídas.
 * @returns {Promise<boolean>}
 * Origen: UPDATE class_bookings (TRANSITION_SQL); neurona_credits vía syncClassCredits.
 * Lo usan: transitionBooking (acá) y routes/classes/index.js (POST /:classId/{accept,cancel}).
 * Locks/transacción: transacción propia; no toma advisory locks (el UPDATE
 *   condicional a `from` es el control de concurrencia).
 */
export async function transitionBookings(changes) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const touched = new Map();
    for (const change of changes) {
      const { id, from, to, paid = false, cancelledBy = null, cancelReason = null } = change;
      const params = [id, from, to, paid, cancelledBy, cancelReason];
      const result = await client.query(TRANSITION_SQL, params);
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      if (affectsNeuronas(change)) {
        const cls = result.rows[0];
        touched.set(cls.classId, cls);
      }
    }
    for (const cls of touched.values()) await syncClassCredits(client, cls);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reprogramar: la reserva vieja queda cancelada ("reprogramada") y se reserva
 * la nueva, todo en una transacción. Primero se cancela la vieja, así su
 * horario ya está libre si la nueva se pisa con ella (moverla media hora).
 *
 * Devuelve { id } de la nueva o { conflict }.
 *
 * @param {string} oldId - params.id de POST /api/bookings/:id/reschedule (reserva confirmada).
 * @param {object} booking - de validateBooking con `fixed` = la reserva vieja (ver createBooking).
 * @returns {Promise<{id: string}|{conflict: string}>}
 * Origen: UPDATE de la vieja en class_bookings (cancelada/reprogramada) + la nueva
 *   reserva (insertBooking).
 * Lo usa: routes/bookings/index.js.
 * Locks/transacción: transacción propia; lockTeacherVacations y después los de insertBooking.
 */
export async function rescheduleBooking(oldId, booking) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Antes del UPDATE de la vieja: ver lockTeacherVacations.
    await lockTeacherVacations(client, booking.window.teacherId);
    const cancelled = await client.query(
      `UPDATE class_bookings
       SET status = 'cancelada', cancel_reason = 'reprogramada', cancelled_by = 'student',
           cancelled_at = now()
       WHERE id = $1 AND status = 'confirmada'`,
      [oldId]
    );
    if (cancelled.rowCount === 0) {
      await client.query('ROLLBACK');
      return { conflict: 'La clase cambió mientras la reprogramabas. Volvé a intentar.' };
    }

    const created = await insertBooking(client, { ...booking, rescheduledFrom: oldId });
    await client.query(created.conflict ? 'ROLLBACK' : 'COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    return overlapConflict(err);
  } finally {
    client.release();
  }
}
