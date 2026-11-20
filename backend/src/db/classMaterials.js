import { getPool } from './pool.js';
import { checkUploadRoom } from '../lib/classMaterials.js';

// El material de una clase: resumen y archivos. Quién puede verlo o tocarlo
// lo decide la ruta con lib/classMaterials.js; acá solo se lee y escribe.
//
// `classId` es classes.id (el `classId` de cualquier reserva de esa clase):
// en una grupal, todos los anotados ven el mismo material.
//
// Tablas: class_materials y class_material_files (migración 018; por class_id
// desde la 024). Los bytes NO están en Postgres sino en el bucket
// (storage/files.js); acá solo la metadata y la storage_key.
// Locks: 'material:' || classId en addFiles.
// Lo usa: routes/classes/index.js (/:classId/material y /:classId/material/files).

/**
 * { summary, updatedAt, files } de la clase; sin material, resumen vacío y sin archivos.
 *
 * @param {string} classId - params.classId, ya validado por loadOwnClass.
 * @returns {Promise<{summary: string, updatedAt: Date|null,
 *   files: Array<{id, name, mimeType, sizeBytes, createdAt}>}>}
 * Origen: class_materials + class_material_files.
 * Lo usa: routes/classes/index.js (todas las rutas de material lo devuelven).
 */
export async function findMaterial(classId) {
  // FILTRO: el material es de la CLASE, no de la reserva: en una grupal todos
  // los anotados ven lo mismo. Quién puede verlo lo decide antes
  // checkViewMaterial (lib/classMaterials.js). Nunca sale storage_key.
  const pool = getPool();
  const [material, files] = await Promise.all([
    pool.query(
      `SELECT summary, updated_at AS "updatedAt" FROM class_materials WHERE class_id = $1`,
      [classId]
    ),
    // Sin storage_key: la clave del bucket solo sale al descargar (findFileMeta).
    pool.query(
      `SELECT id, filename AS name, mime_type AS "mimeType", size_bytes AS "sizeBytes",
              created_at AS "createdAt"
       FROM class_material_files WHERE class_id = $1
       ORDER BY created_at, filename`,
      [classId]
    ),
  ]);
  const row = material.rows[0];
  return { summary: row?.summary ?? '', updatedAt: row?.updatedAt ?? null, files: files.rows };
}

/**
 * Crea la fila de material de la clase o le actualiza el resumen.
 *
 * @param {pg.Pool|pg.PoolClient} client - el pool o la transacción de addFiles.
 * @param {string} classId - classes.id.
 * @param {string|null} [summary] - null = no tocar el texto.
 */
async function upsertMaterial(client, classId, summary = null) {
  // Sin resumen (subir archivos) solo crea la fila si falta, sin pisar el texto.
  await client.query(
    `INSERT INTO class_materials (class_id, summary)
     VALUES ($1, COALESCE($2, ''))
     ON CONFLICT (class_id)
     DO UPDATE SET summary = COALESCE($2, class_materials.summary), updated_at = now()`,
    [classId, summary]
  );
}

/**
 * Guarda (o reemplaza) el resumen de la clase.
 *
 * @param {string} classId - de la reserva del docente.
 * @param {string} summary - body.summary de PUT /api/classes/:id/material, ya
 *   validado por validateSummary (lib/classMaterials.js).
 * @returns {Promise<void>}
 * Origen: upsert en class_materials.
 * Lo usa: routes/classes/index.js.
 */
export async function saveSummary(classId, summary) {
  await upsertMaterial(getPool(), classId, summary);
}

/**
 * Registra los archivos de la clase, ya subidos al bucket:
 * [{ name, mimeType, sizeBytes, storageKey }]. Los topes se vuelven a chequear
 * adentro de la transacción, bajo un lock de la clase: dos subidas a la vez
 * podrían pasar las dos el chequeo de la ruta y juntas pasarse. Devuelve null
 * o { error } con el mensaje.
 *
 * @param {string} classId - de la reserva del docente.
 * @param {Array<{name, mimeType, sizeBytes, storageKey}>} files - leídos del
 *   multipart y ya subidos con putFile en POST /api/classes/:id/material/files.
 * @returns {Promise<null|{error: string}>} con error, la ruta borra los objetos subidos.
 * Origen: class_material_files (conteo y INSERT) + upsert en class_materials.
 * Lo usa: routes/classes/index.js.
 * Locks/transacción: transacción propia; 'material:' || classId.
 */
export async function addFiles(classId, files) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('material:' || $1))`, [classId]);

    const used = await client.query(
      `SELECT count(*)::int AS count, COALESCE(sum(size_bytes), 0)::bigint AS bytes
       FROM class_material_files WHERE class_id = $1`,
      [classId]
    );
    const existing = { count: used.rows[0].count, bytes: Number(used.rows[0].bytes) };
    const denied = checkUploadRoom(existing, files);
    if (denied) {
      await client.query('ROLLBACK');
      return { error: denied };
    }

    await upsertMaterial(client, classId);
    for (const file of files) {
      await client.query(
        `INSERT INTO class_material_files (class_id, filename, mime_type, size_bytes, storage_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [classId, file.name, file.mimeType, file.sizeBytes, file.storageKey]
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
 * null si no estaba. El archivo tiene que ser de ESA clase: el id solo no
 * alcanza.
 *
 * @param {string} classId - de la reserva del docente.
 * @param {string} fileId - params.fileId de DELETE /api/classes/:id/material/files/:fileId.
 * @returns {Promise<string|null>} storage_key del objeto.
 * Origen: DELETE en class_material_files.
 * Lo usa: routes/classes/index.js.
 */
export async function deleteFile(classId, fileId) {
  const result = await getPool().query(
    `DELETE FROM class_material_files WHERE id = $2 AND class_id = $1
     RETURNING storage_key AS "storageKey"`,
    [classId, fileId]
  );
  return result.rows[0]?.storageKey ?? null;
}

/**
 * { name, mimeType, storageKey } o null. Los bytes están en el bucket.
 *
 * @param {string} classId - de la reserva (docente o alumno con acceso).
 * @param {string} fileId - params.fileId de GET /api/classes/:id/material/files/:fileId.
 * @returns {Promise<{name, mimeType, storageKey}|null>}
 * Origen: class_material_files.
 * Lo usa: routes/classes/index.js (para firmar el link de descarga).
 */
export async function findFileMeta(classId, fileId) {
  const result = await getPool().query(
    `SELECT filename AS name, mime_type AS "mimeType", storage_key AS "storageKey"
     FROM class_material_files WHERE id = $2 AND class_id = $1`,
    [classId, fileId]
  );
  return result.rows[0] ?? null;
}
