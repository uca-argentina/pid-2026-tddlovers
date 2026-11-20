import { getPool } from './pool.js';
import { checkUploadRoom } from '../lib/classMaterials.js';

// El material de un turno (docente, fecha, inicio): resumen y archivos. Quién
// puede verlo o tocarlo lo decide la ruta con lib/classMaterials.js; acá
// solo se lee y escribe.
//
// `turn` es { teacherId, date: 'YYYY-MM-DD', startTime: 'HH:MM' }, lo que
// tiene cualquier clase de ese turno.
//
// Tablas: class_materials y class_material_files (migración 018). Los bytes
// NO están en Postgres sino en el bucket (storage/files.js); acá solo la
// metadata y la storage_key.
// Locks: 'material:' || teacherId || date || startTime en addFiles.
// Lo usa: routes/classes/index.js (/:id/material y /:id/material/files).

const TURN_WHERE = 'teacher_id = $1 AND class_date = $2::date AND start_time = $3::time';
const turnParams = ({ teacherId, date, startTime }) => [teacherId, date, startTime];

/**
 * { summary, updatedAt, files } del turno; sin material, resumen vacío y sin archivos.
 *
 * @param {{teacherId, date, startTime}} turn - de la clase cargada por loadOwnClass.
 * @returns {Promise<{summary: string, updatedAt: Date|null,
 *   files: Array<{id, name, mimeType, sizeBytes, createdAt}>}>}
 * Origen: class_materials + class_material_files.
 * Lo usa: routes/classes/index.js (todas las rutas de material lo devuelven).
 */
export async function findMaterial(turn) {
  const pool = getPool();
  const [material, files] = await Promise.all([
    pool.query(
      `SELECT summary, updated_at AS "updatedAt" FROM class_materials WHERE ${TURN_WHERE}`,
      turnParams(turn)
    ),
    // Sin storage_key: la clave del bucket solo sale al descargar (findFileMeta).
    pool.query(
      `SELECT id, filename AS name, mime_type AS "mimeType", size_bytes AS "sizeBytes",
              created_at AS "createdAt"
       FROM class_material_files WHERE ${TURN_WHERE}
       ORDER BY created_at, filename`,
      turnParams(turn)
    ),
  ]);
  const row = material.rows[0];
  return { summary: row?.summary ?? '', updatedAt: row?.updatedAt ?? null, files: files.rows };
}

/**
 * Crea la fila de material del turno o le actualiza el resumen.
 *
 * @param {pg.Pool|pg.PoolClient} client - el pool o la transacción de addFiles.
 * @param {string|null} [summary] - null = no tocar el texto.
 */
async function upsertMaterial(client, turn, summary = null) {
  // Sin resumen (subir archivos) solo crea la fila si falta, sin pisar el texto.
  await client.query(
    `INSERT INTO class_materials (teacher_id, class_date, start_time, summary)
     VALUES ($1, $2::date, $3::time, COALESCE($4, ''))
     ON CONFLICT (teacher_id, class_date, start_time)
     DO UPDATE SET summary = COALESCE($4, class_materials.summary), updated_at = now()`,
    [...turnParams(turn), summary]
  );
}

/**
 * Guarda (o reemplaza) el resumen del turno.
 *
 * @param {{teacherId, date, startTime}} turn - de la clase del docente.
 * @param {string} summary - body.summary de PUT /api/classes/:id/material, ya
 *   validado por validateSummary (lib/classMaterials.js).
 * @returns {Promise<void>}
 * Origen: upsert en class_materials.
 * Lo usa: routes/classes/index.js.
 */
export async function saveSummary(turn, summary) {
  await upsertMaterial(getPool(), turn, summary);
}

/**
 * Registra los archivos del turno, ya subidos al bucket:
 * [{ name, mimeType, sizeBytes, storageKey }]. Los topes
 * se vuelven a chequear adentro de la transacción, bajo un lock del turno:
 * dos subidas a la vez podrían pasar las dos el chequeo de la ruta y juntas
 * pasarse. Devuelve null o { error } con el mensaje.
 *
 * @param {{teacherId, date, startTime}} turn - de la clase del docente.
 * @param {Array<{name, mimeType, sizeBytes, storageKey}>} files - leídos del
 *   multipart y ya subidos con putFile en POST /api/classes/:id/material/files.
 * @returns {Promise<null|{error: string}>} con error, la ruta borra los objetos subidos.
 * Origen: class_material_files (conteo y INSERT) + upsert en class_materials.
 * Lo usa: routes/classes/index.js.
 * Locks/transacción: transacción propia; 'material:' || teacherId || date || startTime.
 */
export async function addFiles(turn, files) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('material:' || $1 || $2 || $3))`,
      turnParams(turn)
    );

    const used = await client.query(
      `SELECT count(*)::int AS count, COALESCE(sum(size_bytes), 0)::bigint AS bytes
       FROM class_material_files WHERE ${TURN_WHERE}`,
      turnParams(turn)
    );
    const existing = { count: used.rows[0].count, bytes: Number(used.rows[0].bytes) };
    const denied = checkUploadRoom(existing, files);
    if (denied) {
      await client.query('ROLLBACK');
      return { error: denied };
    }

    await upsertMaterial(client, turn);
    for (const file of files) {
      await client.query(
        `INSERT INTO class_material_files
           (teacher_id, class_date, start_time, filename, mime_type, size_bytes, storage_key)
         VALUES ($1, $2::date, $3::time, $4, $5, $6, $7)`,
        [...turnParams(turn), file.name, file.mimeType, file.sizeBytes, file.storageKey]
      );
    }
    await client.query('COMMIT');
    return null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Borra la fila y devuelve la clave del objeto, para borrarlo del bucket; o
 * null si no estaba. El archivo tiene que ser de ESE turno: el id solo no
 * alcanza.
 *
 * @param {{teacherId, date, startTime}} turn - de la clase del docente.
 * @param {string} fileId - params.fileId de DELETE /api/classes/:id/material/files/:fileId.
 * @returns {Promise<string|null>} storage_key del objeto.
 * Origen: DELETE en class_material_files.
 * Lo usa: routes/classes/index.js.
 */
export async function deleteFile(turn, fileId) {
  const result = await getPool().query(
    `DELETE FROM class_material_files WHERE id = $4 AND ${TURN_WHERE}
     RETURNING storage_key AS "storageKey"`,
    [...turnParams(turn), fileId]
  );
  return result.rows[0]?.storageKey ?? null;
}

/**
 * { name, mimeType, storageKey } o null. Los bytes están en el bucket.
 *
 * @param {{teacherId, date, startTime}} turn - de la clase (docente o alumno con acceso).
 * @param {string} fileId - params.fileId de GET /api/classes/:id/material/files/:fileId.
 * @returns {Promise<{name, mimeType, storageKey}|null>}
 * Origen: class_material_files.
 * Lo usa: routes/classes/index.js (para firmar el link de descarga).
 */
export async function findFileMeta(turn, fileId) {
  const result = await getPool().query(
    `SELECT filename AS name, mime_type AS "mimeType", storage_key AS "storageKey"
     FROM class_material_files WHERE id = $4 AND ${TURN_WHERE}`,
    [...turnParams(turn), fileId]
  );
  return result.rows[0] ?? null;
}
