import {
  bookClass,
  expireStartedPending,
  findClassById,
  findClassesForUser,
  findTurnClasses,
  hasOverlappingClass,
  rescheduleClass,
  transitionClass,
  transitionClasses,
} from '../../db/classes.js';
import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import { findWindowById } from '../../db/availability.js';
import {
  addFiles,
  deleteFile,
  findFileMeta,
  findMaterial,
  saveSummary,
} from '../../db/classMaterials.js';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_TURN,
  checkEditMaterial,
  checkUploadRoom,
  checkViewMaterial,
  sanitizeFilename,
  validateSummary,
} from '../../lib/classMaterials.js';
import { findRate } from '../../db/rates.js';
import { listStudentPacks } from '../../db/packs.js';
import { StudentPack } from '../../lib/classPacks.js';
import { isTeacherOnVacation } from '../../db/vacations.js';
import { VACATION_MESSAGE } from '../../lib/vacations.js';
import { occursOn, toMinutes, toTime } from '../../lib/availabilityExpansion.js';
import { classPriceCents, isValidClassMinutes, MIN_CLASS_MINUTES } from '../../lib/teacherRates.js';
import {
  CLASS_STATUSES,
  cancelReasonFor,
  checkAction,
  forViewer,
} from '../../lib/classStates.js';
import { now } from '../../lib/clock.js';
import { TeacherApproval } from '../../lib/teacherApproval.js';
import {
  deleteFiles,
  isConfigured,
  newFileKey,
  putFile,
  signedDownloadUrl,
} from '../../storage/files.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
// Los ids son UUID: validarlo acá evita que un id cualquiera llegue a la base
// y vuelva como un 500 en vez de un 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_LONGER_OFFERED = 'Ese horario ya no está disponible.';
const NOT_FOUND = 'Esa clase no existe.';
const FILE_NOT_FOUND = 'Ese archivo no existe.';
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
 * `packId` + `packTokens` en el body usan `packTokens` clases de un paquete
 * del alumno con ese docente (cada una cubre la duración fija del paquete).
 * Lo cubierto no se paga; lo que se pasa se paga aparte con la tarifa de la
 * materia. Su asistencia descuenta esas clases del paquete. Al reprogramar
 * vale lo mismo: la vieja libera las suyas en la misma transacción.
 *
 * Devuelve { booking } listo para bookClass/rescheduleClass, o { error }.
 */
async function validateBooking(body, user, fixed = null) {
  const { windowId, date, startTime, durationMinutes } = body ?? {};
  const subjectId = fixed ? fixed.subjectId : body?.subjectId;
  const { packId = null, packTokens = 0 } = body ?? {};

  if (!ISO_DATE_RE.test(date ?? '')) return fail(400, 'Fecha inválida', { date: 'invalid' });
  if (!TIME_RE.test(startTime ?? '')) {
    return fail(400, 'La clase tiene que empezar en punto o y media.', { startTime: 'invalid' });
  }
  if (!windowId) return fail(400, 'Falta la clase', { windowId: 'required' });
  if (!UUID_RE.test(String(windowId))) return fail(400, 'Clase inválida', { windowId: 'invalid' });
  if (!subjectId) return fail(400, 'Elegí la materia de la clase.', { subjectId: 'required' });
  if (!UUID_RE.test(String(subjectId))) return fail(400, 'Materia inválida', { subjectId: 'invalid' });
  if (packId !== null && !UUID_RE.test(String(packId))) {
    return fail(400, 'Paquete inválido', { packId: 'invalid' });
  }
  if (packTokens !== 0 && packId === null) {
    return fail(400, 'Elegí de qué paquete usás las clases.', { packId: 'required' });
  }
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
  const clashesWithMine = await hasOverlappingClass({
    userId: user.id,
    role: 'student',
    date,
    startTime,
    endTime,
    excludeId: fixed ? fixed.id : null,
  });
  if (clashesWithMine) return fail(409, 'Ya tenés una clase reservada en ese horario.');

  // Sin paquete se paga la clase entera; con paquete, solo lo que se pasa de
  // lo que cubren las clases del paquete.
  let extraMinutes = durationMinutes;
  if (packId) {
    const rows = await listStudentPacks({
      studentId: user.id,
      teacherId: window.teacherId,
      excludeClassId: fixed ? fixed.id : null,
    });
    // Solo un paquete propio y con este docente: un id ajeno da lo mismo que
    // uno que no existe.
    const row = rows.find((item) => String(item.id) === String(packId));
    if (!row) return fail(409, 'No tenés ese paquete con este docente.');
    const pack = new StudentPack(row);
    const tokens = packTokens;
    const problem = pack.bookingProblem({ date, today: iso, tokens, minutes: durationMinutes });
    if (problem) return fail(problem.status, problem.message, { packTokens: 'invalid' });
    extraMinutes = pack.extraMinutes({ tokens, minutes: durationMinutes });
  }

  return {
    booking: {
      window,
      studentId: user.id,
      date,
      startTime,
      endTime,
      subjectId,
      // Lo cubierto por el paquete ya se pagó al comprarlo: el precio de la
      // clase es solo lo que se pasa (0 si el paquete la cubre entera).
      priceCents: classPriceCents(hourlyRateCents, extraMinutes),
      studentPackId: packId || null,
      packTokens: packId ? packTokens : 0,
    },
  };
}

