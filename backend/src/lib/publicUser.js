import { findSubjectIdsByTeacher } from '../db/users.js';
import { findRatesByTeacher } from '../db/rates.js';

/**
 * La forma del usuario que sale por la API. Vive acá y no en una ruta porque
 * la usan register, login, /me y el PATCH del perfil, y el front espera
 * exactamente los mismos campos en las cuatro (ver CLAUDE.md en la raíz).
 * Para los docentes hace dos consultas más: sus materias
 * (findSubjectIdsByTeacher, db/users.js → teacher_subjects) y sus tarifas
 * (findRatesByTeacher, db/rates.js → teacher_rates).
 *
 * `subjectIds` va siempre, incluso vacío: si faltara, la pantalla de perfil
 * no podría distinguir "todavía no cargó" de "no da ninguna materia". Lo
 * mismo `rates`: la tarifa por hora de cada materia en cada modalidad
 * ([{ subjectId, modality, hourlyRateCents }]), que usan el perfil y la
 * pantalla de disponibilidad.
 *
 * `approvalStatus` ('pending' | 'approved' | 'rejected') va solo en los
 * docentes, null en el resto: el perfil le avisa al docente si todavía no lo
 * aprobaron y por eso no recibe reservas.
 *
 * `acceptsRewards` dice si el docente acepta canjes de neuronas; false en el
 * resto, porque el alumno no recibe canjes.
 */
/**
 * @param {object} user - una fila de `users` en snake_case (approval_status,
 *   accepts_neurona_rewards...), tal como la devuelven createUser /
 *   findUserByEmail / findUserById / updateUserProfile de db/users.js.
 * @returns {Promise<{id, email, role, nombre, apellido, telefono, approvalStatus,
 *   acceptsRewards, subjectIds, rates}>} sin password_hash ni otras columnas internas.
 * Lo usan: routes/auth/index.js (register, login, /me) y routes/users/index.js (PATCH /me).
 * Espejo: los tests del front arman esta forma con apiUser() de
 *   frontend/src/testing/fixtures.js.
 */
export async function toPublicUser(user) {
  const esDocente = user.role === 'teacher';
  const [subjectIds, rates] = esDocente
    ? await Promise.all([findSubjectIdsByTeacher(user.id), findRatesByTeacher(user.id)])
    : [[], []];
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    nombre: user.nombre,
    apellido: user.apellido,
    telefono: user.telefono,
    approvalStatus: esDocente ? user.approval_status : null,
    acceptsRewards: esDocente ? Boolean(user.accepts_neurona_rewards) : false,
    subjectIds,
    rates,
  };
}
