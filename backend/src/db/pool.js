import pg from 'pg';

const { Pool } = pg;

let pool;

// Se crea recién cuando se usa, así los tests pueden importar módulos que
// pasan por este archivo sin necesitar un DATABASE_URL de verdad hasta que
// alguna consulta se ejecute.
export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
