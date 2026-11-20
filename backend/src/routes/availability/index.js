import { findPublishedWindows } from '../../db/availability.js';
import { expireStartedPending, findClassById, findTakenSlots } from '../../db/classes.js';
import { listVacationsInRange } from '../../db/vacations.js';
import {
  dateRangeProblem,
  expandAvailability,
  withoutClass,
} from '../../lib/availabilityExpansion.js';
import { now } from '../../lib/clock.js';
import { isUuid } from '../../lib/validators.js';

// Montado en /api/availability (app.js):
//   GET /api/availability?from&to[&excludeClassId]  con sesión (cualquier rol)
// Lo que el alumno puede reservar, ya expandido por fecha. La disponibilidad
// cruda del docente está en routes/teachers (/me/availability).
// Usa: db/availability.js, db/classes.js, db/vacations.js y
// lib/availabilityExpansion.js (expandAvailability, que deja solo `locality`
// y nunca el link ni la dirección exacta).

/**
 * La clase que el alumno está reprogramando, si `excludeClassId` es suya y
 * sigue confirmada (lo único que se puede reprogramar); si no, null y se
 * ignora en silencio. Esto solo cambia qué se le MUESTRA: el POST de
 * reprogramar vuelve a validar todo.
 *
 * @param {string|undefined} excludeClassId - query.excludeClassId (ya UUID).
 * @param {object} user - request.user.
 * @returns {Promise<object|null>} la clase (findClassById) o null.
 */
async function classBeingRescheduled(excludeClassId, user) {
  if (!excludeClassId) return null;
  const cls = await findClassById(excludeClassId);
  if (!cls || String(cls.studentId) !== String(user.id) || cls.status !== 'confirmada') {
    return null;
  }
  return cls;
}

export default async function availabilityRoutes(app) {
  /**
   * El tablero del alumno: la disponibilidad YA con fecha y YA neta de lo
   * reservado. Una fila por (ventana, fecha), con la modalidad, el cupo, las
   * materias que se pueden reservar (con su tarifa por hora), los tramos
   * libres (`free`) y las grupales a las que todavía se puede sumar
   * (`groups`). La duración la elige el alumno, así que no hay turnos
   * cerrados: ver openingsForWindow.
   *
   * El alumno nunca ve una ventana semanal: el puente entre "los lunes de 13
   * a 15:30" y "el lunes 14 de septiembre" se hace acá.
   *
   * `?excludeClassId=<id>`: al reprogramar, la clase vieja no ocupa su
   * horario (se cancela en la misma transacción que crea la nueva).
   *
   * Respuesta: 200 [{ ventana+fecha, teacherName, locality, subjects, free,
   *   groups, onVacation, … }] sin las del propio usuario.
   * Errores: 400 rango inválido (dateRangeProblem) o excludeClassId no UUID.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { from, to, excludeClassId } = request.query ?? {};

    const problem = dateRangeProblem(from, to);
    if (problem) return reply.code(400).send({ message: problem });
    if (excludeClassId !== undefined && !isUuid(excludeClassId)) {
      return reply.code(400).send({ message: 'La clase a reprogramar no es válida' });
    }

    // Una pendiente que llegó a su hora sin respuesta ya no ocupa el horario.
    const clock = now();
    await expireStartedPending(clock);

    const [windows, taken, vacations, excluded] = await Promise.all([
      findPublishedWindows({ from, to }),
      findTakenSlots({ from, to }),
      listVacationsInRange({ from, to }),
      classBeingRescheduled(excludeClassId, request.user),
    ]);

    const rows = expandAvailability({
      windows,
      taken: excluded ? withoutClass(taken, excluded) : taken,
      vacations,
      from,
      to,
      nowIso: clock.iso,
      nowTime: clock.time,
    });

    // El docente logueado no se ofrece a sí mismo como opción reservable.
    return reply.send(rows.filter((row) => row.teacherId !== request.user.id));
  });
}
