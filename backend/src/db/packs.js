import { getPool } from './pool.js';

// Paquetes de clases. Las reglas (cuántas quedan, si sirve para reservar)
// viven en lib/classPacks.js; acá se lee y se escribe.
//
// Tablas: class_packs (lo que ofrece el docente) y student_packs (lo que
// compró el alumno), de la migración 014, con class_minutes de 015; lee
// classes.student_pack_id (014) y classes.pack_tokens (015) para las cuentas,
// y users para el nombre y la aprobación del docente.
// Locks: ninguno acá; el 'pack:' || studentPackId lo toma db/classes.js
// (reservePackSlot) antes de llamar a findStudentPack.
// Lo usan: routes/teachers (/me/packs), routes/packs, routes/classes
// (listStudentPacks al reservar) y db/classes.js (findStudentPack).

const OFFER_COLUMNS = `
  p.id,
  p.teacher_id AS "teacherId",
  p.class_count AS "classCount",
  p.class_minutes AS "classMinutes",
  p.price_cents AS "priceCents",
  p.validity_days AS "validityDays",
  p.created_at AS "createdAt"
`;

/**
 * Los paquetes que el docente ofrece hoy (activos), para su pantalla.
 *
 * @param {string} teacherId - request.user.id del docente.
 * @returns {Promise<Array<{id, teacherId, classCount, classMinutes, priceCents,
 *   validityDays, createdAt}>>} (OFFER_COLUMNS).
 * Origen: class_packs WHERE active.
 * Lo usa: routes/teachers/index.js (GET /me/packs).
 */
export async function listTeacherOffers(teacherId) {
  // FILTRO: los desactivados no salen; siguen en la tabla porque los
  // paquetes comprados los referencian.
  const result = await getPool().query(
    `SELECT ${OFFER_COLUMNS}
     FROM class_packs p
     WHERE p.teacher_id = $1 AND p.active
     ORDER BY p.class_count, p.price_cents`,
    [teacherId]
  );
  return result.rows;
}

/**
 * Crea un paquete ofrecido por el docente.
 *
 * @param {string} teacherId - request.user.id.
 * @param {object} oferta - body de POST /api/teachers/me/packs ya validado por
 *   lib/classPacks.js validatePackOffer (classCount, classMinutes, priceCents, validityDays).
 * @returns {Promise<object>} el paquete con la forma de findOfferById.
 * Origen: INSERT en class_packs.
 * Lo usa: routes/teachers/index.js.
 */
