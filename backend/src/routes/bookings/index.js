import {
  createBooking,
  expireStartedPending,
  findBookingById,
  findBookingsForUser,
  rescheduleBooking,
  studentHasOverlappingBooking,
  transitionBooking,
} from '../../db/bookings.js';
import { findWindowById } from '../../db/availability.js';
import { findRate } from '../../db/rates.js';
import { listStudentPacks } from '../../db/packs.js';
import { StudentPack } from '../../lib/classPacks.js';
import { findBalance, settleHomeworkCredits } from '../../db/neuronas.js';
import { REWARDS, rewardProblem } from '../../lib/neuronas.js';
import { isTeacherOnVacation } from '../../db/vacations.js';
import { VACATION_MESSAGE } from '../../lib/vacations.js';
import { occursOn, toMinutes, toTime } from '../../lib/availabilityExpansion.js';
import { bookingPriceCents, isValidClassMinutes, MIN_CLASS_MINUTES } from '../../lib/teacherRates.js';
import {
  BOOKING_STATUSES,
  applyAccept,
  applyCancel,
  checkAction,
  forViewer,
} from '../../lib/bookingStates.js';
import { now } from '../../lib/clock.js';
import { TeacherApproval } from '../../lib/teacherApproval.js';
import { isRealDate, isUuid } from '../../lib/validators.js';

// Montado en /api/bookings (app.js). Una reserva es el lugar de UN alumno en
// una clase (class_bookings); "dueño" = el docente de su clase o su alumno
// (loadOwnBooking). Una reserva ajena es 404.
//   GET    /api/bookings?from&to[&status]          con sesión: las del usuario según su rol
//   GET    /api/bookings/:id                       dueño
//   POST   /api/bookings                           solo student (CSRF): reservar
//   POST   /api/bookings/:id/accept                dueño (CSRF; checkAction: docente)
//   POST   /api/bookings/:id/cancel                dueño (CSRF)
//   POST   /api/bookings/:id/pay                   dueño (CSRF; checkAction: alumno)
//   POST   /api/bookings/:id/attendance            dueño (CSRF; checkAction: docente)
//   POST   /api/bookings/:id/reschedule            dueño (CSRF; checkAction: alumno, confirmada)
// Lo que es de la clase entera (aceptar o cancelar a todos, material) está en
// routes/classes (/api/classes/:classId/…).
// Las reglas de cada acción las decide lib/bookingStates.js (checkAction);
// cada reserva que va a un alumno sale por forViewer (sin dirección exacta
// hasta pagar).
// Usa: db/bookings.js, db/availability.js, db/rates.js, db/packs.js,
// db/neuronas.js, db/vacations.js y varios lib/*.
// Los errores salen como { message } (+ `fields` en validaciones); no hay código `error`.

const TIME_RE = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const NO_LONGER_OFFERED = 'Ese horario ya no está disponible.';
const NOT_FOUND = 'Esa reserva no existe.';
const CHANGED_MEANWHILE = 'La reserva cambió mientras tanto. Recargá la página.';

// El { error } que devuelven los helpers de validación: status + body listo para mandar.
const fail = (status, message, fields) => ({ error: { status, body: fields ? { message, fields } : { message } } });

/**
 * Todo lo que se valida antes de reservar, compartido por reservar y
 * reprogramar. Se valida de nuevo todo lo que ya valida la pantalla, porque la
 * pantalla se puede saltear.
 *
 * Al reprogramar, `fixed` trae la reserva vieja: la materia sale de ella (no
 * del body), la ventana tiene que ser del mismo docente, y la reserva vieja no
 * cuenta como choque (se cancela en la misma transacción).
 *
 * `packId` + `packTokens` en el body usan `packTokens` clases de un paquete
 * del alumno con ese docente (cada una cubre la duración fija del paquete).
 * Lo cubierto no se paga; lo que se pasa se paga aparte con la tarifa de la
 * materia. Su asistencia descuenta esas clases del paquete. Al reprogramar
 * vale lo mismo: la vieja libera las suyas en la misma transacción.
 *
 * `rewardType` canjea neuronas por la clase o parte de ella, si el docente acepta
 * canjes. No se combina con un paquete. Al reprogramar, el canje de la clase
 * vieja vuelve al saldo en la misma transacción, así que se puede volver a usar.
 *
 * Devuelve { booking } listo para createBooking/rescheduleBooking, o { error }.
 *
 * @param {object} body - request.body: { windowId, date, startTime, durationMinutes,
 *   subjectId (no al reprogramar), packId?, packTokens?, rewardType? }.
 * @param {object} user - request.user (el alumno).
 * @param {object|null} [fixed] - la reserva vieja (findBookingById) al reprogramar.
 * @returns {Promise<{booking: object}|{error: {status, body}}>}
 */
