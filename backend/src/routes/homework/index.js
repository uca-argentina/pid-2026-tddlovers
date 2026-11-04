import { findClassById, findTurnClasses } from '../../db/classes.js';
import {
  addMessage,
  createHomework,
  findStudentHomework,
  findSubmission,
  findTargets,
  findTeacherHomework,
  isStudentOf,
  listMessages,
  listStudentHomeworks,
  listTeacherHomeworks,
  saveFeedback,
  saveSubmission,
} from '../../db/homework.js';
import { now } from '../../lib/clock.js';
import {
  checkChat,
  checkCorrect,
  checkSubmit,
  isPastDue,
  validateFeedback,
  validateHomework,
  validateMessage,
  validateSubmission,
} from '../../lib/homework.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOMEWORK_NOT_FOUND = 'Esa tarea no existe.';
const SUBMISSION_NOT_FOUND = 'Esa entrega no existe.';
const CHANGED_MEANWHILE = 'La entrega cambió mientras tanto. Recargá la página.';
const ONLY_TEACHERS = 'Solo los docentes pueden hacer esto.';
const ONLY_STUDENTS = 'Solo los alumnos pueden entregar tareas.';
// Las grupales que se ofrecen para asignar: las que vienen y las de hace poco.
const RECENT_GROUP_DAYS = 60;

function daysBefore(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - days));
  return date.toISOString().slice(0, 10);
}

