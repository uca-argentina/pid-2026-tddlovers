import {
  bookClass,
  expireStartedPending,
  findClassById,
  findClassesForUser,
  hasOverlappingClass,
  rescheduleClass,
  transitionClass,
} from '../../db/classes.js';
import { findWindowById } from '../../db/availability.js';
import { findRate } from '../../db/rates.js';
import { occursOn, toMinutes, toTime } from '../../lib/availabilityExpansion.js';
import { classPriceCents, isValidClassMinutes, MIN_CLASS_MINUTES } from '../../lib/teacherRates.js';
import { CLASS_STATUSES, cancelReasonFor, checkAction } from '../../lib/classStates.js';
import { now } from '../../lib/clock.js';
import { TeacherApproval } from '../../lib/teacherApproval.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
// Los ids son UUID: validarlo acá evita que un id cualquiera llegue a la base
// y vuelva como un 500 en vez de un 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_LONGER_OFFERED = 'Ese horario ya no está disponible.';
const NOT_FOUND = 'Esa clase no existe.';
const CHANGED_MEANWHILE = 'La clase cambió mientras tanto. Recargá la página.';

const fail = (status, message, fields) => ({ error: { status, body: fields ? { message, fields } : { message } } });

/**
 * Todo lo que se valida antes de reservar, compartido por reservar y
 * reprogramar. Se valida de nuevo todo lo que ya valida la pantalla, porque la
 * pantalla se puede saltear.
 *
 * Al reprogramar, `fixed` trae la clase vieja: la materia sale de ella (no del
 * body), la ventana tiene que ser del mismo docente, y la clase vieja no
 * cuenta como choque (se cancela en la misma transacción).
 *
 * Devuelve { booking } listo para bookClass/rescheduleClass, o { error }.
 */
async function validateBooking(body, user, fixed = null) {
  const { windowId, date, startTime, durationMinutes } = body ?? {};
  const subjectId = fixed ? fixed.subjectId : body?.subjectId;

  if (!ISO_DATE_RE.test(date ?? '')) return fail(400, 'Fecha inválida', { date: 'invalid' });
  if (!TIME_RE.test(startTime ?? '')) {
    return fail(400, 'La clase tiene que empezar en punto o y media.', { startTime: 'invalid' });
  }
  if (!windowId) return fail(400, 'Falta la clase', { windowId: 'required' });
  if (!UUID_RE.test(String(windowId))) return fail(400, 'Clase inválida', { windowId: 'invalid' });
  if (!subjectId) return fail(400, 'Elegí la materia de la clase.', { subjectId: 'required' });
  if (!UUID_RE.test(String(subjectId))) return fail(400, 'Materia inválida', { subjectId: 'invalid' });
  if (!isValidClassMinutes(durationMinutes)) {
    return fail(400, `La clase dura como mínimo ${MIN_CLASS_MINUTES} minutos, de a 5.`, {
      durationMinutes: 'invalid',
    });
  }

  const { iso, time } = now();
  if (date < iso || (date === iso && startTime <= time)) return fail(400, 'Ese horario ya pasó.');

  const window = await findWindowById(windowId);
  // Borrada o de otro día: para el alumno es lo mismo, ya no se ofrece.
  if (!window || !occursOn(window, date)) return fail(409, NO_LONGER_OFFERED);
  if (window.teacherId === user.id) return fail(400, 'No podés reservarte una clase a vos mismo.');
  // El tablero ya no ofrece ventanas de docentes sin aprobar, pero el id de
  // una ventana se puede mandar igual: el que decide es esto.
  const notBookable = new TeacherApproval(window.teacherApprovalStatus).bookingProblem();
  if (notBookable) return fail(notBookable.status, notBookable.message);
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
  const clashesWithMine = await hasOverlappingClass({
    userId: user.id,
    role: 'student',
    date,
    startTime,
    endTime,
    excludeId: fixed ? fixed.id : null,
  });
  if (clashesWithMine) return fail(409, 'Ya tenés una clase reservada en ese horario.');

  return {
    booking: {
      window,
      studentId: user.id,
      date,
      startTime,
      endTime,
      subjectId,
      priceCents: classPriceCents(hourlyRateCents, durationMinutes),
    },
  };
}

