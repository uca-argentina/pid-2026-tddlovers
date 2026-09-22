import { getPool } from './pool.js';

export async function listSubjects() {
  const result = await getPool().query(`SELECT id, name FROM subjects ORDER BY name`);
  return result.rows;
}

// Se usa para validar los subjectIds que llegan antes de vincularlos a un
// docente.
export async function countExistingSubjectIds(subjectIds) {
  if (subjectIds.length === 0) return 0;
  const result = await getPool().query(
    `SELECT count(*)::int AS count FROM subjects WHERE id = ANY($1::uuid[])`,
    [subjectIds]
  );
  return result.rows[0].count;
}
