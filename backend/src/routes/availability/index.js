import { findPublishedWindows } from '../../db/availability.js';
import {
  expireStartedPending,
  findClassById,
  findClassesForUser,
  findTakenSlots,
} from '../../db/classes.js';
import { listVacationsInRange } from '../../db/vacations.js';
import { bookableRows, dateRangeProblem } from '../../lib/availabilityExpansion.js';
import { now } from '../../lib/clock.js';
import { isUuid } from '../../lib/validators.js';

// Montado en /api/availability (app.js):
//   GET /api/availability?from&to[&excludeClassId]  con sesión (cualquier rol)
// Lo que el alumno puede reservar, ya expandido por fecha. La disponibilidad
// cruda del docente está en routes/teachers (/me/availability).
// Esta ruta solo lee de la base: qué se muestra lo decide bookableRows
// (lib/availabilityExpansion.js), que además deja solo `locality` y nunca el
// link ni la dirección exacta.

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
  // FILTRO: solo una clase propia y confirmada cambia lo que se muestra; con
  // cualquier otra el parámetro se ignora.
  if (!cls || String(cls.studentId) !== String(user.id) || cls.status !== 'confirmada') {
    return null;
  }
  return cls;
}

/**
 * Las clases no canceladas del alumno en el rango, con cualquier docente:
 * con ellas bookableRows saca lo que se le pisa. A quien no es alumno no se
 * le cruza nada.
 */
async function ownLessons(user, from, to) {
  if (user.role !== 'student') return [];
  const lessons = await findClassesForUser({ userId: user.id, role: 'student', from, to });
  // FILTRO: una cancelada no ocupa el horario del alumno.
  return lessons.filter((lesson) => lesson.status !== 'cancelada');
}

export default async function availabilityRoutes(app) {
  /**
   * El tablero del alumno: la disponibilidad YA con fecha, YA neta de lo
   * reservado con el docente y de las clases propias del alumno. Una fila por
   * (ventana, fecha) con la modalidad, el cupo, las materias que se pueden
   * reservar (con su tarifa por hora), los inicios posibles con su duración
   * máxima (`starts`) y las grupales a las que este alumno se puede sumar
   * (`groups`). Las filas sin nada para reservar no salen, salvo las de
   * licencia (en gris, con `onVacation`).
   *
   * `?excludeClassId=<id>`: al reprogramar, la clase vieja no ocupa su
   * horario, y solo salen el mismo docente y la misma materia.
   *
   * Respuesta: 200 [filas de bookableRows].
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

    const [windows, taken, vacations, studentLessons, rescheduling] = await Promise.all([
      findPublishedWindows({ from, to, today: clock.iso }),
      findTakenSlots({ from, to }),
      listVacationsInRange({ from, to }),
      ownLessons(request.user, from, to),
      classBeingRescheduled(excludeClassId, request.user),
    ]);

    return reply.send(
      bookableRows({
        windows,
        taken,
        vacations,
        studentLessons,
        rescheduling,
        viewerId: request.user.id,
        from,
        to,
        now: clock,
      })
    );
  });
}
