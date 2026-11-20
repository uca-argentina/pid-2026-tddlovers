import {
  addFavoriteTeacher,
  listFavoriteTeachers,
  removeFavoriteTeacher,
} from '../../db/favorites.js';
import { isUuid } from '../../lib/validators.js';

const NOT_FOUND = 'Ese docente no existe o no está disponible por ahora.';

/**
 * Los docentes favoritos del alumno logueado. Sale de la sesión: nadie ve ni
 * toca los favoritos de otro, y el docente no se entera de nada.
 *
 * PUT y DELETE en vez de un toggle: los dos son idempotentes, así un doble
 * clic o un reintento no deja el favorito al revés de lo que se pidió.
 *
 * Montado en /api/favorites (app.js). Solo role 'student' (403 si no):
 *   GET    /api/favorites              → 200 [{ id, nombre, apellido, subjects }]
 *   PUT    /api/favorites/:teacherId   (CSRF) → 204; 404 si no es un docente aprobado
 *   DELETE /api/favorites/:teacherId   (CSRF) → 204; 404 si el id no es UUID
 * Usa: db/favorites.js. Errores como { message }.
 */
export default async function favoritesRoutes(app) {
  function onlyStudents(request, reply, done) {
    if (request.user.role !== 'student') {
      reply.code(403).send({ message: 'Solo los alumnos tienen docentes favoritos' });
      return;
    }
    done();
  }

  const read = { onRequest: [app.requireAuth], preHandler: onlyStudents };
  const write = { onRequest: [app.requireAuth, app.csrfProtection], preHandler: onlyStudents };

  /** Los favoritos aprobados, con sus materias ({ id, nombre, apellido, subjects }). */
  app.get('/', read, async (request, reply) => {
    return reply.send(await listFavoriteTeachers(request.user.id));
  });

  app.put('/:teacherId', write, async (request, reply) => {
    const { teacherId } = request.params;
    const done = isUuid(teacherId) && (await addFavoriteTeacher(request.user.id, teacherId));
    if (!done) return reply.code(404).send({ message: NOT_FOUND });
    return reply.code(204).send();
  });

  app.delete('/:teacherId', write, async (request, reply) => {
    const { teacherId } = request.params;
    if (!isUuid(teacherId)) return reply.code(404).send({ message: NOT_FOUND });
    await removeFavoriteTeacher(request.user.id, teacherId);
    return reply.code(204).send();
  });
}
