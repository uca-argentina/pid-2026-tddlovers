import { findAvailabilityByTeacher, replaceTeacherAvailability } from '../../db/availability.js';
import { validateSchedule } from '../../lib/schedule.js';

export default async function teachersRoutes(app) {
  /**
   * La semana de un docente: { lunes: [{ start, end }], ... }. Una sola, sin
   * materia — la materia la elige el alumno al reservar.
   *
   * Es lectura pública para cualquiera con sesión: el alumno necesita ver la
   * disponibilidad del docente para poder reservar.
   */
  app.get('/:teacherId/availability', { onRequest: app.requireAuth }, async (request, reply) => {
    const schedule = await findAvailabilityByTeacher(request.params.teacherId);
    return reply.send(schedule);
  });

  /**
   * Guarda la semana del docente logueado. Reemplaza la semana entera: lo que
   * no viene, se borra.
   *
   * `me` y no un id: el docente sale de la sesión, así que solo se puede
   * editar la disponibilidad propia.
   */
  app.put(
    '/me/availability',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      if (request.user.role !== 'teacher') {
        return reply.code(403).send({ message: 'Solo los docentes tienen disponibilidad' });
      }

      const { schedule } = request.body ?? {};

      const problem = validateSchedule(schedule);
      if (problem) {
        return reply.code(400).send({ message: problem, fields: { schedule: 'invalid' } });
      }

      await replaceTeacherAvailability(request.user.id, schedule);

      return reply.send({ schedule });
    }
  );
}
