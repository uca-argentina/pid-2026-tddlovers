import { getPool } from './pool.js';

// Las direcciones del docente (migración 019). Las guardadas (saved) son las
// del perfil; las sueltas son de una sola ventana y las maneja
// db/availability.js. Qué es válido lo decide lib/addresses.js.
//
// Tablas: teacher_addresses (019; a lo sumo una is_default por docente, índice
// único parcial teacher_addresses_one_default); lee availability.address_id
// (columna de 019) para no borrar una dirección en uso.
// Locks (pg_advisory_xact_lock, siempre en este orden):
//   1. 'availability:' || teacherId  (el mismo de db/availability.js)
//   2. 'addresses:' || teacherId
// Lo usan: routes/teachers/index.js (/me/addresses) y db/availability.js
// (ADDRESS_JSON, insertAddress, lockAddresses).

// La dirección como la espera el front. `ta` es el alias de teacher_addresses.
const ADDRESS_COLUMNS = `
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

/**
 * Las guardadas del docente: la predeterminada primero, después por nombre.
 *
 * @param {string} teacherId - request.user.id del docente.
 * @returns {Promise<Array<{id, label, street, number, postalCode, locality, city,
 *   floor, apartment, notes, saved, isDefault}>>} (ADDRESS_COLUMNS).
 * Origen: teacher_addresses WHERE saved.
 * Lo usa: routes/teachers/index.js (GET /me/addresses).
 */
export async function listSavedAddresses(teacherId) {
  // FILTRO: solo las guardadas: las sueltas ("Otra dirección…" sin guardar)
  // son de una sola ventana y no se listan en el perfil.
  const result = await getPool().query(
    `SELECT ${ADDRESS_COLUMNS}
     FROM teacher_addresses ta
     WHERE ta.teacher_id = $1 AND ta.saved
     ORDER BY ta.is_default DESC, lower(ta.label), ta.created_at`,
    [teacherId]
  );
  return result.rows;
}

/**
 * Una dirección del docente (guardada o suelta), leída con el cliente de la
 * transacción en curso.
 *
 * @returns {Promise<object|null>} ADDRESS_COLUMNS, o null si no existe o es de otro docente.
 */
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
 *
 * @param {pg.PoolClient} client - cliente con una transacción abierta (los locks son xact).
 * @param {string} teacherId - el docente dueño de las direcciones.
 * @returns {Promise<void>}
 * Lo usan: withAddressLock (acá) y db/availability.js (withAvailabilityLock).
 */
export async function lockAddresses(client, teacherId) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('availability:' || $1))`, [teacherId]);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('addresses:' || $1))`, [teacherId]);
}

/**
 * Abre una transacción, toma lockAddresses y corre `work(client)`; commit si
 * sale bien, rollback si tira.
 *
 * @returns {Promise<*>} lo que devuelva `work`.
 */
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

/**
 * Deja `id` como la única predeterminada del docente: primero le saca la
 * marca a la anterior (si no, el índice único parcial lo rechazaría) y
 * después se la pone a esta, solo si es guardada.
 */
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
 *
 * @param {pg.PoolClient} client - transacción ajena con lockAddresses ya tomado.
 * @param {string} teacherId - docente dueño.
 * @param {object} address - ya validada por lib/addresses.js validateAddress
 *   ({label, street, number, postalCode, locality, city, floor, apartment, notes}).
 * @param {{saved: boolean, isDefault?: boolean}} opciones - saved = aparece en el perfil.
 * @returns {Promise<string>} el id nuevo.
 * Origen: INSERT en teacher_addresses.
 * Lo usan: createAddress (acá) y db/availability.js (ventana con "Otra dirección…").
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

/**
 * Crea una dirección guardada (del perfil).
 *
 * @param {string} teacherId - request.user.id.
 * @param {object} address - body de POST /api/teachers/me/addresses, ya validado.
 * @param {{isDefault?: boolean}} [opciones] - body.isDefault === true.
 * @returns {Promise<object>} la dirección recién creada (ADDRESS_COLUMNS).
 * Lo usa: routes/teachers/index.js (POST /me/addresses).
 * Locks/transacción: withAddressLock (availability → addresses).
 */
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
 *
 * @param {string} teacherId - request.user.id.
 * @param {string} id - params.id de PUT /api/teachers/me/addresses/:id.
 * @param {object} address - body ya validado por validateAddress.
 * @param {{isDefault?: boolean}} [opciones] - body.isDefault === true.
 * @returns {Promise<object|null>} la dirección actualizada (ADDRESS_COLUMNS).
 * Lo usa: routes/teachers/index.js.
 * Locks/transacción: withAddressLock (availability → addresses).
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

/**
 * La guardada pasa a ser la predeterminada; null si no existe (o es suelta).
 *
 * @param {string} teacherId - request.user.id.
 * @param {string} id - params.id de POST /api/teachers/me/addresses/:id/default.
 * @returns {Promise<object|null>} la dirección (ADDRESS_COLUMNS) ya con isDefault.
 * Lo usa: routes/teachers/index.js.
 * Locks/transacción: withAddressLock (availability → addresses).
 */
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
 *
 * @param {string} teacherId - request.user.id.
 * @param {string} id - params.id de DELETE /api/teachers/me/addresses/:id.
 * @returns {Promise<{deleted: true}|{inUse: number}|null>}
 * Origen: teacher_addresses; cuenta availability.address_id.
 * Lo usa: routes/teachers/index.js (409 con inUse).
 * Locks/transacción: withAddressLock (availability → addresses).
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
