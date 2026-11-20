import { findPublishedWindows } from '../../db/availability.js';
import { expireStartedPending, findBookingById, findBookingsForUser } from '../../db/bookings.js';
import { findActiveClasses } from '../../db/classes.js';
import { listVacationsInRange } from '../../db/vacations.js';
import { bookableRows, dateRangeProblem } from '../../lib/availabilityExpansion.js';
import { now } from '../../lib/clock.js';
import { isUuid } from '../../lib/validators.js';

// Montado en /api/availability (app.js):
//   GET /api/availability?from&to[&excludeBookingId]  con sesión (cualquier rol)
// Lo que el alumno puede reservar, ya expandido por fecha. La disponibilidad
// cruda del docente está en routes/teachers (/me/availability).
// Esta ruta solo lee de la base: qué se muestra lo decide bookableRows
// (lib/availabilityExpansion.js), que además deja solo `locality` y nunca el
// link ni la dirección exacta.

/**
 * La reserva que el alumno está reprogramando, si `excludeBookingId` es suya
 * y sigue confirmada (lo único que se puede reprogramar); si no, null y se
 * ignora en silencio. Esto solo cambia qué se le MUESTRA: el POST de
 * reprogramar vuelve a validar todo.
 *
 * @param {string|undefined} excludeBookingId - query.excludeBookingId (ya UUID).
 * @param {object} user - request.user.
 * @returns {Promise<object|null>} la reserva (findBookingById) o null.
 */
async function bookingBeingRescheduled(excludeBookingId, user) {
  if (!excludeBookingId) return null;
  const booking = await findBookingById(excludeBookingId);
  // FILTRO: solo una reserva propia y confirmada cambia lo que se muestra; con
  // cualquier otra el parámetro se ignora.
  if (!booking || String(booking.studentId) !== String(user.id) || booking.status !== 'confirmada') {
    return null;
  }
  return booking;
}

/**
 * Las reservas no canceladas del alumno en el rango, con cualquier docente:
 * con ellas bookableRows saca lo que se le pisa. A quien no es alumno no se
 * le cruza nada.
 */
async function ownBookings(user, from, to) {
  if (user.role !== 'student') return [];
  const bookings = await findBookingsForUser({ userId: user.id, role: 'student', from, to });
  // FILTRO: una cancelada no ocupa el horario del alumno.
  return bookings.filter((booking) => booking.status !== 'cancelada');
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
   * `?excludeBookingId=<id>`: al reprogramar, la reserva vieja no ocupa su
   * horario, y solo salen el mismo docente y la misma materia.
   *
   * Respuesta: 200 [filas de bookableRows].
   * Errores: 400 rango inválido (dateRangeProblem) o excludeBookingId no UUID.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { from, to, excludeBookingId } = request.query ?? {};

    const problem = dateRangeProblem(from, to);
    if (problem) return reply.code(400).send({ message: problem });
    if (excludeBookingId !== undefined && !isUuid(excludeBookingId)) {
      return reply.code(400).send({ message: 'La clase a reprogramar no es válida' });
    }

    // Una pendiente que llegó a su hora sin respuesta ya no ocupa el horario.
    const clock = now();
    await expireStartedPending(clock);

    const [windows, activeClasses, vacations, studentBookings, rescheduling] = await Promise.all([
      findPublishedWindows({ from, to, today: clock.iso }),
      findActiveClasses({ from, to }),
      listVacationsInRange({ from, to }),
      ownBookings(request.user, from, to),
      bookingBeingRescheduled(excludeBookingId, request.user),
    ]);

    return reply.send(
      bookableRows({
        windows,
        activeClasses,
        vacations,
        studentBookings,
        rescheduling,
        viewerId: request.user.id,
        from,
        to,
        now: clock,
      })
    );
  });
}