async function validateBooking(body, user, fixed = null) {
  const parsed = parseBookingBody(body, fixed);
  if (parsed.error) return parsed;
  const { input } = parsed;
  const clock = now();

  const slot = await checkWindowSlot(input, user, fixed, clock);
  if (slot.error) return slot;

  const price = await priceBooking(input, slot, user, fixed, clock);
  if (price.error) return price;

  return {
    booking: {
      window: slot.window,
      studentId: user.id,
      date: input.date,
      startTime: input.startTime,
      endTime: slot.endTime,
      subjectId: input.subjectId,
      // Lo cubierto por el paquete ya se pagó al comprarlo: el precio de la
      // clase es solo lo que se pasa (0 si el paquete la cubre entera).
      priceCents: price.priceCents,
      studentPackId: input.packId,
      packTokens: input.packTokens,
      rewardType: input.rewardType,
      rewardNeuronas: price.rewardNeuronas,
    },
  };
}

/**
 * La forma del body, sin tocar la base. Devuelve { input } o { error }.
 * Después de esto, packId es null o un UUID, y sin paquete packTokens es 0.
 *
 * @returns {{input: {windowId, date, startTime, durationMinutes, subjectId, packId,
 *   packTokens, rewardType}}|{error}} solo errores 400.
 */
function parseBookingBody(body, fixed) {
  const { windowId, date, startTime, durationMinutes } = body ?? {};
  const subjectId = fixed ? fixed.subjectId : body?.subjectId;
  const { packId = null, packTokens = 0, rewardType = null } = body ?? {};

  // isRealDate y no solo la forma: '2026-02-30' en una ventana semanal
  // llegaba a Postgres y volvía como un 500.
  if (!isRealDate(date)) return fail(400, 'Fecha inválida', { date: 'invalid' });
  if (!TIME_RE.test(startTime ?? '')) {
    return fail(400, 'La clase tiene que empezar en punto o y media.', { startTime: 'invalid' });
  }
  if (!windowId) return fail(400, 'Falta la clase', { windowId: 'required' });
  if (!isUuid(String(windowId))) return fail(400, 'Clase inválida', { windowId: 'invalid' });
  if (!subjectId) return fail(400, 'Elegí la materia de la clase.', { subjectId: 'required' });
  if (!isUuid(String(subjectId))) return fail(400, 'Materia inválida', { subjectId: 'invalid' });
  if (packId !== null && !isUuid(String(packId))) {
    return fail(400, 'Paquete inválido', { packId: 'invalid' });
  }
  if (packTokens !== 0 && packId === null) {
    return fail(400, 'Elegí de qué paquete usás las clases.', { packId: 'required' });
  }
  if (rewardType !== null && !Object.hasOwn(REWARDS, rewardType)) {
    return fail(400, 'Canje inválido', { rewardType: 'invalid' });
  }
  if (rewardType !== null && packId !== null) {
    return fail(400, 'Usá un paquete o neuronas, no los dos.', { rewardType: 'invalid' });
  }
  if (!isValidClassMinutes(durationMinutes)) {
    return fail(400, `La clase dura como mínimo ${MIN_CLASS_MINUTES} minutos, de a 5.`, {
      durationMinutes: 'invalid',
    });
  }
  return {
    input: { windowId, date, startTime, durationMinutes, subjectId, packId, packTokens, rewardType },
  };
}

/**
 * Que la ventana siga ofreciendo ese horario a este alumno: existe ese día,
 * el docente está aprobado y no está de licencia, da esa materia en esa
 * modalidad, la clase entra y el alumno no se choca consigo mismo.
 * Devuelve { window, hourlyRateCents, endTime } o { error }.
 *
 * Origen: findWindowById, isTeacherOnVacation, findRate y studentHasOverlappingBooking.
 * Errores: 400 ya pasó / reservarse a sí mismo; 409 ya no se ofrece, licencia,
 *   otro docente al reprogramar, sin tarifa, no entra, choque propio; el de
 *   TeacherApproval.bookingProblem si el docente no está aprobado.
 */
