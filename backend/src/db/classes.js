import { getPool } from './pool.js';
import { formatAddress } from '../lib/addresses.js';
import { toMinutes } from '../lib/availabilityExpansion.js';
import { StudentPack } from '../lib/classPacks.js';
import { now } from '../lib/clock.js';
import { VACATION_MESSAGE } from '../lib/vacations.js';
import { hasBalanceFor, syncTurnCredits } from './neuronas.js';
import { findStudentPack } from './packs.js';
import { isTeacherOnVacation } from './vacations.js';

// Las reservas: leerlas, reservar, reprogramar y cambiarles el estado.
// Tablas: classes (migración 004; rehecha en 006 con availability_id,
// modality, max_students, meeting_url, address; locality de 008; price_cents
// de 009; paid_at, cancelled_at, cancelled_by, cancel_reason y
// rescheduled_from de 010; student_pack_id de 014; pack_tokens de 015;
// reward_type y reward_neuronas de 021). Lee subjects y users (002),
// class_materials y class_material_files (018). Vía otros módulos:
// student_packs (db/packs.js), teacher_vacations (db/vacations.js) y
// neurona_credits (db/neuronas.js).
// Locks de una reserva, en este orden (pg_advisory_xact_lock*):
//   1. 'vacations:' || teacherId  COMPARTIDO (createVacation lo toma exclusivo)
//   2. 'pack:' || studentPackId   solo si la reserva usa paquete
//   3. 'classes:' || teacherId || date   cupo y grupales del turno
// Además, las exclusion constraints classes_teacher_no_overlap y
// classes_student_no_overlap (WHERE status <> 'cancelada') deciden los choques.
// Lo usan: routes/classes, routes/availability y routes/homework.

// La fila tal como la espera el front (ver CLAUDE.md en la raíz): fechas
// 'YYYY-MM-DD' y horas 'HH:MM', sin zona horaria. Mandar un timestamp UTC
// correría el día para nuestros usuarios.
// FILTRO: `hasMaterial` solo es true para reservas que pudieron darse
// (aceptada/confirmada/realizada/no_presentada): una cancelada no muestra el
// material que se cargó después para quien tomó ese mismo horario.
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
  c.status,
  c.availability_id AS "availabilityId",
  c.modality,
  c.max_students AS "maxStudents",
  c.meeting_url AS "meetingUrl",
  c.address,
  c.locality,
  c.price_cents AS "priceCents",
  c.paid_at AS "paidAt",
  c.cancelled_by AS "cancelledBy",
  c.cancel_reason AS "cancelReason",
  c.rescheduled_from AS "rescheduledFrom",
  c.student_pack_id AS "studentPackId",
  c.pack_tokens AS "packTokens",
  c.reward_type AS "rewardType",
  c.reward_neuronas AS "rewardNeuronas",
  (
    -- Cuántos hay anotados en ese turno (una grupal son varias filas con el
    -- mismo docente, fecha e inicio). Un número y no nombres: el alumno ve
    -- cuánta gente va a haber, no quién.
    SELECT count(*)::int FROM classes o
    WHERE o.teacher_id = c.teacher_id AND o.class_date = c.class_date
      AND o.start_time = c.start_time AND o.status <> 'cancelada'
  ) AS enrolled,
  (
    -- Si el turno tiene material (resumen o archivos), para marcarlo en la
    -- tarjeta. El material es del turno, no de la fila: ver migración 018.
    -- Solo para reservas que pudieron darse (como checkViewMaterial): una
    -- cancelada de A no tiene que mostrar el material que después se cargó
    -- para B, que tomó ese mismo horario.
    c.status IN ('aceptada', 'confirmada', 'realizada', 'no_presentada') AND EXISTS (
      SELECT 1 FROM class_materials m
      WHERE m.teacher_id = c.teacher_id AND m.class_date = c.class_date
        AND m.start_time = c.start_time
        AND (m.summary <> '' OR EXISTS (
          SELECT 1 FROM class_material_files f
          WHERE f.teacher_id = m.teacher_id AND f.class_date = m.class_date
            AND f.start_time = m.start_time
        ))
    )
  ) AS "hasMaterial"
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
 *
 * @param {object} args
 * @param {string} args.userId - request.user.id.
 * @param {string} args.role - request.user.role: 'teacher' filtra por teacher_id, si no por student_id.
 * @param {string} args.from - query.from ('YYYY-MM-DD', inclusive).
 * @param {string} args.to - query.to (inclusive).
 * @param {string} [args.status] - query.status, un class_status ya validado.
 * @returns {Promise<Array<object>>} filas con CLASS_COLUMNS (id, date, startTime,
 *   endTime, subjectId, subjectName, teacherId, teacherName, studentId,
 *   studentName, status, …, enrolled, hasMaterial), sin filtrar la dirección:
 *   eso lo hace forViewer en la ruta.
 * Origen: classes + subjects + users (docente y alumno) + class_materials/files.
 * Lo usa: routes/classes/index.js (GET /api/classes).
 */
