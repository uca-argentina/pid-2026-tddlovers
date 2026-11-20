import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import {
  expireStartedPending,
  findBookingById,
  findClassBookings,
  findStudentBooking,
  transitionBookings,
} from '../../db/bookings.js';
import { findClass } from '../../db/classes.js';
import {
  addFiles,
  deleteFile,
  findFileMeta,
  findMaterial,
  saveSummary,
} from '../../db/classMaterials.js';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_CLASS,
  checkEditMaterial,
  checkUploadRoom,
  checkViewMaterial,
  materialStatusOf,
  sanitizeFilename,
  validateSummary,
} from '../../lib/classMaterials.js';
import { applyAccept, applyCancel, checkAction } from '../../lib/bookingStates.js';
import { now } from '../../lib/clock.js';
import { isUuid } from '../../lib/validators.js';
import {
  deleteFiles,
  isConfigured,
  newFileKey,
  putFile,
  signedDownloadUrl,
} from '../../storage/files.js';

// Montado en /api/classes (app.js). Una clase (classes) es UNA fila aunque
// sea grupal; `:classId` es classes.id, el `classId` de cada reserva. Lo de
// cada alumno por separado (reservar, aceptar una, pagar, tomar lista,
// reprogramar) está en routes/bookings.
// "Dueño" = el docente de la clase o un alumno con una reserva en ella
// (loadOwnClass); una clase ajena es 404.
//   POST   /api/classes/:classId/{accept,cancel}         docente (CSRF): todas sus reservas
//   GET    /api/classes/:classId/material                dueño, clase terminada
//   PUT    /api/classes/:classId/material                docente (CSRF)
//   POST   /api/classes/:classId/material/files          docente (CSRF, multipart)
//   GET    /api/classes/:classId/material/files/:fileId  dueño → 302 a link firmado
//   DELETE /api/classes/:classId/material/files/:fileId  docente (CSRF)
// Las reglas: lib/bookingStates.js (checkAction, para cada reserva) y
// lib/classMaterials.js (material).
// Usa: db/classes.js, db/bookings.js, db/classMaterials.js, storage/files.js.
// Los errores salen como { message }; no hay código `error`.

const NOT_FOUND = 'Esa clase no existe.';
const FILE_NOT_FOUND = 'Ese archivo no existe.';
const CHANGED_MEANWHILE = 'La clase cambió mientras tanto. Recargá la página.';

