import { findPublishedWindows } from '../../db/availability.js';
import { findTakenSlots } from '../../db/classes.js';
import { expandAvailability } from '../../lib/availabilityExpansion.js';
import { now } from '../../lib/clock.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function availabilityRoutes(app) {
  /**
   * El tablero del alumno: la disponibilidad YA con fecha y YA neta de lo
   * reservado. Una fila por (ventana, fecha), con la materia, la modalidad,
   * el cupo y los turnos que quedan — incluidas las grupales a las que
   * todavía se puede sumar.
   *
   * El alumno nunca ve una ventana semanal: el puente entre "los lunes de 13
   * a 15:30" y "el lunes 14 de septiembre" se hace acá.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { from, to } = request.query ?? {};

    if (!ISO_DATE_RE.test(from ?? '') || !ISO_DATE_RE.test(to ?? '')) {
      return reply.code(400).send({ message: 'Rango de fechas inválido' });
    }
    if (from > to) {
      return reply.code(400).send({ message: 'El rango de fechas está al revés' });
    }

    const [windows, taken] = await Promise.all([
      findPublishedWindows({ from, to }),
      findTakenSlots({ from, to }),
    ]);

    const { iso, time } = now();
    const rows = expandAvailability({ windows, taken, from, to, nowIso: iso, nowTime: time });

    // El docente logueado no se ofrece a sí mismo como opción reservable.
    return reply.send(rows.filter((row) => row.teacherId !== request.user.id));
  });
}
