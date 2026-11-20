import pg from 'pg';

const { Pool } = pg;

// El pool de conexiones a Postgres que comparten todos los módulos db/*.
// No toca ninguna tabla por sí mismo; la conexión sale de DATABASE_URL.

let pool;

/**
 * Devuelve el pool único de pg (lo crea la primera vez).
 *
 * Se crea recién cuando se usa, así los tests pueden importar módulos que
 * pasan por este archivo sin necesitar un DATABASE_URL de verdad hasta que
 * alguna consulta se ejecute.
 *
 * @returns {pg.Pool} el pool; para transacciones se pide un cliente con `.connect()`.
 * Origen: process.env.DATABASE_URL.
 * Lo usan: todos los db/*.js.
 */
export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

/**
 * Cierra el pool (si existe) para que el proceso termine limpio.
 *
 * @returns {Promise<void>}
 * Lo usan: index.js, al apagar el servidor.
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
