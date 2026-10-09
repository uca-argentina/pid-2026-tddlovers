import { getPool } from './pool.js';

// Paquetes de clases. Las reglas (cuántas quedan, si sirve para reservar)
// viven en lib/classPacks.js; acá se lee y se escribe.

const OFFER_COLUMNS = `
  p.id,
  p.teacher_id AS "teacherId",
  p.class_count AS "classCount",
  p.class_minutes AS "classMinutes",
  p.price_cents AS "priceCents",
  p.validity_days AS "validityDays",
  p.created_at AS "createdAt"
`;

/** Los paquetes que el docente ofrece hoy, para su pantalla. */
export async function listTeacherOffers(teacherId) {
  const result = await getPool().query(
    `SELECT ${OFFER_COLUMNS}
     FROM class_packs p
     WHERE p.teacher_id = $1 AND p.active
     ORDER BY p.class_count, p.price_cents`,
    [teacherId]
  );
  return result.rows;
}

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
 */
export async function listOffers({ teacherId } = {}) {
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
 */
export async function listStudentPacks({ studentId, teacherId = null, excludeClassId = null }) {
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
 * Registra la compra. Cantidad, duración y precio se COPIAN del paquete: si
 * el docente lo cambia o lo deja de ofrecer después, lo comprado no se mueve.
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
