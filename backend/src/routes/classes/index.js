import { bookClass, findClassById, findClassesForUser, hasOverlappingClass } from '../../db/classes.js';
import { findWindowById } from '../../db/availability.js';
import { teacherTeachesSubject } from '../../db/users.js';
import { occursOn, toMinutes, toTime } from '../../lib/availabilityExpansion.js';
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
   * Reservar un turno de una ventana. El alumno sale de la sesión; docente,
   * materia, duración y modalidad salen de la ventana — el body solo dice
   * cuál, qué día y a qué hora.
   *
   * Se valida de nuevo todo lo que ya valida la pantalla, porque la pantalla
   * se puede saltear. El empate entre dos alumnos que reservan a la vez lo
   * resuelven bookClass (cupo) y las restricciones de la tabla (horarios).
   */
  app.post('/', { onRequest: [app.requireAuth, app.csrfProtection] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.code(403).send({ message: 'Solo los alumnos pueden reservar clases' });
    }

    const { windowId, date, startTime } = request.body ?? {};

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

    const { iso, time } = now();
    if (date < iso || (date === iso && startTime <= time)) {
      return reply.code(400).send({ message: 'Ese horario ya pasó.' });
    }

    const window = await findWindowById(windowId);
    // Borrada, de otro día, o de una materia que el docente ya no da: para el
    // alumno es lo mismo, ese turno ya no se ofrece.
    if (!window || !occursOn(window, date)) {
      return reply.code(409).send({ message: NO_LONGER_OFFERED });
    }
    if (window.teacherId === request.user.id) {
      return reply.code(400).send({ message: 'No podés reservarte una clase a vos mismo.' });
    }
    if (!(await teacherTeachesSubject(window.teacherId, window.subjectId))) {
      return reply.code(409).send({ message: NO_LONGER_OFFERED });
    }

    const start = toMinutes(startTime);
    if (start < toMinutes(window.start) || start >= toMinutes(window.end)) {
      return reply.code(409).send({ message: NO_LONGER_OFFERED });
    }

    // Antes que nada, el choque del propio alumno: si no, salta primero la
    // restricción del docente y el mensaje diría "lo reservó otra persona"
    // cuando en realidad se está pisando con una clase suya. Es aproximado
    // para una grupal armada con otra duración; ahí decide la tabla.
    const clashesWithMine = await hasOverlappingClass({
      userId: request.user.id,
      role: 'student',
      date,
      startTime,
      endTime: toTime(start + window.durationMinutes),
    });
    if (clashesWithMine) {
      return reply.code(409).send({ message: 'Ya tenés una clase reservada en ese horario.' });
    }

    const created = await bookClass({ window, studentId: request.user.id, date, startTime });
    if (created.conflict) {
      return reply.code(409).send({ message: created.conflict });
    }

    return reply.code(201).send(await findClassById(created.id));
  });
}
