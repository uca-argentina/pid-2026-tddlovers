import { findSubjectIdsByTeacher } from '../db/users.js';

/**
 * La forma del usuario que sale por la API. Vive acá y no en una ruta porque
 * la usan register, login, /me y el PATCH del perfil, y el front espera
 * exactamente los mismos campos en las cuatro (ver PID-Front/CLAUDE.md).
 *
 * `subjectIds` va siempre, incluso vacío: si faltara, la pantalla de perfil
 * no podría distinguir "todavía no cargó" de "no da ninguna materia".
 */
export async function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    nombre: user.nombre,
    apellido: user.apellido,
    telefono: user.telefono,
    subjectIds: user.role === 'teacher' ? await findSubjectIdsByTeacher(user.id) : [],
  };
}