async function checkWindowSlot(input, user, fixed, { iso, time }) {
  const { windowId, date, startTime, durationMinutes, subjectId } = input;
  if (date < iso || (date === iso && startTime <= time)) return fail(400, 'Ese horario ya pasó.');

  const window = await findWindowById(windowId);
  // Borrada o de otro día: para el alumno es lo mismo, ya no se ofrece.
  if (!window || !occursOn(window, date)) return fail(409, NO_LONGER_OFFERED);
  if (window.teacherId === user.id) return fail(400, 'No podés reservarte una clase a vos mismo.');
  // El tablero ya no ofrece ventanas de docentes sin aprobar, pero el id de
  // una ventana se puede mandar igual: el que decide es esto.
  const notBookable = new TeacherApproval(window.teacherApprovalStatus).bookingProblem();
  if (notBookable) return fail(notBookable.status, notBookable.message);
  // Lo mismo con las vacaciones: el tablero muestra la ventana en gris, pero
  // el id se puede mandar igual.
  if (await isTeacherOnVacation(window.teacherId, date)) return fail(409, VACATION_MESSAGE);
  if (fixed && String(window.teacherId) !== String(fixed.teacherId)) {
    return fail(409, 'Para reprogramar elegí un horario del mismo docente.');
  }

  // La tarifa es lo que ata la materia al docente y a la modalidad: sin
  // ella, esa materia no se da así (o el docente la sacó del perfil). Al
  // reprogramar puede cambiar la modalidad, y con ella el precio.
  const hourlyRateCents = await findRate({
    teacherId: window.teacherId,
    subjectId,
    modality: window.modality,
  });
  if (hourlyRateCents === null) return fail(409, 'El docente ya no da esa materia en esta modalidad.');

  const start = toMinutes(startTime);
  const end = start + durationMinutes;
  if (start < toMinutes(window.start) || start >= toMinutes(window.end)) {
    return fail(409, NO_LONGER_OFFERED);
  }
  if (end > toMinutes(window.end)) {
    return fail(409, 'La clase no entra en el horario del docente. Elegí una duración más corta.', {
      durationMinutes: 'invalid',
    });
  }
  const endTime = toTime(end);

  // Antes que nada, el choque del propio alumno: si no, salta primero la
  // restricción del docente y el mensaje diría "lo reservó otra persona"
  // cuando en realidad se está pisando con una clase suya.
  const clashesWithMine = await studentHasOverlappingBooking({
    studentId: user.id,
    date,
    startTime,
    endTime,
    excludeBookingId: fixed ? fixed.id : null,
  });
  if (clashesWithMine) return fail(409, 'Ya tenés una clase reservada en ese horario.');

  return { window, hourlyRateCents, endTime };
}

/**
 * El precio, con el paquete o el canje si los hay (excluyentes: lo asegura
 * parseBookingBody). La cuenta es bookingPriceCents; acá se chequea que el
 * paquete o el canje se puedan usar. Devuelve { priceCents, rewardNeuronas }
 * o { error }.
 *
 * Origen: listStudentPacks (paquetes del alumno con ese docente),
 *   settleHomeworkCredits + findBalance (saldo, solo con canje).
 */
