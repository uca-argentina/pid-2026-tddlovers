import { getPool } from './pool.js';

// Las direcciones del docente (migración 019). Las guardadas (saved) son las
// del perfil; las sueltas son de una sola ventana y las maneja
// db/availability.js. Qué es válido lo decide lib/addresses.js.

// La dirección como la espera el front. `ta` es el alias de teacher_addresses.
export const ADDRESS_COLUMNS = `
  ta.id,
  ta.label,
  ta.street,
  ta.number,
  ta.postal_code AS "postalCode",
  ta.locality,
  ta.city,
  ta.floor,
  ta.apartment,
  ta.notes,
  ta.saved,
  ta.is_default AS "isDefault"
`;

// La misma dirección como un objeto JSON, para colgarla de una ventana.
export const ADDRESS_JSON = `
  json_build_object(
    'id', ta.id,
    'label', ta.label,
    'street', ta.street,
    'number', ta.number,
    'postalCode', ta.postal_code,
    'locality', ta.locality,
    'city', ta.city,
    'floor', ta.floor,
    'apartment', ta.apartment,
    'notes', ta.notes,
    'saved', ta.saved,
    'isDefault', ta.is_default
  )
`;

const VALUES = (a) => [
  a.label,
  a.street,
  a.number,
  a.postalCode,
  a.locality,
  a.city,
  a.floor,
  a.apartment,
  a.notes,
];

/** Las guardadas del docente: la predeterminada primero, después por nombre. */
export async function listSavedAddresses(teacherId) {
  const result = await getPool().query(
    `SELECT ${ADDRESS_COLUMNS}
     FROM teacher_addresses ta
     WHERE ta.teacher_id = $1 AND ta.saved
     ORDER BY ta.is_default DESC, lower(ta.label), ta.created_at`,
    [teacherId]
  );
  return result.rows;
}

async function selectAddress(client, teacherId, id) {
  const result = await client.query(
    `SELECT ${ADDRESS_COLUMNS} FROM teacher_addresses ta WHERE ta.id = $1 AND ta.teacher_id = $2`,
    [id, teacherId]
  );
  return result.rows[0] ?? null;
}

/**
 * Los locks de las direcciones del docente, siempre en este orden: primero
 * el de sus ventanas (el mismo que toma db/availability.js) y después el de
 * sus direcciones. Con el mismo orden en todos lados no hay deadlock:
 *   - elegir la predeterminada son dos UPDATE (sacar la vieja, poner la
 *     nueva) que dos pedidos a la vez pisarían contra el índice único;
 *   - borrar cuenta las ventanas que la usan, y una ventana creada en el
 *     medio haría que la FK frene el DELETE con un error sin mensaje.
 * db/availability.js también lo usa cuando una ventana crea una dirección.
 */
export async function lockAddresses(client, teacherId) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('availability:' || $1))`, [teacherId]);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('addresses:' || $1))`, [teacherId]);
}

async function withAddressLock(teacherId, work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockAddresses(client, teacherId);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function makeDefault(client, teacherId, id) {
  await client.query(
    `UPDATE teacher_addresses SET is_default = false
     WHERE teacher_id = $1 AND is_default AND id <> $2`,
    [teacherId, id]
  );
  await client.query(
    `UPDATE teacher_addresses SET is_default = true, updated_at = now()
     WHERE id = $2 AND teacher_id = $1 AND saved`,
    [teacherId, id]
  );
}

/**
 * Inserta una dirección y devuelve su id. Adentro de una transacción ajena
 * (`client`, con lockAddresses tomado): la usan el perfil (guardada) y el
 * formulario de ventana (guardada o suelta). Si es la primera guardada del
 * docente, queda predeterminada.
 */
export async function insertAddress(client, teacherId, address, { saved, isDefault = false }) {
  const result = await client.query(
    `INSERT INTO teacher_addresses (
       teacher_id, label, street, number, postal_code, locality, city, floor, apartment, notes, saved
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [teacherId, ...VALUES(address), saved]
  );
  const { id } = result.rows[0];
  if (saved) {
    const otras = await client.query(
      `SELECT 1 FROM teacher_addresses WHERE teacher_id = $1 AND saved AND id <> $2 LIMIT 1`,
      [teacherId, id]
    );
    if (isDefault || otras.rowCount === 0) await makeDefault(client, teacherId, id);
  }
  return id;
}

/** La dirección guardada recién creada. */
export async function createAddress(teacherId, address, { isDefault = false } = {}) {
  return withAddressLock(teacherId, async (client) => {
    const id = await insertAddress(client, teacherId, address, { saved: true, isDefault });
    return selectAddress(client, teacherId, id);
  });
}

/**
 * Edita una guardada; o null si no existe o no es del docente. Las ventanas
 * que la usan cambian con ella (apuntan acá); las clases ya reservadas no
 * (tienen su copia).
 */
export async function updateAddress(teacherId, id, address, { isDefault = false } = {}) {
  return withAddressLock(teacherId, async (client) => {
    const result = await client.query(
      `UPDATE teacher_addresses SET
         label = $3, street = $4, number = $5, postal_code = $6, locality = $7, city = $8,
         floor = $9, apartment = $10, notes = $11, updated_at = now()
       WHERE id = $1 AND teacher_id = $2 AND saved`,
      [id, teacherId, ...VALUES(address)]
    );
    if (result.rowCount === 0) return null;
    if (isDefault) await makeDefault(client, teacherId, id);
    return selectAddress(client, teacherId, id);
  });
}

/** La guardada pasa a ser la predeterminada; null si no existe. */
export async function setDefaultAddress(teacherId, id) {
  return withAddressLock(teacherId, async (client) => {
    const address = await selectAddress(client, teacherId, id);
    if (!address || !address.saved) return null;
    await makeDefault(client, teacherId, id);
    return selectAddress(client, teacherId, id);
  });
}

/**
 * Borra una guardada. Devuelve { deleted: true }, { inUse: n } si la usa
 * alguna ventana, o null si no existe.
 */
export async function deleteAddress(teacherId, id) {
  return withAddressLock(teacherId, async (client) => {
    const address = await selectAddress(client, teacherId, id);
    if (!address || !address.saved) return null;
    const used = await client.query(
      `SELECT count(*)::int AS count FROM availability WHERE teacher_id = $1 AND address_id = $2`,
      [teacherId, id]
    );
    if (used.rows[0].count > 0) return { inUse: used.rows[0].count };
    await client.query(`DELETE FROM teacher_addresses WHERE id = $1 AND teacher_id = $2`, [
      id,
      teacherId,
    ]);
    return { deleted: true };
  });
}
