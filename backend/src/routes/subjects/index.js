import { listSubjects } from '../../db/subjects.js';

export default async function subjectsRoutes(app) {
  app.get('/', async (request, reply) => {
    const subjects = await listSubjects();
    return reply.send(subjects);
  });
}
