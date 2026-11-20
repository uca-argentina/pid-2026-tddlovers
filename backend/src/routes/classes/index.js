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
import { findBalance, settleHomeworkCredits } from '../../db/neuronas.js';
import { REWARDS, rewardProblem } from '../../lib/neuronas.js';
import { isTeacherOnVacation } from '../../db/vacations.js';
import { VACATION_MESSAGE } from '../../lib/vacations.js';
import { occursOn, toMinutes, toTime } from '../../lib/availabilityExpansion.js';
import { bookingPriceCents, isValidClassMinutes, MIN_CLASS_MINUTES } from '../../lib/teacherRates.js';
import {
  CLASS_STATUSES,
  cancelReasonFor,
  checkAction,
  forViewer,
} from '../../lib/classStates.js';
import { now } from '../../lib/clock.js';
import { TeacherApproval } from '../../lib/teacherApproval.js';
import { isRealDate, isUuid } from '../../lib/validators.js';
import {
  deleteFiles,
  isConfigured,
  newFileKey,
  putFile,
  signedDownloadUrl,
} from '../../storage/files.js';

// Montado en /api/classes (app.js). "Dueño" = el docente o el alumno de ESA
// clase (loadOwnClass); una clase ajena es 404.
//   GET    /api/classes?from&to[&status]          con sesión: las del usuario según su rol
//   GET    /api/classes/:id                        dueño
//   POST   /api/classes                            solo student (CSRF): reservar
//   POST   /api/classes/:id/accept                 dueño (CSRF; checkAction: docente)
//   POST   /api/classes/:id/cancel                 dueño (CSRF)
//   POST   /api/classes/:id/pay                    dueño (CSRF; checkAction: alumno)
//   POST   /api/classes/:id/attendance             dueño (CSRF; checkAction: docente)
//   POST   /api/classes/:id/reschedule             dueño (CSRF; checkAction: alumno, confirmada)
//   POST   /api/classes/:id/turn/{accept,cancel}   docente de la clase (CSRF)
//   GET    /api/classes/:id/material               dueño, clase terminada
//   PUT    /api/classes/:id/material               docente (CSRF)
//   POST   /api/classes/:id/material/files         docente (CSRF, multipart)
//   GET    /api/classes/:id/material/files/:fileId dueño → 302 a link firmado
//   DELETE /api/classes/:id/material/files/:fileId docente (CSRF)
// Las reglas de cada acción las decide lib/classStates.js (checkAction) y las
// del material lib/classMaterials.js; cada clase de un alumno sale por
// forViewer (sin dirección exacta hasta pagar).
// Usa: db/classes.js, db/availability.js, db/classMaterials.js, db/rates.js,
// db/packs.js, db/neuronas.js, db/vacations.js, storage/files.js y varios lib/*.
// Los errores salen como { message } (+ `fields` en validaciones); no hay código `error`.

const TIME_RE = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const NO_LONGER_OFFERED = 'Ese horario ya no está disponible.';
const NOT_FOUND = 'Esa clase no existe.';
const FILE_NOT_FOUND = 'Ese archivo no existe.';
const CHANGED_MEANWHILE = 'La clase cambió mientras tanto. Recargá la página.';

