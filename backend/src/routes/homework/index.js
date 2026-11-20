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
  isRecentGroupDate,
  recentGroupSince,
  validateFeedback,
  validateHomework,
  validateMessage,
  validateSubmission,
} from '../../lib/homework.js';
import { correctionCredits } from '../../lib/neuronas.js';
import { isUuid } from '../../lib/validators.js';

// Montado en /api/homework (app.js). "Tareas" en pantalla.
//   GET  /api/homework                          teacher (con `submissions`) o student (con `submission`); admin 403
//   GET  /api/homework/targets                  solo teacher
//   POST /api/homework                          solo teacher (CSRF)
//   PUT  /api/homework/:id/submission           solo student (CSRF)
//   POST /api/homework/submissions/:id/feedback  docente de esa entrega (CSRF)
//   GET  /api/homework/submissions/:id/messages  docente o alumno de esa entrega
//   POST /api/homework/submissions/:id/messages  docente o alumno de esa entrega (CSRF)
// Usa: db/homework.js, db/classes.js (findClassById, findTurnClasses),
// lib/homework.js (reglas y validaciones) y lib/neuronas.js (correctionCredits).
// Los errores salen como { message } (+ `fields` en validaciones); no hay código `error`.

const HOMEWORK_NOT_FOUND = 'Esa tarea no existe.';
const SUBMISSION_NOT_FOUND = 'Esa entrega no existe.';
const CHANGED_MEANWHILE = 'La entrega cambió mientras tanto. Recargá la página.';
const ONLY_TEACHERS = 'Solo los docentes pueden hacer esto.';
const ONLY_STUDENTS = 'Solo los alumnos pueden entregar tareas.';

