import { hasEnded, nowParts } from './classStates.js'

// El material de una clase ya dada. Las reglas son un ESPEJO de
// backend/src/lib/classMaterials.js y sirven solo para decidir qué mostrar:
// el backend vuelve a chequear todo. Si se toca una regla allá, va acá.
//
// Las clases que reciben son las de GET /api/classes; el material en sí
// ({ summary, files }) llega de GET /api/classes/:id/material.
// Lo usan: components/ClassMaterial.jsx (todo) y components/ClassDetailDialog.jsx
// (canHaveMaterial).

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILES_PER_TURN = 20
const MAX_TURN_BYTES = 25 * 1024 * 1024
export const MAX_SUMMARY_LENGTH = 5000

const GIVEN_STATUSES = ['aceptada', 'confirmada', 'realizada', 'no_presentada']

// Las mismas que el backend sirve inline: las demás se descargan.
const PREVIEW_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * Si la clase pudo tener material: no cancelada ni pendiente (que se vence al empezar).
 *
 * @param {object} cls - una clase de GET /api/classes.
 * @returns {boolean}
 * Lo usan: components/ClassMaterial.jsx, components/ClassDetailDialog.jsx.
 */
export function canHaveMaterial(cls) {
  return GIVEN_STATUSES.includes(cls.status)
}

/**
 * Si el usuario puede escribir el resumen y subir/borrar archivos: el docente,
 * en una clase dada que ya terminó.
 *
 * @param {object} cls - una clase de GET /api/classes.
 * @param {string} role - el rol de la sesión ('teacher' | 'student').
 * @param {object} [now] - la hora actual como la arma nowParts() de utils/classStates.js.
 * @returns {boolean}
 * Lo usa: components/ClassMaterial.jsx.
 */
export function canEditMaterial(cls, role, now = nowParts()) {
  return role === 'teacher' && canHaveMaterial(cls) && hasEnded(cls, now)
}

/**
 * Si el material ya se puede ver (docente o alumno): clase dada y terminada.
 * Mismos parámetros que canEditMaterial, sin el rol. Lo usa: components/ClassMaterial.jsx.
 */
export function canViewMaterial(cls, now = nowParts()) {
  return canHaveMaterial(cls) && hasEnded(cls, now)
}

/**
 * Si el archivo se puede mostrar como imagen (el backend lo sirve inline);
 * los demás van como descarga.
 *
 * @param {string} mimeType - `mimeType` de un archivo del material.
 * @returns {boolean}
 * Lo usa: components/ClassMaterial.jsx.
 */
export function isPreviewable(mimeType) {
  return PREVIEW_TYPES.has(mimeType)
}

/**
 * Por qué no se pueden subir estos archivos al turno, o null si entran.
 * `existing` son los que ya tiene ({ sizeBytes }); `files`, los File elegidos.
 *
 * @param {Array<{sizeBytes: number}>} existing - `files` del material (GET /api/classes/:id/material).
 * @param {File[]} files - los elegidos en el <input type="file">.
 * @returns {string|null} el mensaje a mostrar, o null si entran.
 * Lo usa: components/ClassMaterial.jsx.
 * Espejo: los límites de backend/src/lib/classMaterials.js.
 */
export function uploadProblem(existing, files) {
  if (files.length === 0) return null
  const pesado = files.find((file) => file.size > MAX_FILE_BYTES)
  if (pesado) return `"${pesado.name}" pesa más de ${MAX_FILE_BYTES / 1024 / 1024} MB.`
  if (files.some((file) => file.size === 0)) return 'Hay un archivo vacío.'
  if (existing.length + files.length > MAX_FILES_PER_TURN) {
    return `Una clase puede tener hasta ${MAX_FILES_PER_TURN} archivos.`
  }
  const guardados = existing.reduce((sum, file) => sum + file.sizeBytes, 0)
  const total = guardados + files.reduce((sum, file) => sum + file.size, 0)
  if (total > MAX_TURN_BYTES) {
    return `Los archivos de una clase pueden sumar hasta ${MAX_TURN_BYTES / 1024 / 1024} MB.`
  }
  return null
}

/** "820 B", "14 KB", "2,3 MB", a partir de `sizeBytes`. Lo usa: components/ClassMaterial.jsx. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / 1024 / 1024
  return `${mb.toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`
}
