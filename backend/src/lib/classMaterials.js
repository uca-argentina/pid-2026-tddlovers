// El material de una clase ya dada (resumen + archivos): quién lo ve, quién
// lo carga, desde cuándo y cuánto entra. Funciones puras como las de
// classStates.js: dependen de la hora, y así se prueban sin reloj ni base.
//
// El material es del TURNO (docente, fecha, inicio): en una grupal lo carga
// una vez el docente y lo ven todos los anotados.

export const MAX_SUMMARY_LENGTH = 5000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
// Topes por turno: la base de producción (Neon free) tiene 0,5 GB para todo.
export const MAX_TURN_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_TURN = 20;
const MAX_NAME_LENGTH = 255;

// Estados en los que la clase pudo haberse dado: una pendiente que llegó a
// empezar se vence, y una cancelada no se dio.
const GIVEN_STATUSES = ['aceptada', 'confirmada', 'realizada', 'no_presentada'];

// Lo único que se muestra adentro de la página. Todo lo demás se descarga:
// un .html o un .svg servido inline desde el mismo origen correría scripts
// con la sesión del que lo abre.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function toEpochMinutes(iso, time) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) / 60000;
}

/** `now` es el de lib/clock.js. Un fin "24:00" cae bien: es la medianoche siguiente. */
export function hasEnded(cls, now) {
  return toEpochMinutes(cls.date, cls.endTime) <= toEpochMinutes(now.iso, now.time);
}

export const NOT_ENDED_MESSAGE = 'Vas a poder ver el material cuando termine la clase.';

/**
 * null si `role` puede cargar o borrar material de esa clase; si no,
 * { status, message } como checkAction.
 */
export function checkEditMaterial(cls, { role, now }) {
  if (role !== 'teacher') return { status: 403, message: 'Solo el docente puede cargar material.' };
  if (!GIVEN_STATUSES.includes(cls.status)) {
    return { status: 409, message: 'Esta clase no se dio: no se le puede cargar material.' };
  }
  if (!hasEnded(cls, now)) {
    return { status: 409, message: 'Vas a poder cargar el material cuando termine la clase.' };
  }
  return null;
}

/** Lo mismo para ver: el docente cuando podría cargarlo, el alumno si su reserva no se canceló. */
export function checkViewMaterial(cls, { role, now }) {
  if (role === 'teacher') return checkEditMaterial(cls, { role, now });
  if (!GIVEN_STATUSES.includes(cls.status)) {
    return { status: 409, message: 'Esta clase no se dio: no tiene material.' };
  }
  if (!hasEnded(cls, now)) return { status: 409, message: NOT_ENDED_MESSAGE };
  return null;
}

/** El resumen normalizado, o { error } con el mensaje. */
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
 * Si los archivos nuevos entran en el turno, sumados a los que ya tiene.
 * `existing` = { count, bytes } de lo ya guardado; `files` = [{ sizeBytes }].
 * Devuelve null o el mensaje de por qué no.
 */
export function checkUploadRoom(existing, files) {
  if (files.length === 0) return 'Elegí al menos un archivo.';
  if (files.some((f) => f.sizeBytes === 0)) return 'Hay un archivo vacío.';
  if (files.some((f) => f.sizeBytes > MAX_FILE_BYTES)) {
    return `Cada archivo puede pesar hasta ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  }
  if (existing.count + files.length > MAX_FILES_PER_TURN) {
    return `Una clase puede tener hasta ${MAX_FILES_PER_TURN} archivos.`;
  }
  const total = existing.bytes + files.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (total > MAX_TURN_BYTES) {
    return `Los archivos de una clase pueden sumar hasta ${MAX_TURN_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

export function inlineSafe(mimeType) {
  return INLINE_TYPES.has(mimeType);
}

/**
 * El Content-Disposition de una descarga. filename= lleva una versión ASCII
 * para navegadores viejos y filename*= el nombre real en UTF-8 (RFC 5987):
 * los nombres en castellano tienen tildes.
 */
export function contentDisposition(filename, mimeType) {
  const kind = inlineSafe(mimeType) ? 'inline' : 'attachment';
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
