// El material de una clase ya dada (resumen + archivos): quién lo ve, quién
// lo carga, desde cuándo y cuánto entra. Funciones puras como las de
// bookingStates.js: dependen de la hora, y así se prueban sin reloj ni base.
//
// El material es de la CLASE (classes.id), no de cada reserva: en una grupal
// lo carga una vez el docente y lo ven todos los anotados.
//
// Tablas: class_materials y class_material_files (migración 018; por class_id
// desde la 024); los bytes de
// los archivos viven en el bucket S3 (storage/files.js), no en Postgres.
// Lo usan: routes/classes/index.js (rutas /:classId/material*), db/classMaterials.js
// (re-chequeo de topes bajo lock) y storage/files.js (contentDisposition).
// Espejo: frontend/src/utils/classMaterials.js (canEditMaterial,
// canViewMaterial, uploadProblem), solo para decidir qué mostrar.

import { hasEnded } from './bookingStates.js';

// Topes de CLAUDE.md ("Class material"): resumen ≤5000 caracteres, cada archivo
// ≤10 MB, y por clase ≤20 archivos y ≤25 MB en total. MAX_FILE_BYTES y
// MAX_FILES_PER_CLASS también los usa la ruta como límites de @fastify/multipart.
const MAX_SUMMARY_LENGTH = 5000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
// Topes por clase: los archivos van al bucket S3 (no a Postgres), pero el
// espacio del bucket es limitado y la subida se arma en memoria antes de
// subirla, así que una clase no puede ocupar más que esto.
export const MAX_CLASS_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_CLASS = 20;
const MAX_NAME_LENGTH = 255;

// Estados en los que la clase pudo haberse dado: una pendiente que llegó a
// empezar se vence, y una cancelada no se dio.
const GIVEN_STATUSES = ['aceptada', 'confirmada', 'realizada', 'no_presentada'];

// Lo único que se muestra adentro de la página. Todo lo demás se descarga:
// un .html o un .svg servido inline desde el mismo origen correría scripts
// con la sesión del que lo abre.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const NOT_ENDED_MESSAGE = 'Vas a poder ver el material cuando termine la clase.';

/**
 * El estado con el que se decide el material de una clase para su docente: el
 * de una reserva que pudo darse, si hay alguna (en una grupal alcanza con que
 * un alumno haya tenido la clase), o 'cancelada' si ninguna.
 *
 * @param {Array<{status: string}>} bookings - las reservas en pie de la clase
 *   (findClassBookings de db/bookings.js).
 * @returns {string} un booking_status.
 * Lo usa: routes/classes/index.js (loadMaterialAccess, para el docente).
 */
export function materialStatusOf(bookings) {
  return bookings.find((booking) => GIVEN_STATUSES.includes(booking.status))?.status ?? 'cancelada';
}

/**
 * ¿Puede `role` cargar o borrar material de esa clase? Solo el docente, y solo
 * cuando la clase ya terminó y pudo haberse dado (no pendiente ni cancelada).
 *
 * @param {{status: string, date: string, endTime: string}} subject - fecha y fin de
 *   la clase, con el estado que le corresponde a quien mira (loadMaterialAccess
 *   en la ruta: materialStatusOf para el docente, su reserva para el alumno).
 * @param {{role: 'teacher'|'student', now: {iso, time}}} ctx - `role` es el papel en
 *   esa clase (loadOwnClass de la ruta) y `now` sale de now() de lib/clock.js.
 * @returns {null|{status: number, message: string}} como checkAction.
 * Lo usa: routes/classes/index.js (PUT material, subir y borrar archivos, vía loadMaterialAccess).
 * Espejo: frontend/src/utils/classMaterials.js (canEditMaterial).
 */
export function checkEditMaterial(subject, { role, now }) {
  if (role !== 'teacher') return { status: 403, message: 'Solo el docente puede cargar material.' };
  if (!GIVEN_STATUSES.includes(subject.status)) {
    return { status: 409, message: 'Esta clase no se dio: no se le puede cargar material.' };
  }
  if (!hasEnded(subject, now)) {
    return { status: 409, message: 'Vas a poder cargar el material cuando termine la clase.' };
  }
  return null;
}

/**
 * Lo mismo para ver: el docente cuando podría cargarlo, el alumno si su reserva
 * no se canceló (también si quedó no_presentada) y la clase ya terminó.
 * Mismos parámetros y retorno que checkEditMaterial.
 * Lo usa: routes/classes/index.js (GET material y descarga de archivos).
 * Espejo: frontend/src/utils/classMaterials.js (canViewMaterial).
 */
