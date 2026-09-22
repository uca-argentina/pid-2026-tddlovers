import { findPublishedAvailability } from '../../db/availability.js';
import { findBookedSlots } from '../../db/classes.js';
import { expandAvailability } from '../../lib/availabilityExpansion.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function availabilityRoutes(app) {
  /**
   * El tablero del alumno: la disponibilidad YA con fecha y YA neta de lo
   * reservado. Una fila por (docente, fecha), con las materias del docente
   * para que el alumno elija una al reservar.
   *
   * El alumno nunca ve una plantilla semanal: el puente entre "los lunes de
   * 13 a 15:30" y "el lunes 14 de septiembre" se hace acá.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { from, to } = request.query ?? {};

    if (!ISO_DATE_RE.test(from ?? '') || !ISO_DATE_RE.test(to ?? '')) {
      return reply.code(400).send({ message: 'Rango de fechas inválido' });
    }
    if (from > to) {
      return reply.code(400).send({ message: 'El rango de fechas está al revés' });
    }

    const [entries, bookings] = await Promise.all([
      findPublishedAvailability(),
      findBookedSlots({ from, to }),
    ]);

    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    const rows = expandAvailability({
      entries,
      bookings,
      from,
      to,
      nowIso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      nowTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    });

    // El docente logueado no se ofrece a sí mismo como opción reservable.
    return reply.send(rows.filter((row) => row.teacherId !== request.user.id));
  });
}