export async function createOffer(teacherId, { classCount, classMinutes, priceCents, validityDays }) {
  const result = await getPool().query(
    `INSERT INTO class_packs (teacher_id, class_count, class_minutes, price_cents, validity_days)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [teacherId, classCount, classMinutes, priceCents, validityDays]
  );
  return findOfferById(result.rows[0].id);
}

/**
 * Deja de ofrecerlo. No se borra: los alumnos que ya lo compraron lo siguen
 * usando. true si era de este docente y seguía activo.
 *
 * @param {string} teacherId - request.user.id.
 * @param {string} id - params.id de DELETE /api/teachers/me/packs/:id.
 * @returns {Promise<boolean>}
 * Origen: UPDATE class_packs SET active = false.
 * Lo usa: routes/teachers/index.js.
 */
export async function deactivateOffer(teacherId, id) {
  const result = await getPool().query(
    `UPDATE class_packs SET active = false WHERE id = $1 AND teacher_id = $2 AND active`,
    [id, teacherId]
  );
  return result.rowCount > 0;
}

/**
 * Los paquetes que se pueden comprar, opcionalmente de un docente. Solo de
 * docentes aprobados: uno pendiente o rechazado no vende nada, igual que no
 * recibe reservas.
 *
 * @param {{teacherId?: string}} [filtro] - query.teacherId de GET /api/packs (UUID ya validado).
 * @returns {Promise<Array<object>>} OFFER_COLUMNS + teacherName.
 * Origen: class_packs activos JOIN users aprobados.
 * Lo usa: routes/packs/index.js.
 */
export async function listOffers({ teacherId } = {}) {
  // FILTRO: solo paquetes activos de docentes aprobados: uno pendiente o
  // rechazado no vende nada, igual que no recibe reservas.
  const result = await getPool().query(
    `SELECT ${OFFER_COLUMNS},
            u.nombre || ' ' || u.apellido AS "teacherName"
     FROM class_packs p
     JOIN users u ON u.id = p.teacher_id
     WHERE p.active AND u.approval_status = 'approved'
       AND ($1::uuid IS NULL OR p.teacher_id = $1::uuid)
     ORDER BY u.nombre, u.apellido, p.class_count`,
    [teacherId ?? null]
  );
  return result.rows;
}

/**
 * Un paquete ofrecido, con lo que hace falta para comprarlo: si sigue activo
 * y el estado de aprobación del docente. null si no existe.
 *
 * @param {string} id - params.id de POST /api/packs/:id/buy, o el id recién creado.
 * @returns {Promise<object|null>} OFFER_COLUMNS + active, teacherName, teacherApprovalStatus.
 * Origen: class_packs JOIN users.
 * Lo usan: routes/packs/index.js (comprar) y createOffer (acá).
 */
export async function findOfferById(id) {
  const result = await getPool().query(
    `SELECT ${OFFER_COLUMNS},
            p.active,
            u.nombre || ' ' || u.apellido AS "teacherName",
            u.approval_status AS "teacherApprovalStatus"
     FROM class_packs p
     JOIN users u ON u.id = p.teacher_id
     WHERE p.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

// Un paquete comprado con sus cuentas, en clases del paquete (una reserva
// puede usar más de una: pack_tokens). `attended` son las que usaron las
// reservas realizadas (las que descontaron) y `reserved` las de las reservas
// en curso; ausentes y canceladas no cuentan. `excludeClassId` deja afuera una clase: al
// reprogramar, la vieja se cancela en la misma transacción y no tiene que
// ocupar lugar; `exclude` es el parámetro de la consulta que lo trae.
const studentPackColumns = (exclude = 'NULL') => `
  sp.id,
  sp.pack_id AS "packId",
  sp.teacher_id AS "teacherId",
  t.nombre || ' ' || t.apellido AS "teacherName",
  t.approval_status = 'approved' AS "teacherApproved",
  sp.class_count AS "classCount",
  sp.class_minutes AS "classMinutes",
  sp.price_cents AS "priceCents",
  sp.purchased_at AS "purchasedAt",
  to_char(sp.expires_on, 'YYYY-MM-DD') AS "expiresOn",
  (
    SELECT COALESCE(sum(c.pack_tokens), 0)::int FROM classes c
    WHERE c.student_pack_id = sp.id AND c.status = 'realizada'
  ) AS attended,
  (
    SELECT COALESCE(sum(c.pack_tokens), 0)::int FROM classes c
    WHERE c.student_pack_id = sp.id
      AND c.status IN ('pendiente', 'aceptada', 'confirmada')
      AND (${exclude}::uuid IS NULL OR c.id <> ${exclude}::uuid)
  ) AS reserved
`;

/**
 * Los paquetes que compró el alumno, opcionalmente solo los de un docente.
 * Los más recientes primero.
 *
 * @param {object} args
 * @param {string} args.studentId - request.user.id del alumno.
 * @param {string|null} [args.teacherId] - el docente de la ventana, al reservar.
 * @param {string|null} [args.excludeClassId] - la clase vieja, al reprogramar.
 * @returns {Promise<Array<{id, packId, teacherId, teacherName, teacherApproved, classCount,
 *   classMinutes, priceCents, purchasedAt, expiresOn, attended, reserved}>>} sin
 *   `remaining`/`available`/`usable`: esos los calcula StudentPack (lib/classPacks.js).
 * Origen: student_packs JOIN users + sumas de classes.pack_tokens.
 * Lo usan: routes/packs/index.js (GET /mine) y routes/classes/index.js (priceBooking).
 */
export async function listStudentPacks({ studentId, teacherId = null, excludeClassId = null }) {
  // FILTRO: solo los paquetes del propio alumno (y del docente pedido, al
  // reservar). NO se ocultan los vencidos, agotados o de docentes dados de
  // baja: el alumno tiene que ver lo que compró; `usable` (StudentPack#summary)
  // le dice al front cuáles sirven para reservar.
  const result = await getPool().query(
    `SELECT ${studentPackColumns('$3')}
     FROM student_packs sp
     JOIN users t ON t.id = sp.teacher_id
     WHERE sp.student_id = $1 AND ($2::uuid IS NULL OR sp.teacher_id = $2::uuid)
     ORDER BY sp.purchased_at DESC`,
    [studentId, teacherId, excludeClassId]
  );
  return result.rows;
}

/**
 * Un paquete comprado con sus cuentas, para re-chequear dentro de la
 * transacción de una reserva (db/classes.js), con el paquete ya bloqueado.
 * Las mismas columnas que listStudentPacks: la regla de si queda lugar la
 * decide StudentPack (lib/classPacks.js), no el SQL. null si no existe.
 *
 * @param {pg.PoolClient} client - la transacción de la reserva, con 'pack:' tomado.
 * @param {{id: string, excludeClassId?: string|null}} args - id = booking.studentPackId.
 * @returns {Promise<object|null>} misma forma que listStudentPacks.
 * Lo usa: db/classes.js (reservePackSlot).
 */
export async function findStudentPack(client, { id, excludeClassId = null }) {
  const result = await client.query(
    `SELECT ${studentPackColumns('$2')}
     FROM student_packs sp
     JOIN users t ON t.id = sp.teacher_id
     WHERE sp.id = $1`,
    [id, excludeClassId]
  );
  return result.rows[0] ?? null;
}

/**
 * Registra la compra. Cantidad, duración y precio se COPIAN del paquete: si
 * el docente lo cambia o lo deja de ofrecer después, lo comprado no se mueve.
 * No se cobra nada.
 *
 * @param {object} args
 * @param {object} args.offer - fila de findOfferById (ya chequeada activa y de docente aprobado).
 * @param {string} args.studentId - request.user.id.
 * @param {string} args.expiresOn - 'YYYY-MM-DD' calculado por expiryFor (lib/classPacks.js).
 * @returns {Promise<object>} el paquete comprado, misma forma que listStudentPacks.
 * Origen: INSERT en student_packs y re-lectura.
 * Lo usa: routes/packs/index.js (POST /:id/buy).
 */
export async function buyPack({ offer, studentId, expiresOn }) {
  const result = await getPool().query(
    `INSERT INTO student_packs (
       pack_id, student_id, teacher_id, class_count, class_minutes, price_cents, expires_on
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::date)
     RETURNING id`,
    [
      offer.id,
      studentId,
      offer.teacherId,
      offer.classCount,
      offer.classMinutes,
      offer.priceCents,
      expiresOn,
    ]
  );
  const packs = await getPool().query(
    `SELECT ${studentPackColumns()}
     FROM student_packs sp
     JOIN users t ON t.id = sp.teacher_id
     WHERE sp.id = $1`,
    [result.rows[0].id]
  );
  return packs.rows[0];
}