export default async function classesRoutes(app) {
  /**
   * Las clases del usuario logueado en un rango. Como docente son las que da,
   * como alumno las que reservó — sale del rol de la sesión, así que nadie ve
   * la agenda de otro.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { from, to, status } = request.query ?? {};

    if (!ISO_DATE_RE.test(from ?? '') || !ISO_DATE_RE.test(to ?? '')) {
      return reply.code(400).send({ message: 'Rango de fechas inválido' });
    }
    if (status !== undefined && !CLASS_STATUSES.includes(status)) {
      return reply.code(400).send({ message: 'Estado inválido' });
    }

    await expireStartedPending(now());
    const classes = await findClassesForUser({
      userId: request.user.id,
      role: request.user.role,
      from,
      to,
      status,
    });
    return reply.send(classes);
  });

  /**
   * La clase y desde qué lado la mira el usuario, o null si no es suya. El
   * rol sale de la clase y no de la sesión: es el docente de ESA clase o el
   * alumno de ESA clase. Una clase ajena da 404 y no 403, para no contar que
   * existe.
   */
  async function loadOwnClass(request) {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return null;
    await expireStartedPending(now());
    const cls = await findClassById(id);
    if (!cls) return null;
    if (String(cls.teacherId) === String(request.user.id)) return { cls, role: 'teacher' };
    if (String(cls.studentId) === String(request.user.id)) return { cls, role: 'student' };
    return null;
  }

  app.get('/:id', { onRequest: app.requireAuth }, async (request, reply) => {
    const own = await loadOwnClass(request);
    if (!own) return reply.code(404).send({ message: NOT_FOUND });
    return reply.send(own.cls);
  });

  /**
   * Arma la ruta de una acción sobre una clase (aceptar, cancelar, pagar,
   * tomar lista). Las reglas de si se puede las decide checkAction; `apply`
   * dice a qué estado pasa. Si entre que se leyó y se escribió el otro la
   * cambió, transitionClass no pisa nada y se avisa con un 409.
   */
  function action(name, apply) {
    app.post(
      `/:id/${name === 'attend' ? 'attendance' : name}`,
      { onRequest: [app.requireAuth, app.csrfProtection] },
      async (request, reply) => {
        const own = await loadOwnClass(request);
        if (!own) return reply.code(404).send({ message: NOT_FOUND });

        const denied = checkAction(name, own.cls, { role: own.role, now: now() });
        if (denied) return reply.code(denied.status).send({ message: denied.message });

        const change = apply(own, request.body ?? {});
        if (change.error) return reply.code(400).send(change.error);

        const done = await transitionClass(own.cls.id, { from: own.cls.status, ...change });
        if (!done) return reply.code(409).send({ message: CHANGED_MEANWHILE });

        return reply.send(await findClassById(own.cls.id));
      }
    );
  }

  action('accept', () => ({ to: 'aceptada' }));

  action('cancel', ({ cls, role }) => ({
    to: 'cancelada',
    cancelledBy: role,
    cancelReason: cancelReasonFor(cls, role),
  }));

  // Pagar una aceptada la confirma; una realizada o no presentada que se
  // debía queda en su estado, solo con el pago registrado.
  action('pay', ({ cls }) => ({
    to: cls.status === 'aceptada' ? 'confirmada' : cls.status,
    paid: true,
  }));

  action('attend', (own, body) => {
    if (typeof body.attended !== 'boolean') {
      return { error: { message: 'Falta indicar si el alumno estuvo.', fields: { attended: 'required' } } };
    }
    return { to: body.attended ? 'realizada' : 'no_presentada' };
  });

  /**
   * Reservar una clase en una ventana. El alumno sale de la sesión; el
   * docente, la modalidad y el lugar salen de la ventana. El body dice cuál,
   * qué día, a qué hora, de qué materia y cuánto dura — y el precio lo
   * calcula el backend con la tarifa del docente, nunca llega en el body.
   *
   * La reserva nace pendiente: el docente todavía tiene que aceptarla. El
   * empate entre dos alumnos que reservan a la vez lo resuelven bookClass
   * (grupales y cupo) y las restricciones de la tabla (horarios).
   */
  app.post('/', { onRequest: [app.requireAuth, app.csrfProtection] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.code(403).send({ message: 'Solo los alumnos pueden reservar clases' });
    }

    const checked = await validateBooking(request.body, request.user);
    if (checked.error) return reply.code(checked.error.status).send(checked.error.body);

    const created = await bookClass(checked.booking);
    if (created.conflict) return reply.code(409).send({ message: created.conflict });

    return reply.code(201).send(await findClassById(created.id));
  });

  /**
   * Reprogramar una clase confirmada: queda cancelada ("reprogramada") y se
   * reserva otro horario con el mismo docente y la misma materia. La nueva
   * nace pendiente y se vuelve a pagar: puede cambiar la modalidad, y con
   * ella el precio. Mismo body que reservar, sin materia.
   */
  app.post(
    '/:id/reschedule',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const own = await loadOwnClass(request);
      if (!own) return reply.code(404).send({ message: NOT_FOUND });

      const denied = checkAction('reschedule', own.cls, { role: own.role, now: now() });
      if (denied) return reply.code(denied.status).send({ message: denied.message });

      const checked = await validateBooking(request.body, request.user, own.cls);
      if (checked.error) return reply.code(checked.error.status).send(checked.error.body);

      const created = await rescheduleClass(own.cls.id, checked.booking);
      if (created.conflict) return reply.code(409).send({ message: created.conflict });

      return reply.code(201).send(await findClassById(created.id));
    }
  );
}