export default async function classesRoutes(app) {
  // Solo para subir material (las rutas de /material/files). Registrado acá
  // adentro queda encapsulado en este plugin: el resto de la API sigue sin
  // aceptar multipart.
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_CLASS, fields: 0 },
  });

  /**
   * La clase y desde qué lado la mira el usuario, o null si no es suya (404,
   * para no contar que existe). El docente es el de la clase; un alumno tiene
   * que tener una reserva en ella (también cancelada: así se le explica por
   * qué no ve el material, en vez de decirle que la clase no existe).
   *
   * @param {object} request - usa params.classId y request.user.id.
   * @returns {Promise<{cls, role: 'teacher', bookings: object[]}
   *   | {cls, role: 'student', booking: object}|null>} cls de findClass;
   *   `bookings` = las reservas en pie (findClassBookings); `booking` = la del
   *   alumno (findStudentBooking).
   */
  async function loadOwnClass(request) {
    const { classId } = request.params;
    if (!isUuid(classId)) return null;
    await expireStartedPending(now());
    const cls = await findClass(classId);
    if (!cls) return null;
    // FILTRO: una clase solo la ven su docente y sus alumnos; ajena = 404.
    if (String(cls.teacherId) === String(request.user.id)) {
      return { cls, role: 'teacher', bookings: await findClassBookings(classId) };
    }
    const booking = await findStudentBooking(classId, request.user.id);
    if (!booking) return null;
    return { cls, role: 'student', booking };
  }

  /**
   * Aceptar o cancelar la CLASE entera: todas sus reservas en pie (una por
   * alumno), todo o nada. Se aplica a las que la acción permite (aceptar,
   * solo las pendientes) con las mismas reglas que de a una (checkAction); si
   * en el medio alguien tocó alguna, no se cambia ninguna y se avisa con un 409.
   *
   * Respuesta: 200 [reservas actualizadas] (sin forViewer: solo lo ve el docente).
   * Errores: 404 clase ajena, 403 no es el docente, el de checkAction si
   *   ninguna se puede, 409 sin reservas en pie o cambió en el medio.
   */
  function classAction(name, apply) {
    app.post(
      `/:classId/${name}`,
      { onRequest: [app.requireAuth, app.csrfProtection] },
      async (request, reply) => {
        const own = await loadOwnClass(request);
        if (!own) return reply.code(404).send({ message: NOT_FOUND });
        if (own.role !== 'teacher') {
          return reply.code(403).send({ message: 'Solo el docente puede actuar sobre toda la clase.' });
        }
        if (own.bookings.length === 0) {
          return reply.code(409).send({ message: 'Esta clase ya no tiene reservas en pie.' });
        }

        const context = { role: 'teacher', now: now() };
        const targets = own.bookings.filter((booking) => !checkAction(name, booking, context));
        if (targets.length === 0) {
          // Ninguna se puede: el motivo de la primera dice por qué.
          const denied = checkAction(name, own.bookings[0], context);
          return reply.code(denied.status).send({ message: denied.message });
        }

        const changes = targets.map((booking) => ({
          id: booking.id,
          from: booking.status,
          ...apply({ booking, role: 'teacher' }),
        }));
        const done = await transitionBookings(changes);
        if (!done) return reply.code(409).send({ message: CHANGED_MEANWHILE });

        return reply.send(await Promise.all(targets.map((booking) => findBookingById(booking.id))));
      }
    );
  }

  classAction('accept', applyAccept);
  classAction('cancel', applyCancel);

  /**
   * El material (resumen + archivos) es de la clase: en una grupal todos sus
   * alumnos ven el mismo. Primero se chequea que la clase sea del usuario
   * (404 si no) y después si ya se puede ver o tocar (lib/classMaterials.js),
   * con el estado que corresponde a quien mira: para el docente, si alguna
   * reserva de la clase pudo darse (materialStatusOf); para el alumno, el de
   * su propia reserva.
   *
   * @param {Function} check - checkViewMaterial o checkEditMaterial.
   * @returns {Promise<{cls, role, classId: string}|null>} con null ya mandó la
   *   respuesta (404 o el status de `check`).
   */
  async function loadMaterialAccess(request, reply, check) {
    const own = await loadOwnClass(request);
    if (!own) {
      reply.code(404).send({ message: NOT_FOUND });
      return null;
    }
    const status =
      own.role === 'teacher' ? materialStatusOf(own.bookings) : own.booking.status;
    const denied = check(
      { status, date: own.cls.date, endTime: own.cls.endTime },
      { role: own.role, now: now() }
    );
    if (denied) {
      reply.code(denied.status).send({ message: denied.message });
      return null;
    }
    return { ...own, classId: own.cls.id };
  }

  /** El material de la clase. Respuesta: 200 findMaterial. Errores: 404, el de checkViewMaterial. */
  app.get('/:classId/material', { onRequest: app.requireAuth }, async (request, reply) => {
    const access = await loadMaterialAccess(request, reply, checkViewMaterial);
    if (!access) return reply;
    return reply.send(await findMaterial(access.classId));
  });

  /**
   * Guardar el resumen. Body: { summary } (≤5000).
   * Respuesta: 200 findMaterial. Errores: 400, 404, el de checkEditMaterial.
   */
  app.put(
    '/:classId/material',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const access = await loadMaterialAccess(request, reply, checkEditMaterial);
      if (!access) return reply;

      const checked = validateSummary(request.body?.summary);
      if (checked.error) {
        return reply.code(400).send({ message: checked.error, fields: { summary: 'invalid' } });
      }
      await saveSummary(access.classId, checked.summary);
      return reply.send(await findMaterial(access.classId));
    }
  );

  // Errores de @fastify/multipart, que traen el mensaje en inglés.
  const UPLOAD_ERRORS = {
    FST_REQ_FILE_TOO_LARGE: `Cada archivo puede pesar hasta ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    FST_FILES_LIMIT: `Una clase puede tener hasta ${MAX_FILES_PER_CLASS} archivos.`,
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
    '/:classId/material/files',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const access = await loadMaterialAccess(request, reply, checkEditMaterial);
      if (!access) return reply;
      if (!isConfigured()) return reply.code(503).send({ message: STORAGE_OFF });

      // Lo que ya tiene la clase, ANTES de leer nada: así se corta apenas un
      // archivo se pasa de los topes, sin juntar en memoria todo lo que mande
      // el cliente (20 archivos de casi 10 MB serían ~200 MB de buffers).
      const { files: existing } = await findMaterial(access.classId);
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
          const storageKey = newFileKey(access.classId, randomUUID());
          await putFile(storageKey, file.data, file.mimeType);
          uploaded.push({ ...file, storageKey });
        }
        const denied = await addFiles(access.classId, uploaded);
        if (denied) {
          await deleteFiles(uploaded.map((file) => file.storageKey), request.log);
          return reply.code(400).send({ message: denied.error });
        }
      } catch (err) {
        await deleteFiles(uploaded.map((file) => file.storageKey), request.log);
        throw err;
      }
      return reply.code(201).send(await findMaterial(access.classId));
    }
  );

  /**
   * Borrar un archivo: primero la fila, después el objeto del bucket.
   * Respuesta: 200 findMaterial. Errores: 404, el de checkEditMaterial, 503.
   */
  app.delete(
    '/:classId/material/files/:fileId',
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
      const storageKey = await deleteFile(access.classId, request.params.fileId);
      if (!storageKey) return reply.code(404).send({ message: FILE_NOT_FOUND });
      await deleteFiles([storageKey], request.log);
      return reply.send(await findMaterial(access.classId));
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
  app.get('/:classId/material/files/:fileId', { onRequest: app.requireAuth }, async (request, reply) => {
    const access = await loadMaterialAccess(request, reply, checkViewMaterial);
    if (!access) return reply;
    if (!isConfigured()) return reply.code(503).send({ message: STORAGE_OFF });
    if (!isUuid(request.params.fileId)) {
      return reply.code(404).send({ message: FILE_NOT_FOUND });
    }
    const file = await findFileMeta(access.classId, request.params.fileId);
    if (!file) return reply.code(404).send({ message: FILE_NOT_FOUND });

    const url = await signedDownloadUrl(file.storageKey, {
      filename: file.name,
      mimeType: file.mimeType,
    });
    return reply.header('Cache-Control', 'private, no-store').redirect(url, 302);
  });
}
