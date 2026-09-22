import { listSubjects, countExistingSubjectIds } from '../../db/subjects.js';
import { replaceSubjectAvailability } from '../../db/availability.js';
import { validateSchedule } from '../../lib/schedule.js';

export default async function subjectsRoutes(app) {
  app.get('/', async (request, reply) => {
    const subjects = await listSubjects();
    return reply.send(subjects);
  });

  /**
   * Guarda la plantilla semanal del docente logueado para esta materia.
   * Reemplaza la semana entera: lo que no viene, se borra.
   *
   * El docente sale de la sesión, no de la URL — solo se puede editar la
   * disponibilidad propia.
   */
  app.put(
    '/:subjectId/availability',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      if (request.user.role !== 'teacher') {
        return reply.code(403).send({ message: 'Solo los docentes tienen disponibilidad' });
      }

      const { subjectId } = request.params;
      const { schedule } = request.body ?? {};

      const problem = validateSchedule(schedule);
      if (problem) {
        return reply.code(400).send({ message: problem, fields: { schedule: 'invalid' } });
      }

      // Que la materia exista de verdad: si no, el INSERT muere con un error
      // de foreign key que el usuario no puede entender.
      const exists = await countExistingSubjectIds([subjectId]);
      if (exists !== 1) {
        return reply.code(404).send({ message: 'La materia no existe' });
      }

      await replaceSubjectAvailability(request.user.id, subjectId, schedule);

      return reply.send({ subjectId, schedule });
    }
  );
}
