// Las reglas del ciclo de vida de una reserva: quién puede hacer qué, desde
// qué estado y cuándo. Viven acá, en funciones puras, y no en la base ni
// repartidas por las rutas: dependen de la hora actual (la regla de 24 h, "ya
// empezó"), y así cada regla se prueba sin Postgres ni reloj de verdad.
//
// Las fechas y horas son las de la app ('YYYY-MM-DD', 'HH:MM', hora
// argentina, sin zona) y `now` es lo que devuelve now() de lib/clock.js.
//
// Las reservas (`booking`) que reciben estas funciones están en la forma de
// la API (camelCase: status, date, startTime, endTime, paidAt, priceCents...),
// como las devuelven findBookingById / findClassBookings de db/bookings.js:
// estado y pago de la reserva, fecha y horario de su clase.
//
// Lo usan: routes/bookings/index.js (checkAction, cancelReasonFor, forViewer,
// BOOKING_STATUSES), routes/classes/index.js (checkAction sobre todas las
// reservas de una clase, forViewer), lib/classMaterials.js (hasEnded) y
// lib/neuronas.js (toEpochMinutes).
// Espejo: frontend/src/utils/bookingStates.js (allowedActions, hasStarted,
// hasEnded), SOLO para decidir qué botones mostrar: si cambia una regla acá,
// cambiala allá.

/**
 * Con cuánta anticipación puede el alumno cancelar (una ya aceptada o
 * confirmada) o reprogramar: la regla de 24 h de CLAUDE.md ("Cancel" y
 * "Reschedule").
 */
const CANCEL_NOTICE_HOURS = 24;

// Los valores del enum booking_status, en español porque se muestran tal cual.
// La ruta los usa para validar el filtro `?status=` de GET /api/bookings.
export const BOOKING_STATUSES = [
  'pendiente',
  'aceptada',
  'confirmada',
  'realizada',
  'no_presentada',
  'cancelada',
];

/**
 * Minutos desde el "epoch" tratando fecha y hora como hora local sin zona:
 * alcanza para restar dos momentos, que es lo único que se hace con esto.
 *
 * @param {string} iso - 'YYYY-MM-DD'.
 * @param {string} time - 'HH:MM' ('24:00' cae en la medianoche siguiente).
 * @returns {number}
 * Lo usan: este archivo y lib/neuronas.js.
 */
export function toEpochMinutes(iso, time) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) / 60000;
}

/**
 * Cuántos minutos faltan para que empiece la clase (negativo si ya empezó).
 * @param {{date: string, startTime: string}} booking
 * @param {{iso: string, time: string}} now - now() de lib/clock.js.
 */
export function minutesUntilStart(booking, now) {
  return toEpochMinutes(booking.date, booking.startTime) - toEpochMinutes(now.iso, now.time);
}

/** ¿Ya llegó la hora de inicio? (Mismos parámetros que minutesUntilStart.) */
export function hasStarted(booking, now) {
  return minutesUntilStart(booking, now) <= 0;
}

/**
 * Si la clase ya terminó. Un fin "24:00" cae bien: es la medianoche siguiente.
 * @param {{date: string, endTime: string}} booking
 * @param {{iso: string, time: string}} now - now() de lib/clock.js.
 * Lo usa también: lib/classMaterials.js (el material se habilita al terminar).
 */
export function hasEnded(booking, now) {
  return toEpochMinutes(booking.date, booking.endTime) <= toEpochMinutes(now.iso, now.time);
}

function withNotice(booking, now) {
  return minutesUntilStart(booking, now) >= CANCEL_NOTICE_HOURS * 60;
}

const NOTICE_MESSAGE = `Solo podés cancelar o reprogramar hasta ${CANCEL_NOTICE_HOURS} h antes de la clase.`;
const STARTED_MESSAGE = 'La clase ya empezó.';

const deny = (status, message) => ({ status, message });
const conflict = (message) => deny(409, message);