export default async function homeworkRoutes(app) {
  /**
   * El destino sale siempre de lo que el docente ya tiene: un alumno suyo o
   * una grupal suya. Si no, cualquier docente podría escribirle a cualquier
   * usuario adivinando su id. Devuelve lo que falta para crear la tarea, o
   * { error } con el status.
   */
  async function resolveTarget(body, teacherId) {
    const { studentId, classId } = body ?? {};
    if (Boolean(studentId) === Boolean(classId)) {
      return { error: { status: 400, message: 'Elegí a quién le asignás la tarea.' } };
    }

    if (studentId) {
      const mine = UUID_RE.test(String(studentId)) && (await isStudentOf(teacherId, studentId));
      if (!mine) return { error: { status: 404, message: 'Ese alumno no existe.' } };
      return { target: { studentIds: [studentId] } };
    }

    const cls = UUID_RE.test(String(classId)) ? await findClassById(classId) : null;
    if (!cls || String(cls.teacherId) !== String(teacherId)) {
      return { error: { status: 404, message: 'Esa clase no existe.' } };
    }
    if (cls.maxStudents <= 1) {
      return { error: { status: 400, message: 'Elegí una clase grupal.' } };
    }
    const rows = await findTurnClasses({ teacherId, date: cls.date, startTime: cls.startTime });
    const studentIds = rows.filter((row) => row.status !== 'cancelada').map((row) => row.studentId);
    if (studentIds.length === 0) {
      return { error: { status: 409, message: 'Esa clase ya no tiene alumnos anotados.' } };
    }
    return {
      target: {
        studentIds,
        subjectId: cls.subjectId,
        classDate: cls.date,
        startTime: cls.startTime,
      },
    };
  }

  /** La lista de cada rol: el docente con todas las entregas, el alumno con la suya. */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { id, role } = request.user;
    if (role === 'teacher') return reply.send(await listTeacherHomeworks(id));
    if (role === 'student') return reply.send(await listStudentHomeworks(id));
    return reply.code(403).send({ message: 'Las tareas son para docentes y alumnos.' });
  });

  app.get('/targets', { onRequest: app.requireAuth }, async (request, reply) => {
    if (request.user.role !== 'teacher') return reply.code(403).send({ message: ONLY_TEACHERS });
    return reply.send(await findTargets(request.user.id, daysBefore(now().iso, RECENT_GROUP_DAYS)));
  });

  app.post('/', { onRequest: [app.requireAuth, app.csrfProtection] }, async (request, reply) => {
    if (request.user.role !== 'teacher') return reply.code(403).send({ message: ONLY_TEACHERS });

    const checked = validateHomework(request.body, now());
    if (checked.error) return reply.code(400).send(checked.error);

    const resolved = await resolveTarget(request.body, request.user.id);
    if (resolved.error) {
      return reply.code(resolved.error.status).send({ message: resolved.error.message });
    }

    const id = await createHomework({
      teacherId: request.user.id,
      ...checked.homework,
      ...resolved.target,
    });
    return reply.code(201).send(await findTeacherHomework(id, request.user.id));
  });

  /**
   * Entregar, o cambiar la entrega mientras no esté corregida. Si se cambia
   * después del vencimiento pasa a fuera de término: lo que cuenta es la
   * última versión, que es la que va a leer el docente.
   */
  app.put(
    '/:id/submission',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const { id: userId, role } = request.user;
      if (role !== 'student') return reply.code(403).send({ message: ONLY_STUDENTS });

      const { id } = request.params;
      const homework = UUID_RE.test(id) ? await findStudentHomework(id, userId) : null;
      if (!homework) return reply.code(404).send({ message: HOMEWORK_NOT_FOUND });

      const denied = checkSubmit(homework.submission);
      if (denied) return reply.code(denied.status).send({ message: denied.message });

      const checked = validateSubmission(request.body);
      if (checked.error) return reply.code(400).send(checked.error);

      const saved = await saveSubmission(homework.submission.id, {
        ...checked.submission,
        isLate: isPastDue(homework, now()),
      });
      if (!saved) return reply.code(409).send({ message: CHANGED_MEANWHILE });

      return reply.send(await findStudentHomework(id, userId));
    }
  );

  /**
   * La entrega y desde qué lado la mira el usuario, o null si no es suya. Una
   * entrega ajena da 404 y no 403, para no contar que existe.
   */
  async function loadOwnSubmission(request) {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return null;
    const submission = await findSubmission(id);
    if (!submission) return null;
    if (String(submission.teacherId) === String(request.user.id)) {
      return { submission, role: 'teacher' };
    }
    if (String(submission.studentId) === String(request.user.id)) {
      return { submission, role: 'student' };
    }
    return null;
  }

  /** La devolución. Se puede corregir de nuevo, y reemplaza a la anterior. */
  app.post(
    '/submissions/:id/feedback',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const own = await loadOwnSubmission(request);
      if (!own) return reply.code(404).send({ message: SUBMISSION_NOT_FOUND });
      if (own.role !== 'teacher') {
        return reply.code(403).send({ message: 'Solo el docente puede corregir.' });
      }

      const denied = checkCorrect(own.submission);
      if (denied) return reply.code(denied.status).send({ message: denied.message });

      const checked = validateFeedback(request.body?.feedback);
      if (checked.error) return reply.code(400).send(checked.error);

      const saved = await saveFeedback(own.submission.id, checked.feedback);
      if (!saved) return reply.code(409).send({ message: CHANGED_MEANWHILE });

      return reply.send(await findTeacherHomework(own.submission.homeworkId, request.user.id));
    }
  );

  app.get('/submissions/:id/messages', { onRequest: app.requireAuth }, async (request, reply) => {
    const own = await loadOwnSubmission(request);
    if (!own) return reply.code(404).send({ message: SUBMISSION_NOT_FOUND });

    const denied = checkChat(own.submission);
    if (denied) return reply.code(denied.status).send({ message: denied.message });

    return reply.send(await listMessages(own.submission.id));
  });

  app.post(
    '/submissions/:id/messages',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const own = await loadOwnSubmission(request);
      if (!own) return reply.code(404).send({ message: SUBMISSION_NOT_FOUND });

      const denied = checkChat(own.submission);
      if (denied) return reply.code(denied.status).send({ message: denied.message });

      const checked = validateMessage(request.body?.body);
      if (checked.error) return reply.code(400).send(checked.error);

      const message = await addMessage({
        submissionId: own.submission.id,
        senderId: request.user.id,
        body: checked.body,
      });
      return reply.code(201).send(message);
    }
  );
}
