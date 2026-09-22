import { findAvailabilityByTeacher } from '../../db/availability.js';

export default async function teachersRoutes(app) {
  /**
   * Toda la disponibilidad de un docente, en un solo pedido y agrupada por
   * materia: { [subjectId]: { lunes: [{ start, end }], ... } }.
   *
   * Van TODAS las materias juntas porque la pantalla del scheduler necesita
   * las otras para pintar los horarios bloqueados (nadie da dos materias a la
   * vez); pedirlas de a una sería un N+1 con una carrera entre promesas cada
   * vez que se cambia de materia.
   *
   * Es lectura pública para cualquiera con sesión: el alumno necesita ver la
   * disponibilidad del docente para poder reservar.
   */
  app.get('/:teacherId/availability', { onRequest: app.requireAuth }, async (request, reply) => {
    const bySubject = await findAvailabilityByTeacher(request.params.teacherId);
    return reply.send(bySubject);
  });
}