// El { error } que devuelven los helpers de validación: status + body listo para mandar.
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
 * `rewardType` canjea neuronas por la clase o parte de ella, si el docente acepta
 * canjes. No se combina con un paquete. Al reprogramar, el canje de la clase
 * vieja vuelve al saldo en la misma transacción, así que se puede volver a usar.
 *
 * Devuelve { booking } listo para bookClass/rescheduleClass, o { error }.
 *
 * @param {object} body - request.body: { windowId, date, startTime, durationMinutes,
 *   subjectId (no al reprogramar), packId?, packTokens?, rewardType? }.
 * @param {object} user - request.user (el alumno).
 * @param {object|null} [fixed] - la clase vieja (findClassById) al reprogramar.
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
 * Origen: findWindowById, isTeacherOnVacation, findRate y hasOverlappingClass.
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
  const clashesWithMine = await hasOverlappingClass({
    userId: user.id,
    role: 'student',
    date,
    startTime,
    endTime,
    excludeId: fixed ? fixed.id : null,
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
      excludeClassId: fixed ? fixed.id : null,
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
   *
   * Antes vence las pendientes que ya empezaron (expireStartedPending).
   * Respuesta: 200 [clases de findClassesForUser pasadas por forViewer].
   * Errores: 400 rango o estado inválido.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { from, to, status } = request.query ?? {};

    if (!isRealDate(from) || !isRealDate(to)) {
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
   *
   * @param {object} request - usa params.id y request.user.id.
   * @returns {Promise<{cls: object, role: 'teacher'|'student'}|null>} cls de findClassById.
   */
  async function loadOwnClass(request) {
    const { id } = request.params;
    if (!isUuid(id)) return null;
    await expireStartedPending(now());
    const cls = await findClassById(id);
    if (!cls) return null;
    if (String(cls.teacherId) === String(request.user.id)) return { cls, role: 'teacher' };
    if (String(cls.studentId) === String(request.user.id)) return { cls, role: 'student' };
    return null;
  }

  /** Una clase propia. Respuesta: 200 forViewer(clase). Errores: 404. */
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
   *
   * @param {'accept'|'cancel'|'pay'|'attend'} name - 'attend' se monta como /attendance.
   * @param {(own, body) => object} apply - el cambio ({ to, paid?, cancelledBy?,
   *   cancelReason? }) o { error } (400).
   * Respuesta: 200 forViewer(clase actualizada). Errores: 404, el status de
   *   checkAction (403/409…), 400 body inválido, 409 cambió en el medio.
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

  // Una clase que el paquete o el canje cubren entera ya está paga: aceptarla la
  // confirma directo, sin pasar por "aceptada, falta pagar". Si se pasa de lo
  // cubierto, ese resto se paga como cualquier clase.
  const applyAccept = ({ cls }) =>
    (cls.studentPackId || cls.rewardType) && cls.priceCents === 0
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
   *
   * Respuesta: 200 [clases actualizadas] (sin forViewer: solo lo ve el docente).
   * Errores: 404 acción desconocida o clase ajena, 403 no es el docente, el de
   *   checkAction si ninguna se puede, 409 cambió en el medio.
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

  // Tomar lista. Body: { attended: boolean }.
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
   *
   * Body: ver validateBooking. Respuesta: 201 forViewer(clase nueva, 'student').
   * Errores: 403 no alumno; los 400/409 de validateBooking; 409 conflicto en
   *   bookClass (horario tomado, grupal llena, licencia, paquete, saldo).
   */
  app.post('/', { onRequest: [app.requireAuth, app.csrfProtection] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.code(403).send({ message: 'Solo los alumnos pueden reservar clases' });
    }

    // Una pendiente vencida sigue ocupando el horario hasta que se la marca:
    // sin esto, bloqueaba la reserva hasta que alguien leyera clases.
    // (Reprogramar ya pasa por acá en loadOwnClass.)
    await expireStartedPending(now());
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
   *
   * Respuesta: 201 forViewer(clase nueva, 'student').
   * Errores: 404; el de checkAction('reschedule'); los de validateBooking;
   *   409 conflicto en rescheduleClass.
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
   *
   * @param {Function} check - checkViewMaterial o checkEditMaterial.
   * @returns {Promise<{cls, role, turn: {teacherId, date, startTime}}|null>} con
   *   null ya mandó la respuesta (404 o el status de `check`).
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

  /** El material del turno. Respuesta: 200 findMaterial. Errores: 404, el de checkViewMaterial. */
  app.get('/:id/material', { onRequest: app.requireAuth }, async (request, reply) => {
    const access = await loadMaterialAccess(request, reply, checkViewMaterial);
    if (!access) return reply;
    return reply.send(await findMaterial(access.turn));
  });

  /**
   * Guardar el resumen. Body: { summary } (≤5000).
   * Respuesta: 200 findMaterial. Errores: 400, 404, el de checkEditMaterial.
   */
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

  /**
   * Subir archivos (multipart). Chequea topes → sube al bucket → registra en la base.
   * Respuesta: 201 findMaterial. Errores: 400 topes/sin archivos, 413 archivo
   *   muy grande o demasiados (multipart), 404, el de checkEditMaterial,
   *   503 almacenamiento sin configurar.
   */
  app.post(
    '/:id/material/files',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const access = await loadMaterialAccess(request, reply, checkEditMaterial);
      if (!access) return reply;
      if (!isConfigured()) return reply.code(503).send({ message: STORAGE_OFF });

      // Lo que ya tiene el turno, ANTES de leer nada: así se corta apenas un
      // archivo se pasa de los topes, sin juntar en memoria todo lo que mande
      // el cliente (20 archivos de casi 10 MB serían ~200 MB de buffers).
      const { files: existing } = await findMaterial(access.turn);
      const used = {
        count: existing.length,
        bytes: existing.reduce((sum, file) => sum + file.sizeBytes, 0),
      };

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
          // Con lo leído hasta acá: si ya no entra, no tiene sentido seguir.
          // Lo que falta del body queda sin leer, así que se cierra la
          // conexión en vez de dejarla colgada esperando que alguien lo lea.
          const tooMuch = checkUploadRoom(used, files);
          if (tooMuch) {
            return reply.code(400).header('connection', 'close').send({ message: tooMuch });
          }
        }
      } catch (err) {
        const message = UPLOAD_ERRORS[err.code];
        if (!message) throw err;
        return reply.code(err.statusCode === 406 ? 400 : 413).send({ message });
      }
      // Sin archivos el bucle no chequea nada.
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

  /**
   * Borrar un archivo: primero la fila, después el objeto del bucket.
   * Respuesta: 200 findMaterial. Errores: 404, el de checkEditMaterial, 503.
   */
  app.delete(
    '/:id/material/files/:fileId',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const access = await loadMaterialAccess(request, reply, checkEditMaterial);
      if (!access) return reply;
      if (!isConfigured()) return reply.code(503).send({ message: STORAGE_OFF });
      if (!isUuid(request.params.fileId)) {
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
   *
   * Respuesta: 302 a signedDownloadUrl (storage/files.js). Errores: 404, el de
   *   checkViewMaterial, 503.
   */
  app.get('/:id/material/files/:fileId', { onRequest: app.requireAuth }, async (request, reply) => {
    const access = await loadMaterialAccess(request, reply, checkViewMaterial);
    if (!access) return reply;
    if (!isConfigured()) return reply.code(503).send({ message: STORAGE_OFF });
    if (!isUuid(request.params.fileId)) {
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