export default async function classesRoutes(app) {
  // Solo para subir material (las rutas de /material/files). Registrado acá
  // adentro queda encapsulado en este plugin: el resto de la API sigue sin
  // aceptar multipart.
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_TURN, fields: 0 },
  });

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
    // La dirección exacta, solo si ya pagó (lib/classStates.js).
    return reply.send(classes.map((cls) => forViewer(cls, request.user.role)));
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
    return reply.send(forViewer(own.cls, own.role));
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

        return reply.send(forViewer(await findClassById(own.cls.id), own.role));
      }
    );
  }

  // Una clase que el paquete cubre entera ya está paga: aceptarla la confirma
  // directo, sin pasar por "aceptada, falta pagar". Si se pasa del paquete,
  // ese resto se paga como cualquier clase.
  const applyAccept = ({ cls }) =>
    cls.studentPackId && cls.priceCents === 0
      ? { to: 'confirmada', paid: true }
      : { to: 'aceptada' };

  const applyCancel = ({ cls, role }) => ({
    to: 'cancelada',
    cancelledBy: role,
    cancelReason: cancelReasonFor(cls, role),
  });

  action('accept', applyAccept);
  action('cancel', applyCancel);

  /**
   * Aceptar o cancelar la CLASE entera: en una grupal, todas las reservas en
   * pie del turno de esa clase (una por alumno), todo o nada. Se aplica a las
   * que la acción permite (aceptar, solo las pendientes) con las mismas
   * reglas que de a una; si en el medio alguien tocó alguna, no se cambia
   * ninguna y se avisa con un 409. Devuelve las reservas actualizadas.
   */
  const TURN_ACTIONS = { accept: applyAccept, cancel: applyCancel };

  app.post(
    '/:id/turn/:action',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const apply = TURN_ACTIONS[request.params.action];
      if (!apply) return reply.code(404).send({ message: 'Recurso no encontrado' });

      const own = await loadOwnClass(request);
      if (!own) return reply.code(404).send({ message: NOT_FOUND });
      if (own.role !== 'teacher') {
        return reply.code(403).send({ message: 'Solo el docente puede actuar sobre toda la clase.' });
      }

      const { teacherId, date, startTime } = own.cls;
      const rows = await findTurnClasses({ teacherId, date, startTime });
      const context = { role: 'teacher', now: now() };
      const name = request.params.action;
      const targets = rows.filter((row) => !checkAction(name, row, context));
      if (targets.length === 0) {
        // Ninguna se puede: el motivo de la primera (o de la clase pedida, si
        // ya no queda ninguna en pie) dice por qué.
        const denied = checkAction(name, rows[0] ?? own.cls, context) ?? {
          status: 409,
          message: CHANGED_MEANWHILE,
        };
        return reply.code(denied.status).send({ message: denied.message });
      }

      const changes = targets.map((row) => ({
        id: row.id,
        from: row.status,
        ...apply({ cls: row, role: 'teacher' }),
      }));
      const done = await transitionClasses(changes);
      if (!done) return reply.code(409).send({ message: CHANGED_MEANWHILE });

      return reply.send(await Promise.all(targets.map((row) => findClassById(row.id))));
    }
  );

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

    return reply.code(201).send(forViewer(await findClassById(created.id), 'student'));
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

      return reply.code(201).send(forViewer(await findClassById(created.id), 'student'));
    }
  );

  /**
   * El material de la clase (resumen + archivos) es del turno: en una
   * grupal, cualquier reserva no cancelada de ese turno lleva al mismo.
   * Primero se chequea que la clase sea del usuario (404 si no) y después si
   * ya se puede ver o tocar (lib/classMaterials.js).
   */
  async function loadMaterialAccess(request, reply, check) {
    const own = await loadOwnClass(request);
    if (!own) {
      reply.code(404).send({ message: NOT_FOUND });
      return null;
    }
    const denied = check(own.cls, { role: own.role, now: now() });
    if (denied) {
      reply.code(denied.status).send({ message: denied.message });
      return null;
    }
    const { teacherId, date, startTime } = own.cls;
    return { ...own, turn: { teacherId, date, startTime } };
  }

  app.get('/:id/material', { onRequest: app.requireAuth }, async (request, reply) => {
    const access = await loadMaterialAccess(request, reply, checkViewMaterial);
    if (!access) return reply;
    return reply.send(await findMaterial(access.turn));
  });

  app.put(
    '/:id/material',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const access = await loadMaterialAccess(request, reply, checkEditMaterial);
      if (!access) return reply;

      const checked = validateSummary(request.body?.summary);
      if (checked.error) {
        return reply.code(400).send({ message: checked.error, fields: { summary: 'invalid' } });
      }
      await saveSummary(access.turn, checked.summary);
      return reply.send(await findMaterial(access.turn));
    }
  );

  // Errores de @fastify/multipart, que traen el mensaje en inglés.
  const UPLOAD_ERRORS = {
    FST_REQ_FILE_TOO_LARGE: `Cada archivo puede pesar hasta ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    FST_FILES_LIMIT: `Una clase puede tener hasta ${MAX_FILES_PER_TURN} archivos.`,
    FST_INVALID_MULTIPART_CONTENT_TYPE: 'Elegí al menos un archivo.',
  };

  const STORAGE_OFF = 'El almacenamiento de archivos no está configurado.';

  app.post(
    '/:id/material/files',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const access = await loadMaterialAccess(request, reply, checkEditMaterial);
      if (!access) return reply;
      if (!isConfigured()) return reply.code(503).send({ message: STORAGE_OFF });

      // Se leen enteros a memoria: son pocos y chicos (10 MB cada uno como
      // mucho), y hay que tenerlos todos para chequear los topes antes de
      // subir nada al bucket.
      const files = [];
      try {
        for await (const part of request.files()) {
          const data = await part.toBuffer();
          files.push({
            name: sanitizeFilename(part.filename),
            mimeType: part.mimetype || 'application/octet-stream',
            sizeBytes: data.length,
            data,
          });
        }
      } catch (err) {
        const message = UPLOAD_ERRORS[err.code];
        if (!message) throw err;
        return reply.code(err.statusCode === 406 ? 400 : 413).send({ message });
      }

      // Primero los topes contra lo que ya tiene el turno, para no subir al
      // bucket algo que después no se va a poder guardar.
      const { files: existing } = await findMaterial(access.turn);
      const used = {
        count: existing.length,
        bytes: existing.reduce((sum, file) => sum + file.sizeBytes, 0),
      };
      const tooMuch = checkUploadRoom(used, files);
      if (tooMuch) return reply.code(400).send({ message: tooMuch });

      // Después al bucket, y recién con todo arriba se registran en la base
      // (addFiles re-chequea los topes bajo un lock). Si eso no sale, se
      // borra lo que se subió: un objeto sin fila no lo puede pedir nadie.
      const uploaded = [];
      try {
        for (const file of files) {
          const storageKey = newFileKey(access.turn, randomUUID());
          await putFile(storageKey, file.data, file.mimeType);
          uploaded.push({ ...file, storageKey });
        }
        const denied = await addFiles(access.turn, uploaded);
        if (denied) {
          await deleteFiles(uploaded.map((file) => file.storageKey), request.log);
          return reply.code(400).send({ message: denied.error });
        }
      } catch (err) {
        await deleteFiles(uploaded.map((file) => file.storageKey), request.log);
        throw err;
      }
      return reply.code(201).send(await findMaterial(access.turn));
    }
  );

  app.delete(
    '/:id/material/files/:fileId',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const access = await loadMaterialAccess(request, reply, checkEditMaterial);
      if (!access) return reply;
      if (!isConfigured()) return reply.code(503).send({ message: STORAGE_OFF });
      if (!UUID_RE.test(request.params.fileId)) {
        return reply.code(404).send({ message: FILE_NOT_FOUND });
      }
      // Primero la fila: desde ahí ya nadie lo puede pedir. Si borrar el
      // objeto falla queda huérfano en el bucket, pero el material está bien.
      const storageKey = await deleteFile(access.turn, request.params.fileId);
      if (!storageKey) return reply.code(404).send({ message: FILE_NOT_FOUND });
      await deleteFiles([storageKey], request.log);
      return reply.send(await findMaterial(access.turn));
    }
  );

  /**
   * Descargar: se chequea acá quién es (el docente o un alumno de la clase,
   * ya terminada) y se lo manda al bucket con un link firmado de unos
   * minutos. El archivo va directo del bucket al navegador, sin pasar por el
   * backend; el link ya dice si se muestra (imágenes) o se descarga (todo lo
   * demás) y con qué nombre.
   */
  app.get('/:id/material/files/:fileId', { onRequest: app.requireAuth }, async (request, reply) => {
    const access = await loadMaterialAccess(request, reply, checkViewMaterial);
    if (!access) return reply;
    if (!isConfigured()) return reply.code(503).send({ message: STORAGE_OFF });
    if (!UUID_RE.test(request.params.fileId)) {
      return reply.code(404).send({ message: FILE_NOT_FOUND });
    }
    const file = await findFileMeta(access.turn, request.params.fileId);
    if (!file) return reply.code(404).send({ message: FILE_NOT_FOUND });

    const url = await signedDownloadUrl(file.storageKey, {
      filename: file.name,
      mimeType: file.mimeType,
    });
    return reply.header('Cache-Control', 'private, no-store').redirect(url, 302);
  });
}