// Una regla por acción: (booking, { role, now }) → null si se puede, o
// { status, message }. Las acciones son las de POST /api/bookings/:id/<acción>
// (attend = /attendance) y las de POST /api/classes/:classId/{accept,cancel},
// que aplican la misma regla a cada reserva de la clase.
const RULES = {
  accept(booking, { role, now }) {
    if (role !== 'teacher') return deny(403, 'Solo el docente puede aceptar la clase.');
    if (booking.status !== 'pendiente') return conflict('Esta reserva ya no está esperando respuesta.');
    if (hasStarted(booking, now)) return conflict(STARTED_MESSAGE);
    return null;
  },

  cancel(booking, { role, now }) {
    if (!['pendiente', 'aceptada', 'confirmada'].includes(booking.status)) {
      return conflict('Esta clase ya no se puede cancelar.');
    }
    if (hasStarted(booking, now)) return conflict(STARTED_MESSAGE);
    // El docente puede cancelar hasta que empiece. El alumno también, pero
    // solo mientras el docente no aceptó: después aplica la regla de 24 h.
    if (role === 'student' && booking.status !== 'pendiente' && !withNotice(booking, now)) {
      return conflict(NOTICE_MESSAGE);
    }
    return null;
  },

  pay(booking, { role }) {
    if (role !== 'student') return deny(403, 'Solo el alumno puede pagar la clase.');
    if (booking.status === 'pendiente') return conflict('Vas a poder pagar cuando el docente acepte la clase.');
    if (booking.paidAt) return conflict('Esta clase ya está paga.');
    // Se puede pagar incluso después de la clase: por eso también desde
    // realizada o no presentada, que no cambian de estado (solo el pago).
    if (!['aceptada', 'realizada', 'no_presentada'].includes(booking.status)) {
      return conflict('Esta clase ya no se puede pagar.');
    }
    return null;
  },

  attend(booking, { role, now }) {
    if (role !== 'teacher') return deny(403, 'Solo el docente puede tomar lista.');
    // Aceptada también: el pago puede llegar después, y sin esto a quien no
    // viene y nunca paga no se lo podría marcar como ausente. Realizada y no
    // presentada, para poder corregir la marca.
    if (!['aceptada', 'confirmada', 'realizada', 'no_presentada'].includes(booking.status)) {
      return conflict('Solo se toma lista en clases aceptadas.');
    }
    if (!hasStarted(booking, now)) return conflict('Vas a poder tomar lista cuando empiece la clase.');
    return null;
  },

  reschedule(booking, { role, now }) {
    if (role !== 'student') return deny(403, 'Solo el alumno puede reprogramar la clase.');
    if (booking.status !== 'confirmada') return conflict('Solo se puede reprogramar una clase confirmada.');
    if (!withNotice(booking, now)) return conflict(NOTICE_MESSAGE);
    return null;
  },
};

/**
 * ¿Puede `role` hacer `action` sobre la reserva ahora? Es la regla AUTORITATIVA
 * del ciclo de vida de una reserva. No chequea que el usuario sea parte de
 * ella: eso lo hace la ruta antes (un 404, para no contar que existe).
 *
 * @param {'accept'|'cancel'|'pay'|'attend'|'reschedule'} action - sale de la URL
 *   (POST /api/bookings/:id/<acción> o /api/classes/:classId/<acción>).
 * @param {object} booking - la reserva como la devuelve db/bookings.js (status, date,
 *   startTime, endTime, paidAt...).
 * @param {{role: 'teacher'|'student', now: {iso, time}}} ctx - `role` es el papel
 *   del usuario de la sesión EN ESA RESERVA (lo deciden loadOwnBooking o
 *   loadOwnClass en la ruta) y `now` sale de now() de lib/clock.js.
 * @returns {null|{status: number, message: string}} null si se puede; si no, el
 *   código HTTP (400/403/409) y el motivo en español para mostrar.
 * Lo usan: routes/bookings/index.js (acciones de una reserva) y routes/classes/index.js
 *   (acciones de la clase entera).
 * Espejo: frontend/src/utils/bookingStates.js (allowedActions).
 */
