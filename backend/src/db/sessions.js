import { getPool } from './pool.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createSession(userId) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const result = await getPool().query(
    `INSERT INTO sessions (user_id, expires_at)
     VALUES ($1, $2)
     RETURNING id, expires_at`,
    [userId, expiresAt]
  );
  return result.rows[0];
}

// Hace join con users para que quien llame tenga el rol y el email del dueño
// de la sesión en una sola consulta.
export async function findValidSession(sessionId) {
  const result = await getPool().query(
    `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId]
  );
  return result.rows[0] ?? null;
}

export async function deleteSession(sessionId) {
  await getPool().query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

export async function deleteExpiredSessions() {
  await getPool().query(`DELETE FROM sessions WHERE expires_at <= now()`);
}
