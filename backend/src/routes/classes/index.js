import {
  createClass,
  findClassById,
  findClassesForUser,
  hasOverlappingClass,
} from '../../db/classes.js';
import { isWithinAvailability } from '../../db/availability.js';
import { teacherTeachesSubject } from '../../db/users.js';
import { dayKeyFromIso, toMinutes, toTime } from '../../lib/availabilityExpansion.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const STATUSES = ['reservada', 'cancelada'];
// Los ids son UUID: validarlo acá evita que un id cualquiera llegue a la base
// y vuelva como un 500 en vez de un 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 'YYYY-MM-DD' y 'HH:MM' de ahora, en hora local del server. */
function now() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
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
   * Reservar. El alumno sale de la sesión, no del body.
   *
   * Se valida de nuevo todo lo que ya valida la pantalla, porque la pantalla
   * se puede saltear; y la última palabra la tienen las restricciones de
   * exclusión de la tabla, que son las que resuelven el empate cuando dos
   * alumnos reservan el mismo horario al mismo tiempo.
   */
  app.post('/', { onRequest: [app.requireAuth, app.csrfProtection] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.code(403).send({ message: 'Solo los alumnos pueden reservar clases' });
    }

    const { date, teacherId, subjectId, startTime } = request.body ?? {};

    if (!ISO_DATE_RE.test(date ?? '')) {
      return reply.code(400).send({ message: 'Fecha inválida', fields: { date: 'invalid' } });
    }
    if (!TIME_RE.test(startTime ?? '')) {
      return reply
        .code(400)
        .send({ message: 'La clase tiene que empezar en punto o y media.', fields: { startTime: 'invalid' } });
    }
    if (!teacherId) {
      return reply.code(400).send({ message: 'Falta el docente', fields: { teacherId: 'required' } });
    }
    // La disponibilidad no dice de qué materia es: la elige el alumno acá.
    if (!subjectId) {
      return reply
        .code(400)
        .send({ message: 'Elegí la materia de la clase.', fields: { subjectId: 'required' } });
    }
    if (!UUID_RE.test(String(teacherId)) || !UUID_RE.test(String(subjectId))) {
      return reply.code(400).send({ message: 'Docente o materia inválidos' });
    }
    if (teacherId === request.user.id) {
      return reply.code(400).send({ message: 'No podés reservarte una clase a vos mismo.' });
    }

    // La clase dura siempre 1 h: el fin se calcula, no se confía en el body.
    const endTime = toTime(toMinutes(startTime) + 60);

    const { iso, time } = now();
    if (date < iso || (date === iso && startTime <= time)) {
      return reply.code(400).send({ message: 'Ese horario ya pasó.' });
    }

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

    // Cualquier materia no: solo una de las que da ese docente.
    const teaches = await teacherTeachesSubject(teacherId, subjectId);
    if (!teaches) {
      return reply.code(400).send({
        message: 'Ese docente no da esa materia.',
        fields: { subjectId: 'invalid' },
      });
    }

    const offered = await isWithinAvailability({
      teacherId,
      dayKey: dayKeyFromIso(date),
      startTime,
      endTime,
    });
    if (!offered) {
      return reply.code(409).send({ message: 'Ese horario ya no está disponible.' });
    }

    const created = await createClass({
      teacherId,
      studentId: request.user.id,
      subjectId,
      date,
      startTime,
      endTime,
    });

    if (created.conflict) {
      return reply.code(409).send({ message: created.conflict });
    }

    return reply.code(201).send(await findClassById(created.id));
  });
}
