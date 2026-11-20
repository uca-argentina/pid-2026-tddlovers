import { getPool } from './pool.js';

// El catálogo fijo de materias.
// Tablas: subjects (migración 002, sembrada ahí mismo). Solo lectura.
// Lo usan: routes/subjects (listado), routes/auth y routes/users (validar subjectIds).

/**
 * Todas las materias del catálogo, por nombre.
 *
 * @returns {Promise<Array<{id: string, name: string}>>}
 * Origen: subjects.
 * Lo usan: routes/subjects/index.js (GET /api/subjects).
 */
export async function listSubjects() {
  const result = await getPool().query(`SELECT id, name FROM subjects ORDER BY name`);
  return result.rows;
}

/**
 * Cuántos de esos ids existen en el catálogo. Se usa para validar los
 * subjectIds que llegan antes de vincularlos a un docente: si el conteo no
 * coincide con el largo del array, alguno no existe.
 *
 * @param {string[]} subjectIds - ids ya deduplicados y con forma de UUID (body.subjectIds).
 * @returns {Promise<number>}
 * Origen: subjects.
 * Lo usan: routes/auth/index.js (POST /register), routes/users/index.js (PATCH /me).
 */
export async function countExistingSubjectIds(subjectIds) {
  if (subjectIds.length === 0) return 0;
  const result = await getPool().query(
    `SELECT count(*)::int AS count FROM subjects WHERE id = ANY($1::uuid[])`,
    [subjectIds]
  );
  return result.rows[0].count;
}
