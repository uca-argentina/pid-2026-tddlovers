import { getPool } from './pool.js';
import { checkUploadRoom } from '../lib/classMaterials.js';

// El material de un turno (docente, fecha, inicio): resumen y archivos. Quién
// puede verlo o tocarlo lo decide la ruta con lib/classMaterials.js; acá
// solo se lee y escribe.
//
// `turn` es { teacherId, date: 'YYYY-MM-DD', startTime: 'HH:MM' }, lo que
// tiene cualquier clase de ese turno.

const TURN_WHERE = 'teacher_id = $1 AND class_date = $2::date AND start_time = $3::time';
const turnParams = ({ teacherId, date, startTime }) => [teacherId, date, startTime];

/** { summary, updatedAt, files } del turno; sin material, resumen vacío y sin archivos. */
export async function findMaterial(turn) {
  const pool = getPool();
  const [material, files] = await Promise.all([
    pool.query(
      `SELECT summary, updated_at AS "updatedAt" FROM class_materials WHERE ${TURN_WHERE}`,
      turnParams(turn)
    ),
    // Sin `data`: los bytes se piden de a uno, al descargar.
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

export async function saveSummary(turn, summary) {
  await upsertMaterial(getPool(), turn, summary);
}

/**
 * Registra los archivos del turno, ya subidos al bucket:
 * [{ name, mimeType, sizeBytes, storageKey }]. Los topes
 * se vuelven a chequear adentro de la transacción, bajo un lock del turno:
 * dos subidas a la vez podrían pasar las dos el chequeo de la ruta y juntas
 * pasarse. Devuelve null o { error } con el mensaje.
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
 */
export async function deleteFile(turn, fileId) {
  const result = await getPool().query(
    `DELETE FROM class_material_files WHERE id = $4 AND ${TURN_WHERE}
     RETURNING storage_key AS "storageKey"`,
    [...turnParams(turn), fileId]
  );
  return result.rows[0]?.storageKey ?? null;
}

/** { name, mimeType, storageKey } o null. Los bytes están en el bucket. */
export async function findFileMeta(turn, fileId) {
  const result = await getPool().query(
    `SELECT filename AS name, mime_type AS "mimeType", storage_key AS "storageKey"
     FROM class_material_files WHERE id = $4 AND ${TURN_WHERE}`,
    [...turnParams(turn), fileId]
  );
  return result.rows[0] ?? null;
}