export function checkViewMaterial(subject, { role, now }) {
  // FILTRO: el material se ve solo de una clase que se dio (aceptada,
  // confirmada, realizada o ausente) y que ya terminó.
  if (role === 'teacher') return checkEditMaterial(subject, { role, now });
  if (!GIVEN_STATUSES.includes(subject.status)) {
    return { status: 409, message: 'Esta clase no se dio: no tiene material.' };
  }
  if (!hasEnded(subject, now)) return { status: 409, message: NOT_ENDED_MESSAGE };
  return null;
}

/**
 * El resumen normalizado (sin espacios en los bordes; vacío vale), o { error }.
 * @param {*} summary - request.body.summary de PUT /api/classes/:id/material.
 * @returns {{summary: string}|{error: string}}
 * Lo usa: routes/classes/index.js.
 */
export function validateSummary(summary) {
  if (typeof summary !== 'string') return { error: 'Falta el resumen.' };
  const text = summary.trim();
  if (text.length > MAX_SUMMARY_LENGTH) {
    return { error: `El resumen puede tener hasta ${MAX_SUMMARY_LENGTH} caracteres.` };
  }
  return { summary: text };
}

/**
 * El nombre que se guarda: sin carpetas (un navegador viejo manda la ruta
 * entera) ni caracteres de control, y no más largo que lo que entra.
 *
 * @param {*} name - `part.filename` de cada archivo del multipart.
 * @returns {string} el nombre limpio ('archivo' si no queda nada), que va a
 *   class_material_files y al Content-Disposition de la descarga.
 * Lo usa: routes/classes/index.js (subida de archivos).
 */
export function sanitizeFilename(name) {
  const base = String(name ?? '').split(/[\\/]/).pop();
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  if (!clean) return 'archivo';
  if (clean.length <= MAX_NAME_LENGTH) return clean;
  // Se corta por el medio para no perder la extensión.
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : '';
  return clean.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
}

/**
 * Si los archivos nuevos entran en la clase, sumados a los que ya tiene.
 *
 * @param {{count: number, bytes: number}} existing - lo ya guardado de la clase:
 *   en la ruta sale del material actual (findMaterial), y en db/classMaterials.js
 *   de un count/sum sobre class_material_files bajo el lock de la clase.
 * @param {Array<{sizeBytes: number}>} files - los archivos del multipart leídos hasta ahora.
 * @returns {string|null} null si entran, o el mensaje de por qué no.
 * Lo usan: routes/classes/index.js (mientras lee la subida) y db/classMaterials.js (addFiles).
 * Espejo: frontend/src/utils/classMaterials.js (uploadProblem).
 */
export function checkUploadRoom(existing, files) {
  if (files.length === 0) return 'Elegí al menos un archivo.';
  if (files.some((f) => f.sizeBytes === 0)) return 'Hay un archivo vacío.';
  if (files.some((f) => f.sizeBytes > MAX_FILE_BYTES)) {
    return `Cada archivo puede pesar hasta ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  }
  if (existing.count + files.length > MAX_FILES_PER_CLASS) {
    return `Una clase puede tener hasta ${MAX_FILES_PER_CLASS} archivos.`;
  }
  const total = existing.bytes + files.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (total > MAX_CLASS_BYTES) {
    return `Los archivos de una clase pueden sumar hasta ${MAX_CLASS_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

/** ¿Se puede mostrar adentro del navegador (png/jpeg/gif/webp)? Solo se usa en este archivo. */
export function inlineSafe(mimeType) {
  return INLINE_TYPES.has(mimeType);
}

/**
 * El Content-Disposition de una descarga: `inline` solo para imágenes comunes,
 * `attachment` para todo lo demás (así un .html o .svg subido nunca se renderiza).
 * filename= lleva una versión ASCII para navegadores viejos y filename*= el
 * nombre real en UTF-8 (RFC 5987): los nombres en castellano tienen tildes.
 *
 * @param {string} filename - el nombre guardado en class_material_files.
 * @param {string} mimeType - el tipo guardado en class_material_files.
 * @returns {string} el valor del header.
 * Lo usa: storage/files.js (signedDownloadUrl, va como response-content-disposition del link).
 */
export function contentDisposition(filename, mimeType) {
  const kind = inlineSafe(mimeType) ? 'inline' : 'attachment';
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