export function checkAction(action, booking, ctx) {
  const rule = RULES[action];
  if (!rule) return deny(400, 'Acción inválida');
  return rule(booking, ctx);
}

/**
 * Por qué queda cancelada: que el docente diga que no a una pendiente es un
 * rechazo, no una cancelación de algo que ya estaba acordado.
 *
 * @param {{status: string}} booking - la reserva ANTES de cancelarla.
 * @param {'teacher'|'student'} role - quién cancela.
 * @returns {'rechazada'|'cancelada'} el valor para class_bookings.cancel_reason.
 * Lo usa: applyCancel (acá).
 */
export function cancelReasonFor(booking, role) {
  return role === 'teacher' && booking.status === 'pendiente' ? 'rechazada' : 'cancelada';
}

/**
 * A qué estado pasa una reserva al aceptarla. Una que el paquete o el canje
 * cubren entera ya está paga: aceptarla la confirma directo, sin pasar por
 * "aceptada, falta pagar". Si se pasa de lo cubierto, ese resto se paga como
 * cualquier reserva.
 *
 * @param {{booking: object}} args - la reserva leída (findBookingById / findClassBookings).
 * @returns {{to: string, paid?: boolean}} el cambio para transitionBooking(s).
 * Lo usan: routes/bookings/index.js (POST /:id/accept) y routes/classes/index.js
 *   (POST /:classId/accept).
 */
export function applyAccept({ booking }) {
  return (booking.studentPackId || booking.rewardType) && booking.priceCents === 0
    ? { to: 'confirmada', paid: true }
    : { to: 'aceptada' };
}

/**
 * El cambio de cancelar una reserva, con quién la canceló y por qué.
 *
 * @param {{booking: object, role: 'teacher'|'student'}} args - `role` es el papel en esa reserva.
 * @returns {{to: 'cancelada', cancelledBy: string, cancelReason: string}}
 * Lo usan: routes/bookings/index.js (POST /:id/cancel) y routes/classes/index.js
 *   (POST /:classId/cancel).
 */
export function applyCancel({ booking, role }) {
  return { to: 'cancelada', cancelledBy: role, cancelReason: cancelReasonFor(booking, role) };
}

/**
 * Si quien mira puede ver la dirección exacta de la clase. El docente,
 * siempre. El alumno, recién cuando la clase está paga (o no hay nada que
 * pagar: gratis, o cubierta entera por un paquete, que ya queda paga al
 * aceptarse); antes ve solo la localidad. Una pendiente o cancelada, nunca.
 *
 * @param {{status: string, paidAt: string|null, priceCents: number}} booking
 * @param {'teacher'|'student'} role
 * @returns {boolean}
 * Lo usa: forViewer (este archivo).
 */
export function canSeeExactAddress(booking, role) {
  // FILTRO: el alumno no ve la dirección exacta hasta pagar (o si la clase es
  // gratis / cubierta entera): antes alcanza con la localidad.
  if (role === 'teacher') return true;
  if (booking.status === 'pendiente' || booking.status === 'cancelada') return false;
  return Boolean(booking.paidAt) || booking.priceCents === 0;
}

/**
 * La reserva como la tiene que recibir `role`: sin la dirección exacta
 * (`address: null`) si no le corresponde. Se aplica a toda reserva que sale por
 * la API hacia un alumno.
 *
 * @param {object|null} booking - la reserva de findBookingById / findBookingsForUser
 *   (db/bookings.js).
 * @param {'teacher'|'student'} role - el rol de la sesión (request.user.role) o el
 *   papel en esa reserva.
 * @returns {object|null} la misma reserva, o una copia con address null.
 * Lo usa: routes/bookings/index.js.
 */
export function forViewer(booking, role) {
  // FILTRO: saca `address` de toda reserva que va a un alumno que todavía no la
  // puede ver (canSeeExactAddress).
  if (!booking || canSeeExactAddress(booking, role)) return booking;
  return { ...booking, address: null };
}