export default async function homeworkRoutes(app) {
  /**
   * El destino sale siempre de lo que el docente ya tiene: un alumno suyo o
   * una grupal suya. Si no, cualquier docente podría escribirle a cualquier
   * usuario adivinando su id. Devuelve lo que falta para crear la tarea, o
   * { error } con el status.
   *
   * @param {object} body - request.body: exactamente uno de studentId o classId.
   * @param {string} teacherId - request.user.id.
   * @returns {Promise<{target: {studentIds, subjectId?, classDate?, startTime?}}
   *   | {error: {status, message}}>}
   */
  async function resolveTarget(body, teacherId) {
    const { studentId, classId } = body ?? {};
    if (Boolean(studentId) === Boolean(classId)) {
      return { error: { status: 400, message: 'Elegí a quién le asignás la tarea.' } };
    }

    if (studentId) {
      const mine = isUuid(studentId) && (await isStudentOf(teacherId, studentId));
      if (!mine) return { error: { status: 404, message: 'Ese alumno no existe.' } };
      return { target: { studentIds: [studentId] } };
    }

    const cls = isUuid(classId) ? await findClassById(classId) : null;
    if (!cls || String(cls.teacherId) !== String(teacherId)) {
      return { error: { status: 404, message: 'Esa clase no existe.' } };
    }
    if (cls.maxStudents <= 1) {
      return { error: { status: 400, message: 'Elegí una clase grupal.' } };
    }
    if (!isRecentGroupDate(cls.date, now().iso)) {
      return {
        error: {
          status: 400,
          message: 'Esa clase es de hace más de 60 días: asignale la tarea a cada alumno.',
        },
      };
    }
    // findTurnClasses ya deja afuera las canceladas.
    const rows = await findTurnClasses({ teacherId, date: cls.date, startTime: cls.startTime });
    const studentIds = rows.map((row) => row.studentId);
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

  /**
   * La lista de cada rol: el docente con todas las entregas, el alumno con la suya.
   * Respuesta: 200 listTeacherHomeworks o listStudentHomeworks. Errores: 403 admin.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { id, role } = request.user;
    if (role === 'teacher') return reply.send(await listTeacherHomeworks(id));
    if (role === 'student') return reply.send(await listStudentHomeworks(id));
    return reply.code(403).send({ message: 'Las tareas son para docentes y alumnos.' });
  });

  /** A quién puede asignar. Respuesta: 200 { students, groups } (findTargets). Errores: 403. */
  app.get('/targets', { onRequest: app.requireAuth }, async (request, reply) => {
    if (request.user.role !== 'teacher') return reply.code(403).send({ message: ONLY_TEACHERS });
    return reply.send(await findTargets(request.user.id, recentGroupSince(now().iso)));
  });

  /**
   * Asignar una tarea. Body: { title, description?, dueDate, dueTime } + studentId | classId.
   * Respuesta: 201 tarea (findTeacherHomework). Errores: 400 validación o destino
   *   inválido, 404 alumno/clase ajenos, 409 grupal sin alumnos, 403.
   */
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
   *
   * Body: { text?, linkUrl? } (validateSubmission).
   * Respuesta: 200 tarea con su entrega (findStudentHomework).
   * Errores: 400, 403 no alumno, 404 tarea no asignada, 409 ya corregida
   *   (checkSubmit) o corregida en el medio.
   */
  app.put(
    '/:id/submission',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const { id: userId, role } = request.user;
      if (role !== 'student') return reply.code(403).send({ message: ONLY_STUDENTS });

      const { id } = request.params;
      const homework = isUuid(id) ? await findStudentHomework(id, userId) : null;
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
   *
   * @returns {Promise<{submission: object, role: 'teacher'|'student'}|null>}
   *   submission de findSubmission; params.id es el id de la entrega.
   */
  async function loadOwnSubmission(request) {
    const { id } = request.params;
    if (!isUuid(id)) return null;
    const submission = await findSubmission(id);
    if (!submission) return null;
    // FILTRO: una entrega solo la ven su docente y su alumno; para cualquier
    // otro es un 404, como si no existiera.
    if (String(submission.teacherId) === String(request.user.id)) {
      return { submission, role: 'teacher' };
    }
    if (String(submission.studentId) === String(request.user.id)) {
      return { submission, role: 'student' };
    }
    return null;
  }

  /**
   * La devolución. Se puede corregir de nuevo, y reemplaza a la anterior. Solo
   * la primera da neuronas: corrected_at se pisa al recorregir, y si contara,
   * reescribir la devolución volvería a pagar.
   *
   * Body: { feedback }. Respuesta: 200 tarea con todas las entregas (findTeacherHomework).
   * Errores: 400, 403 no es el docente, 404, 409 sin entregar (checkCorrect)
   *   o cambió en el medio.
   */
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

      const current = now();
      const award = own.submission.correctedAt
        ? null
        : {
            submission: own.submission,
            credits: correctionCredits(own.submission, checked.feedback, current),
            today: current.iso,
          };
      const saved = await saveFeedback(own.submission.id, checked.feedback, award);
      if (!saved) return reply.code(409).send({ message: CHANGED_MEANWHILE });

      return reply.send(await findTeacherHomework(own.submission.homeworkId, request.user.id));
    }
  );

  /**
   * El chat de la entrega (se consulta cada 5 s desde el front).
   * Respuesta: 200 [listMessages]. Errores: 404, 409 todavía sin entregar (checkChat).
   */
  app.get('/submissions/:id/messages', { onRequest: app.requireAuth }, async (request, reply) => {
    const own = await loadOwnSubmission(request);
    if (!own) return reply.code(404).send({ message: SUBMISSION_NOT_FOUND });

    const denied = checkChat(own.submission);
    if (denied) return reply.code(denied.status).send({ message: denied.message });

    return reply.send(await listMessages(own.submission.id));
  });

  /**
   * Mandar un mensaje al chat. Body: { body }.
   * Respuesta: 201 mensaje (addMessage). Errores: 400, 404, 409 (checkChat).
   */
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
