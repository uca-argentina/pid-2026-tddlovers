import { getPool } from './pool.js';

// Sesiones del lado del servidor: la cookie firmada solo lleva el id de la fila.
// Tablas: sessions (migración 001), y lee users (001; approval_status de 012).
// Lo usa: plugins/session.js (login/registro, logout y el hook que arma request.user).

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Crea una sesión que vence en 7 días.
 *
 * @param {string} userId - id del usuario recién registrado o logueado.
 * @returns {Promise<{id: string, expires_at: Date}>} el id va a la cookie.
 * Origen: inserta en sessions.
 * Lo usa: plugins/session.js (createUserSession).
 */
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

/**
 * Busca una sesión no vencida y los datos de su dueño. Hace join con users
 * para que quien llame tenga el rol, el email y (si es docente) el estado de
 * aprobación del dueño de la sesión en una sola consulta.
 *
 * @param {string} sessionId - el valor de la cookie de sesión, ya des-firmado.
 * @returns {Promise<{session_id, expires_at, user_id, email, role, approval_status}|null>}
 *   en snake_case; el plugin lo convierte en request.user.
 * Origen: sessions JOIN users.
 * Lo usa: plugins/session.js (hook onRequest).
 */
export async function findValidSession(sessionId) {
  const result = await getPool().query(
    `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email, u.role,
            u.approval_status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId]
  );
  return result.rows[0] ?? null;
}

/**
 * Borra una sesión (logout).
 *
 * @param {string} sessionId - el valor de la cookie, ya des-firmado.
 * Lo usa: plugins/session.js (destroyUserSession).
 */
export async function deleteSession(sessionId) {
  await getPool().query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

/**
 * Borra las sesiones vencidas. No hay cron: se dispara (sin esperar) cada vez
 * que se crea una sesión.
 *
 * Lo usa: plugins/session.js (createUserSession).
 */
export async function deleteExpiredSessions() {
  await getPool().query(`DELETE FROM sessions WHERE expires_at <= now()`);
}