export async function findClassesForUser({ userId, role, from, to, status }) {
  // FILTRO: solo las del usuario de la sesión (como docente las que da, como
  // alumno las que reservó), del rango y, si viene, del estado pedido. Nadie
  // ve la agenda de otro.
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
 * Los turnos ya tomados de un rango, de cualquier docente. NO va a una ruta:
 * la usa la expansión de disponibilidad para restar lo reservado. Una grupal
 * con tres alumnos es UN turno con enrolled 3 — el mismo docente, la misma
 * hora, la misma materia y duración. Devuelve lo mínimo, no datos de nadie:
 * el nombre de la materia hace falta para ofrecer sumarse a una grupal.
 *
 * `maxStudents` y `modality` son los COPIADOS en las filas del turno al
 * reservar (todas tienen la misma copia, ver insertClass): sumarse se mide
 * contra eso y no contra la ventana actual, que el docente pudo haber editado.
 *
 * @param {{from: string, to: string}} rango - query de GET /api/availability.
 * @returns {Promise<Array<{teacherId, date, start, end, subjectId, subjectName, enrolled,
 *   maxStudents, modality}>>}
 * Origen: classes (no canceladas) + subjects, agrupadas por turno.
 * Lo usa: routes/availability/index.js (se le pasa a bookableRows).
 */
export async function findTakenSlots({ from, to }) {
  // FILTRO: las canceladas no ocupan el horario del docente.
  const result = await getPool().query(
    `SELECT c.teacher_id AS "teacherId",
            to_char(c.class_date, 'YYYY-MM-DD') AS date,
            to_char(c.start_time, 'HH24:MI') AS start,
            to_char(c.end_time, 'HH24:MI') AS "end",
            c.subject_id AS "subjectId",
            s.name AS "subjectName",
            count(*)::int AS enrolled,
            max(c.max_students)::int AS "maxStudents",
            c.modality
     FROM classes c
     JOIN subjects s ON s.id = c.subject_id
     WHERE c.status <> 'cancelada' AND c.class_date BETWEEN $1::date AND $2::date
     GROUP BY c.teacher_id, c.class_date, c.start_time, c.end_time, c.subject_id, s.name,
              c.modality`,
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
 *
 * @param {object} args - userId (request.user.id), role ('student' desde la
 *   ruta), date/startTime/endTime de la reserva validada y excludeId (la
 *   clase vieja al reprogramar).
 * @returns {Promise<boolean>}
 * Origen: classes no canceladas.
 * Lo usa: routes/classes/index.js (checkWindowSlot).
 */
export async function hasOverlappingClass({ userId, role, date, startTime, endTime, excludeId = null }) {
  const column = role === 'teacher' ? 'teacher_id' : 'student_id';
  // excludeId: al reprogramar, la clase vieja se va a cancelar en la misma
  // transacción, así que no cuenta como choque.
  const result = await getPool().query(
    `SELECT 1 FROM classes
     WHERE ${column} = $1 AND class_date = $2::date AND status <> 'cancelada'
       AND start_time < $4::time AND end_time > $3::time
       AND ($5::uuid IS NULL OR id <> $5::uuid)
     LIMIT 1`,
    [userId, date, startTime, endTime, excludeId]
  );
  return result.rowCount > 0;
}

/**
 * Una clase por id, con la misma forma que findClassesForUser. No chequea
 * dueño: eso lo hace quien llama.
 *
 * @param {string} id - params.id, o el id recién creado/actualizado.
 * @returns {Promise<object|null>} fila con CLASS_COLUMNS.
 * Origen: classes + subjects + users + class_materials/files.
 * Lo usan: routes/classes/index.js (loadOwnClass y las respuestas),
 *   routes/availability/index.js (clase a reprogramar) y routes/homework/index.js
 *   (validar una clase grupal destino).
 */
export async function findClassById(id) {
  const result = await getPool().query(
    `SELECT ${CLASS_COLUMNS} ${CLASS_JOINS} WHERE c.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

const TAKEN_BY_SOMEONE_ELSE = 'Ese horario ya fue reservado por otra persona.';

/**
 * Reserva una clase en una ventana. El alumno eligió materia, inicio y
 * duración; si ya hay una clase del docente que arranca a esa hora, es
 * sumarse a ella, y eso solo se puede en una grupal, con cupo, y eligiendo la
 * MISMA materia y duración (es la misma clase, no otra a la misma hora).
 *
 * La restricción de exclusión de la tabla deja pasar dos filas del docente
 * con el mismo inicio aunque terminen distinto, y el cupo tampoco lo puede
 * cuidar (no cuenta filas): todo eso va en una transacción con un lock por
 * docente y fecha, así dos alumnos sumándose al último lugar a la vez no
 * pueden pasar los dos.
 *
 * Modalidad, link y dirección se copian de la ventana, y el precio es el que
 * calculó la ruta con la tarifa de ese momento: si el docente cambia algo
 * después, lo que el alumno ya reservó no se mueve.
 *
 * Devuelve { id } o { conflict } con el mensaje para el alumno.
 *
 * @param {object} booking - armado por validateBooking en routes/classes:
 *   window (fila de findWindowById), studentId (request.user.id), date,
 *   startTime, endTime, subjectId, priceCents (calculado por bookingPriceCents),
 *   studentPackId, packTokens, rewardType, rewardNeuronas.
 * @returns {Promise<{id: string}|{conflict: string}>}
 * Origen: INSERT en classes (ver insertClass).
 * Lo usa: routes/classes/index.js (POST /api/classes).
 * Locks/transacción: transacción propia; lockTeacherVacations (compartido) y
 *   después los de insertClass ('pack:', 'classes:').
 */
export async function bookClass(booking) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockTeacherVacations(client, booking.window.teacherId);
    const created = await insertClass(client, booking);
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
 * classes, podría trabarse con el UPDATE que hace createVacation.
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
    const mine = err.constraint === 'classes_student_no_overlap';
    return { conflict: mine ? 'Ya tenés una clase reservada en ese horario.' : TAKEN_BY_SOMEONE_ELSE };
  }
  throw err;
}

/**
 * El corazón de reservar, adentro de una transacción que abre quien llama:
 * así reprogramar puede cancelar la clase vieja y reservar la nueva de una
 * sola vez. Devuelve { id } o { conflict }; con conflict, quien llama hace
 * ROLLBACK.
 *
 * Re-chequea bajo lock lo que la ruta ya miró: lugar en el paquete, saldo de
 * neuronas, licencia, y el cupo/materia/duración si se suma a una grupal.
 *
 * @param {pg.PoolClient} client - transacción abierta por bookClass o rescheduleClass.
 * @param {object} booking - ver bookClass; rescheduledFrom = id de la clase vieja.
 * @returns {Promise<{id: string}|{conflict: string}>}
 * Origen: lee classes del turno; INSERT en classes.
 * Locks/transacción: 'pack:' (reservePackSlot, si hay paquete) y
 *   'classes:' || teacherId || date.
 */
async function insertClass(
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
      excludeClassId: rescheduledFrom,
    });
    if (packConflict) return { conflict: packConflict };
  }

  // La ruta ya miró el saldo, pero el alumno puede estar gastando lo mismo en
  // otra pestaña. Al reprogramar la clase vieja ya se canceló, así que su canje
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

  // Si el turno ya tiene alumnos, se lee también lo que se les copió a ellos
  // (modalidad, cupo, link, dirección): quien se suma tiene que recibir lo
  // mismo. Si se copiara de la ventana actual y el docente la editó entre una
  // reserva y otra, el mismo turno quedaría con filas distintas (otro link,
  // otro cupo) y el cupo se mediría contra un número que los primeros no
  // aceptaron. Todas las filas del turno tienen la misma copia, así que
  // alcanza con una.
  const existing = await client.query(
    `SELECT to_char(end_time, 'HH24:MI') AS "end", subject_id AS "subjectId",
            count(*) OVER ()::int AS enrolled,
            modality, max_students AS "maxStudents", meeting_url AS "meetingUrl",
            address, locality
     FROM classes
     WHERE teacher_id = $1 AND class_date = $2::date AND start_time = $3::time
       AND status <> 'cancelada'
     LIMIT 1`,
    [window.teacherId, date, startTime]
  );
  const group = existing.rows[0];

  if (group) {
    if (group.maxStudents <= 1) return { conflict: TAKEN_BY_SOMEONE_ELSE };
    // La tarifa (y el precio) se buscó en la modalidad de la ventana, pero
    // quien se suma copia la del turno: si el docente cambió la modalidad de
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

  // Lo que se copia en la reserva: lo del turno si ya existe, si no lo de la
  // ventana. La dirección se copia armada: si el docente la edita después, lo
  // reservado no se mueve.
  const snapshot = group
    ? {
        modality: group.modality,
        maxStudents: group.maxStudents,
        meetingUrl: group.meetingUrl,
        address: group.address,
        locality: group.locality,
      }
    : {
        modality: window.modality,
        maxStudents: window.maxStudents,
        meetingUrl: window.meetingUrl,
        address: window.address ? formatAddress(window.address) : null,
        locality: window.address?.locality ?? null,
      };

  const result = await client.query(
    `INSERT INTO classes (
       teacher_id, student_id, subject_id, class_date, start_time, end_time,
       availability_id, modality, max_students, meeting_url, address, locality, price_cents,
       rescheduled_from, student_pack_id, pack_tokens, reward_type, reward_neuronas
     )
     VALUES ($1, $2, $3, $4::date, $5::time, $6::time, $7, $8::class_modality, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18)
     RETURNING id`,
    [
      window.teacherId,
      studentId,
      subjectId,
      date,
      startTime,
      endTime,
      window.id,
      snapshot.modality,
      snapshot.maxStudents,
      snapshot.meetingUrl,
      snapshot.address,
      snapshot.locality,
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
 * `excludeClassId`: al reprogramar, la clase vieja no ocupa lugar. Ya está
 * cancelada en esta transacción, pero se excluye igual para no depender del
 * orden. null si hay lugar, o el mensaje.
 *
 * @returns {Promise<string|null>}
 * Origen: student_packs + sus clases (findStudentPack de db/packs.js).
 * Locks/transacción: 'pack:' || studentPackId, dentro de la transacción de quien llama.
 */
async function reservePackSlot(client, { studentPackId, date, packTokens, minutes, excludeClassId }) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('pack:' || $1))`, [studentPackId]);
  const row = await findStudentPack(client, { id: studentPackId, excludeClassId });
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
 * Origen: UPDATE classes (status 'cancelada', cancel_reason 'vencida').
 * Lo usan: routes/classes/index.js (GET /, loadOwnClass, POST /) y
 *   routes/availability/index.js (GET /).
 */
export async function expireStartedPending({ iso, time }) {
  await getPool().query(
    `UPDATE classes
     SET status = 'cancelada', cancel_reason = 'vencida', cancelled_by = 'teacher',
         cancelled_at = now()
     WHERE status = 'pendiente'
       AND (class_date < $1::date OR (class_date = $1::date AND start_time <= $2::time))`,
    [iso, time]
  );
}

// Cambia el estado de una clase, pero solo si sigue en el estado en que la
// vio la ruta (`from`). `paid` marca el pago, que va aparte del estado.
// `cancelledBy` y `cancelReason` solo tienen sentido al pasar a cancelada.
const TRANSITION_SQL = `
  UPDATE classes
  SET status = $3::class_status,
      paid_at = CASE WHEN $4 THEN now() ELSE paid_at END,
      cancelled_at = CASE WHEN $3::class_status = 'cancelada' THEN now() ELSE cancelled_at END,
      cancelled_by = COALESCE($5::user_role, cancelled_by),
      cancel_reason = COALESCE($6, cancel_reason)
  WHERE id = $1 AND status = $2::class_status AND (NOT $4 OR paid_at IS NULL)
  RETURNING teacher_id AS "teacherId",
            to_char(class_date, 'YYYY-MM-DD') AS date,
            to_char(start_time, 'HH24:MI') AS "startTime"`;

// Solo tomar lista y pagar pueden cambiar quién gana neuronas (aceptar una
// clase cubierta entera también marca el pago). Pasar a realizada o
// no_presentada cubre también salir de una a la otra al corregir la lista.
const affectsNeuronas = ({ to, paid = false }) =>
  paid || to === 'realizada' || to === 'no_presentada';

/**
 * Una transición: true si se aplicó, false si la clase ya no estaba en
 * `from` (en el medio el otro la canceló, y no se pisa).
 *
 * @param {string} id - id de la clase (ya cargada por loadOwnClass).
 * @param {{from, to, paid?, cancelledBy?, cancelReason?}} change - `from` es
 *   el estado leído; el resto sale del `apply` de cada acción en routes/classes.
 * @returns {Promise<boolean>}
 * Lo usa: routes/classes/index.js (POST /:id/{accept,cancel,pay,attendance}).
 * Locks/transacción: la de transitionClasses.
 */
export function transitionClass(id, change) {
  return transitionClasses([{ id, ...change }]);
}

/**
 * Las reservas en pie de un turno (docente, fecha, inicio): en una grupal,
 * una por alumno. Para las acciones sobre la clase entera.
 *
 * @param {{teacherId: string, date: string, startTime: string}} turno - de una clase ya leída.
 * @returns {Promise<Array<object>>} filas con CLASS_COLUMNS, ordenadas por alumno.
 * Origen: classes no canceladas + subjects + users.
 * Lo usan: routes/classes/index.js (POST /:id/turn/:action) y
 *   routes/homework/index.js (destinatarios de una tarea a una clase grupal).
 */
export async function findTurnClasses({ teacherId, date, startTime }) {
  // FILTRO: las canceladas ya no son parte del turno.
  const result = await getPool().query(
    `SELECT ${CLASS_COLUMNS} ${CLASS_JOINS}
     WHERE c.teacher_id = $1 AND c.class_date = $2::date AND c.start_time = $3::time
       AND c.status <> 'cancelada'
     ORDER BY a.nombre, a.apellido`,
    [teacherId, date, startTime]
  );
  return result.rows;
}

/**
 * Varias transiciones, todo o nada: si alguna reserva ya no está en el
 * estado en que la vio la ruta (otro la tocó en el medio), no se cambia
 * ninguna. `changes` = [{ id, from, to, paid, cancelledBy, cancelReason }].
 * true si se aplicaron todas.
 *
 * Las neuronas del turno se recalculan en la misma transacción: si no, una
 * falla dejaría una asistencia o un pago sin sus neuronas. Una vez por turno,
 * después de todas las filas, porque el cálculo mira el turno entero.
 *
 * @param {Array<object>} changes - armados por la ruta a partir de las filas leídas.
 * @returns {Promise<boolean>}
 * Origen: UPDATE classes (TRANSITION_SQL); neurona_credits vía syncTurnCredits.
 * Lo usan: transitionClass (acá) y routes/classes/index.js (POST /:id/turn/:action).
 * Locks/transacción: transacción propia; no toma advisory locks (el UPDATE
 *   condicional a `from` es el control de concurrencia).
 */
export async function transitionClasses(changes) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const turns = new Map();
    for (const change of changes) {
      const { id, from, to, paid = false, cancelledBy = null, cancelReason = null } = change;
      const params = [id, from, to, paid, cancelledBy, cancelReason];
      const result = await client.query(TRANSITION_SQL, params);
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      if (affectsNeuronas(change)) {
        const turn = result.rows[0];
        turns.set(`${turn.teacherId}|${turn.date}|${turn.startTime}`, turn);
      }
    }
    for (const turn of turns.values()) await syncTurnCredits(client, turn);
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
 * Reprogramar: la clase vieja queda cancelada ("reprogramada") y se reserva
 * la nueva, todo en una transacción. Primero se cancela la vieja, así su
 * horario ya está libre si la nueva se pisa con ella (moverla media hora).
 *
 * Devuelve { id } de la nueva o { conflict }.
 *
 * @param {string} oldId - params.id de POST /api/classes/:id/reschedule (clase confirmada).
 * @param {object} booking - de validateBooking con `fixed` = la clase vieja (ver bookClass).
 * @returns {Promise<{id: string}|{conflict: string}>}
 * Origen: UPDATE de la vieja (cancelada/reprogramada) + INSERT de la nueva en classes.
 * Lo usa: routes/classes/index.js.
 * Locks/transacción: transacción propia; lockTeacherVacations y después los de insertClass.
 */
export async function rescheduleClass(oldId, booking) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Antes del UPDATE de la vieja: ver lockTeacherVacations.
    await lockTeacherVacations(client, booking.window.teacherId);
    const cancelled = await client.query(
      `UPDATE classes
       SET status = 'cancelada', cancel_reason = 'reprogramada', cancelled_by = 'student',
           cancelled_at = now()
       WHERE id = $1 AND status = 'confirmada'`,
      [oldId]
    );
    if (cancelled.rowCount === 0) {
      await client.query('ROLLBACK');
      return { conflict: 'La clase cambió mientras la reprogramabas. Volvé a intentar.' };
    }

    const created = await insertClass(client, { ...booking, rescheduledFrom: oldId });
    await client.query(created.conflict ? 'ROLLBACK' : 'COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    return overlapConflict(err);
  } finally {
    client.release();
  }
}