async function priceBooking(input, { window, hourlyRateCents }, user, fixed, { iso, time }) {
  const { date, durationMinutes: minutes, packId, packTokens, rewardType } = input;
  let packClassMinutes = 0;
  let rewardNeuronas = 0;

  if (packId) {
    const rows = await listStudentPacks({
      studentId: user.id,
      teacherId: window.teacherId,
      excludeBookingId: fixed ? fixed.id : null,
    });
    // Solo un paquete propio y con este docente: un id ajeno da lo mismo que
    // uno que no existe.
    const row = rows.find((item) => String(item.id) === String(packId));
    if (!row) return fail(409, 'No tenés ese paquete con este docente.');
    const pack = new StudentPack(row);
    const problem = pack.bookingProblem({ date, today: iso, tokens: packTokens, minutes });
    if (problem) return fail(problem.status, problem.message, { packTokens: 'invalid' });
    packClassMinutes = pack.classMinutes;
  }

  if (rewardType) {
    if (!window.teacherAcceptsRewards) return fail(409, 'Este docente no acepta canjes de neuronas.');
    const problem = rewardProblem(rewardType, { hourlyRateCents, minutes });
    if (problem) return fail(409, problem, { rewardType: 'invalid' });

    rewardNeuronas = REWARDS[rewardType].cost;
    await settleHomeworkCredits(user.id, { iso, time });
    const { balance } = await findBalance(user.id);
    const freed = fixed ? fixed.rewardNeuronas : 0;
    if (balance + freed < rewardNeuronas) return fail(409, 'No te alcanzan las neuronas.');
  }

  const priceCents = bookingPriceCents({
    hourlyRateCents,
    minutes,
    packClassMinutes,
    packTokens,
    rewardType,
  });
  return { priceCents, rewardNeuronas };
}

