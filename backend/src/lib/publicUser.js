import { findSubjectIdsByTeacher } from '../db/users.js';
import { findRatesByTeacher } from '../db/rates.js';

/**
 * La forma del usuario que sale por la API. Vive acá y no en una ruta porque
 * la usan register, login, /me y el PATCH del perfil, y el front espera
 * exactamente los mismos campos en las cuatro (ver CLAUDE.md en la raíz).
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
    subjectIds,
    rates,
  };
}
