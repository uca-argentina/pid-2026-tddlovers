import { bookClass, findClassById, findClassesForUser, hasOverlappingClass } from '../../db/classes.js';
import { findWindowById } from '../../db/availability.js';
import { findRate } from '../../db/rates.js';
import { occursOn, toMinutes, toTime } from '../../lib/availabilityExpansion.js';
import { classPriceCents, isValidClassMinutes, MIN_CLASS_MINUTES } from '../../lib/teacherRates.js';
import { now } from '../../lib/clock.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const STATUSES = ['reservada', 'cancelada'];
// Los ids son UUID: validarlo acá evita que un id cualquiera llegue a la base
// y vuelva como un 500 en vez de un 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_LONGER_OFFERED = 'Ese horario ya no está disponible.';

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
    if (status !== undefined && !STATUSES.includes(status)) {
      return reply.code(400).send({ message: 'Estado inválido' });
    }

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
   * Reservar una clase en una ventana. El alumno sale de la sesión; el
   * docente, la modalidad y el lugar salen de la ventana. El body dice cuál,
   * qué día, a qué hora, de qué materia y cuánto dura — y el precio lo
   * calcula el backend con la tarifa del docente, nunca llega en el body.
   *
   * Se valida de nuevo todo lo que ya valida la pantalla, porque la pantalla
   * se puede saltear. El empate entre dos alumnos que reservan a la vez lo
   * resuelven bookClass (grupales y cupo) y las restricciones de la tabla
   * (horarios).
   */
  app.post('/', { onRequest: [app.requireAuth, app.csrfProtection] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.code(403).send({ message: 'Solo los alumnos pueden reservar clases' });
    }

    const { windowId, date, startTime, subjectId, durationMinutes } = request.body ?? {};

    if (!ISO_DATE_RE.test(date ?? '')) {
      return reply.code(400).send({ message: 'Fecha inválida', fields: { date: 'invalid' } });
    }
    if (!TIME_RE.test(startTime ?? '')) {
      return reply
        .code(400)
        .send({ message: 'La clase tiene que empezar en punto o y media.', fields: { startTime: 'invalid' } });
    }
    if (!windowId) {
      return reply.code(400).send({ message: 'Falta la clase', fields: { windowId: 'required' } });
    }
    if (!UUID_RE.test(String(windowId))) {
      return reply.code(400).send({ message: 'Clase inválida', fields: { windowId: 'invalid' } });
    }
    if (!subjectId) {
      return reply
        .code(400)
        .send({ message: 'Elegí la materia de la clase.', fields: { subjectId: 'required' } });
    }
    if (!UUID_RE.test(String(subjectId))) {
      return reply.code(400).send({ message: 'Materia inválida', fields: { subjectId: 'invalid' } });
    }
    if (!isValidClassMinutes(durationMinutes)) {
      return reply.code(400).send({
        message: `La clase dura como mínimo ${MIN_CLASS_MINUTES} minutos, de a 5.`,
        fields: { durationMinutes: 'invalid' },
      });
    }

    const { iso, time } = now();
    if (date < iso || (date === iso && startTime <= time)) {
      return reply.code(400).send({ message: 'Ese horario ya pasó.' });
    }

    const window = await findWindowById(windowId);
    // Borrada o de otro día: para el alumno es lo mismo, ya no se ofrece.
    if (!window || !occursOn(window, date)) {
      return reply.code(409).send({ message: NO_LONGER_OFFERED });
    }
    if (window.teacherId === request.user.id) {
      return reply.code(400).send({ message: 'No podés reservarte una clase a vos mismo.' });
    }

    // La tarifa es lo que ata la materia al docente y a la modalidad: sin
    // ella, esa materia no se da así (o el docente la sacó del perfil).
    const hourlyRateCents = await findRate({
      teacherId: window.teacherId,
      subjectId,
      modality: window.modality,
    });
    if (hourlyRateCents === null) {
      return reply
        .code(409)
        .send({ message: 'El docente ya no da esa materia en esta modalidad.' });
    }

    const start = toMinutes(startTime);
    const end = start + durationMinutes;
    if (start < toMinutes(window.start) || start >= toMinutes(window.end)) {
      return reply.code(409).send({ message: NO_LONGER_OFFERED });
    }
    if (end > toMinutes(window.end)) {
      return reply.code(409).send({
        message: 'La clase no entra en el horario del docente. Elegí una duración más corta.',
        fields: { durationMinutes: 'invalid' },
      });
    }
    const endTime = toTime(end);

    // Antes que nada, el choque del propio alumno: si no, salta primero la
    // restricción del docente y el mensaje diría "lo reservó otra persona"
    // cuando en realidad se está pisando con una clase suya.
    const clashesWithMine = await hasOverlappingClass({
      userId: request.user.id,
      role: 'student',
      date,
      startTime,
      endTime,
    });
    if (clashesWithMine) {
      return reply.code(409).send({ message: 'Ya tenés una clase reservada en ese horario.' });
    }

    const created = await bookClass({
      window,
      studentId: request.user.id,
      date,
      startTime,
      endTime,
      subjectId,
      priceCents: classPriceCents(hourlyRateCents, durationMinutes),
    });
    if (created.conflict) {
      return reply.code(409).send({ message: created.conflict });
    }

    return reply.code(201).send(await findClassById(created.id));
  });
}