export default async function bookingsRoutes(app) {
  /**
   * Las reservas del usuario logueado en un rango. Como docente son las de
   * las clases que da, como alumno las suyas — sale del rol de la sesión, así
   * que nadie ve la agenda de otro.
   *
   * Antes vence las pendientes que ya empezaron (expireStartedPending).
   * Respuesta: 200 [reservas de findBookingsForUser pasadas por forViewer].
   * Errores: 400 rango o estado inválido.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { from, to, status } = request.query ?? {};

    if (!isRealDate(from) || !isRealDate(to)) {
      return reply.code(400).send({ message: 'Rango de fechas inválido' });
    }
    if (status !== undefined && !BOOKING_STATUSES.includes(status)) {
      return reply.code(400).send({ message: 'Estado inválido' });
    }

    await expireStartedPending(now());
    const bookings = await findBookingsForUser({
      userId: request.user.id,
      role: request.user.role,
      from,
      to,
      status,
    });
    // La dirección exacta, solo si ya pagó (lib/bookingStates.js).
    return reply.send(bookings.map((booking) => forViewer(booking, request.user.role)));
  });

  /**
   * La reserva y desde qué lado la mira el usuario, o null si no es suya. El
   * rol sale de la reserva y no de la sesión: es el docente de su clase o su
   * alumno. Una reserva ajena da 404 y no 403, para no contar que existe.
   *
   * @param {object} request - usa params.id y request.user.id.
   * @returns {Promise<{booking: object, role: 'teacher'|'student'}|null>} booking de
   *   findBookingById.
   */
  async function loadOwnBooking(request) {
    const { id } = request.params;
    if (!isUuid(id)) return null;
    await expireStartedPending(now());
    const booking = await findBookingById(id);
    if (!booking) return null;
    // FILTRO: una reserva solo la ven el docente de su clase y su alumno; ajena = 404.
    if (String(booking.teacherId) === String(request.user.id)) return { booking, role: 'teacher' };
    if (String(booking.studentId) === String(request.user.id)) return { booking, role: 'student' };
    return null;
  }

  /** Una reserva propia. Respuesta: 200 forViewer(reserva). Errores: 404. */
  app.get('/:id', { onRequest: app.requireAuth }, async (request, reply) => {
    const own = await loadOwnBooking(request);
    if (!own) return reply.code(404).send({ message: NOT_FOUND });
    return reply.send(forViewer(own.booking, own.role));
  });

  /**
   * Arma la ruta de una acción sobre una reserva (aceptar, cancelar, pagar,
   * tomar lista). Las reglas de si se puede las decide checkAction; `apply`
   * dice a qué estado pasa. Si entre que se leyó y se escribió el otro la
   * cambió, transitionBooking no pisa nada y se avisa con un 409.
   *
   * @param {'accept'|'cancel'|'pay'|'attend'} name - 'attend' se monta como /attendance.
   * @param {(own, body) => object} apply - el cambio ({ to, paid?, cancelledBy?,
   *   cancelReason? }) o { error } (400).
   * Respuesta: 200 forViewer(reserva actualizada). Errores: 404, el status de
   *   checkAction (403/409…), 400 body inválido, 409 cambió en el medio.
   */
  function action(name, apply) {
    app.post(
      `/:id/${name === 'attend' ? 'attendance' : name}`,
      { onRequest: [app.requireAuth, app.csrfProtection] },
      async (request, reply) => {
        const own = await loadOwnBooking(request);
        if (!own) return reply.code(404).send({ message: NOT_FOUND });

        const denied = checkAction(name, own.booking, { role: own.role, now: now() });
        if (denied) return reply.code(denied.status).send({ message: denied.message });

        const change = apply(own, request.body ?? {});
        if (change.error) return reply.code(400).send(change.error);

        const done = await transitionBooking(own.booking.id, { from: own.booking.status, ...change });
        if (!done) return reply.code(409).send({ message: CHANGED_MEANWHILE });

        return reply.send(forViewer(await findBookingById(own.booking.id), own.role));
      }
    );
  }

  action('accept', applyAccept);
  action('cancel', applyCancel);

  // Pagar una aceptada la confirma; una realizada o no presentada que se
  // debía queda en su estado, solo con el pago registrado.
  action('pay', ({ booking }) => ({
    to: booking.status === 'aceptada' ? 'confirmada' : booking.status,
    paid: true,
  }));

  // Tomar lista. Body: { attended: boolean }.
  action('attend', (own, body) => {
    if (typeof body.attended !== 'boolean') {
      return { error: { message: 'Falta indicar si el alumno estuvo.', fields: { attended: 'required' } } };
    }
    return { to: body.attended ? 'realizada' : 'no_presentada' };
  });

  /**
   * Reservar un lugar en una clase de una ventana. El alumno sale de la sesión; el
   * docente, la modalidad y el lugar salen de la ventana. El body dice cuál,
   * qué día, a qué hora, de qué materia y cuánto dura — y el precio lo
   * calcula el backend con la tarifa del docente, nunca llega en el body.
   *
   * La reserva nace pendiente: el docente todavía tiene que aceptarla. El
   * empate entre dos alumnos que reservan a la vez lo resuelven createBooking
   * (grupales y cupo) y las restricciones de la tabla (horarios).
   *
   * Body: ver validateBooking. Respuesta: 201 forViewer(reserva nueva, 'student').
   * Errores: 403 no alumno; los 400/409 de validateBooking; 409 conflicto en
   *   createBooking (horario tomado, grupal llena, licencia, paquete, saldo).
   */
  app.post('/', { onRequest: [app.requireAuth, app.csrfProtection] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.code(403).send({ message: 'Solo los alumnos pueden reservar clases' });
    }

    // Una pendiente vencida sigue ocupando el horario hasta que se la marca:
    // sin esto, bloqueaba la reserva hasta que alguien leyera reservas.
    // (Reprogramar ya pasa por acá en loadOwnBooking.)
    await expireStartedPending(now());
    const checked = await validateBooking(request.body, request.user);
    if (checked.error) return reply.code(checked.error.status).send(checked.error.body);

    const created = await createBooking(checked.booking);
    if (created.conflict) return reply.code(409).send({ message: created.conflict });

    return reply.code(201).send(forViewer(await findBookingById(created.id), 'student'));
  });

  /**
   * Reprogramar una reserva confirmada: queda cancelada ("reprogramada") y se
   * reserva otro horario con el mismo docente y la misma materia. La nueva
   * nace pendiente y se vuelve a pagar: puede cambiar la modalidad, y con
   * ella el precio. Mismo body que reservar, sin materia.
   *
   * Respuesta: 201 forViewer(reserva nueva, 'student').
   * Errores: 404; el de checkAction('reschedule'); los de validateBooking;
   *   409 conflicto en rescheduleBooking.
   */
  app.post(
    '/:id/reschedule',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const own = await loadOwnBooking(request);
      if (!own) return reply.code(404).send({ message: NOT_FOUND });

      const denied = checkAction('reschedule', own.booking, { role: own.role, now: now() });
      if (denied) return reply.code(denied.status).send({ message: denied.message });

      const checked = await validateBooking(request.body, request.user, own.booking);
      if (checked.error) return reply.code(checked.error.status).send(checked.error.body);

      const created = await rescheduleBooking(own.booking.id, checked.booking);
      if (created.conflict) return reply.code(409).send({ message: created.conflict });

      return reply.code(201).send(forViewer(await findBookingById(created.id), 'student'));
    }
  );
}
