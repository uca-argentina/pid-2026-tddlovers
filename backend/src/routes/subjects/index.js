import { listSubjects } from '../../db/subjects.js';

// Montado en /api/subjects (app.js):
//   GET /api/subjects  cualquiera (sin sesión: lo usa el registro)
//     → 200 [{ id, name }] del catálogo (db/subjects.js listSubjects).

export default async function subjectsRoutes(app) {
  app.get('/', async (request, reply) => {
    const subjects = await listSubjects();
    return reply.send(subjects);
  });
}
