// Contraseñas: hash con argon2id, verificación y chequeo de fortaleza. Lo usa
// solo routes/auth/index.js (register y login). El hash se guarda en
// users.password_hash; la contraseña en claro nunca se guarda ni se loguea.
import argon2 from 'argon2';

const MIN_LENGTH = 10;

/**
 * Hashea una contraseña con argon2id (el hash incluye la sal y los parámetros).
 *
 * @param {string} password - la contraseña en claro del body de POST /api/auth/register.
 * @returns {Promise<string>} el hash que se guarda en users.password_hash.
 * Lo usa: routes/auth/index.js (register).
 */
export async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}

/**
 * ¿La contraseña coincide con el hash guardado?
 *
 * @param {string} hash - users.password_hash, leído con findUserByEmail (db/users.js).
 * @param {string} password - la contraseña en claro del body de POST /api/auth/login.
 * @returns {Promise<boolean>}
 * Lo usa: routes/auth/index.js (login).
 */
export async function verifyPassword(hash, password) {
  return argon2.verify(hash, password);
}

/**
 * Chequeo básico de fortaleza: ≥10 caracteres, mayúsculas, minúsculas, números
 * y al menos un carácter especial. No es un motor de políticas completo:
 * alcanza para frenar las contraseñas más débiles antes de gastar tiempo
 * hasheándolas.
 *
 * @param {string} password - la contraseña en claro del body de register.
 * @returns {string|null} null si sirve, o el mensaje (en español) del primer problema.
 * Lo usa: routes/auth/index.js (register).
 */
export function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_LENGTH} caracteres`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'La contraseña debe incluir mayúsculas, minúsculas y números';
  }
  // Cualquier cosa que no sea letra, dígito o espacio cuenta como especial.
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    return 'La contraseña debe incluir al menos un carácter especial';
  }
  return null;
}
