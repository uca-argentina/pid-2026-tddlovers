import { findSubjectIdsByTeacher, updateUserProfile } from '../../db/users.js';
import { countExistingSubjectIds } from '../../db/subjects.js';
import { toPublicUser } from '../../lib/publicUser.js';
import { validateRates } from '../../lib/teacherRates.js';

// Mismo criterio que el registro: el teléfono es opcional, así que se acepta
// vacío, pero si viene tiene que parecer un teléfono. La UI valida igual.
const PHONE_RE = /^[+\d][\d\s\-()]{5,20}$/;

export default async function usersRoutes(app) {
  /**
   * Actualiza el perfil del usuario logueado. El id sale de la sesión, nunca
   * del body: si viniera del body, cualquiera podría editar el perfil ajeno.
   *
   * `subjectIds` reemplaza por completo las materias del docente (así lo manda
   * la pantalla de perfil: la lista entera, no un diff). `rates` igual: la
   * lista entera de tarifas por hora, [{ subjectId, modality, hourlyRateCents }],
   * y solo de materias que el docente da. En un alumno se ignoran los dos —
   * no tiene materias propias.
   */
  app.patch('/me', { onRequest: [app.requireAuth, app.csrfProtection] }, async (request, reply) => {
    const { telefono, subjectIds, rates } = request.body ?? {};

    if (telefono !== undefined && telefono !== null && typeof telefono !== 'string') {
      return reply
        .code(400)
        .send({ message: 'Teléfono inválido', fields: { telefono: 'invalid' } });
    }

    const cleanPhone = typeof telefono === 'string' ? telefono.trim() : '';
    if (cleanPhone && !PHONE_RE.test(cleanPhone)) {
      return reply
        .code(400)
        .send({ message: 'Ingresá un teléfono válido.', fields: { telefono: 'invalid' } });
    }

    let cleanSubjectIds;
    if (request.user.role === 'teacher' && subjectIds !== undefined) {
      if (!Array.isArray(subjectIds)) {
        return reply
          .code(400)
          .send({ message: 'Materias inválidas', fields: { subjectIds: 'invalid' } });
      }
      cleanSubjectIds = [...new Set(subjectIds)];
      if (cleanSubjectIds.length > 0) {
        // Que existan de verdad: si no, el INSERT falla con un error de FK que
        // el usuario no puede entender.
        const validCount = await countExistingSubjectIds(cleanSubjectIds);
        if (validCount !== cleanSubjectIds.length) {
          return reply.code(400).send({
            message: 'Una o más materias seleccionadas no existen',
            fields: { subjectIds: 'invalid' },
          });
        }
      }
    }

    let cleanRates;
    if (request.user.role === 'teacher' && rates !== undefined) {
      // Contra las materias que va a tener DESPUÉS de guardar: las que llegan
      // en este mismo pedido o, si no llegan, las que ya tiene.
      const materias = cleanSubjectIds ?? (await findSubjectIdsByTeacher(request.user.id));
      const checked = validateRates(rates, materias);
      if (!checked.value) return reply.code(400).send(checked);
      cleanRates = checked.value;
    }

    const user = await updateUserProfile(request.user.id, {
      telefono: cleanPhone || null,
      subjectIds: cleanSubjectIds,
      rates: cleanRates,
    });

    if (!user) {
      return reply.code(404).send({ message: 'Usuario no encontrado' });
    }

    return reply.send(await toPublicUser(user));
  });
}
