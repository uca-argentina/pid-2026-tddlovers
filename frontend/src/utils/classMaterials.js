import { hasEnded, nowParts } from './classStates.js'

// El material de una clase ya dada. Las reglas son un ESPEJO de
// backend/src/lib/classMaterials.js y sirven solo para decidir qué mostrar:
// el backend vuelve a chequear todo. Si se toca una regla allá, va acá.

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_FILES_PER_TURN = 20
export const MAX_TURN_BYTES = 25 * 1024 * 1024
export const MAX_SUMMARY_LENGTH = 5000

const GIVEN_STATUSES = ['aceptada', 'confirmada', 'realizada', 'no_presentada']

// Las mismas que el backend sirve inline: las demás se descargan.
const PREVIEW_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Si la clase pudo tener material: no cancelada ni pendiente (que se vence al empezar). */
export function canHaveMaterial(cls) {
  return GIVEN_STATUSES.includes(cls.status)
}

export function canEditMaterial(cls, role, now = nowParts()) {
  return role === 'teacher' && canHaveMaterial(cls) && hasEnded(cls, now)
}

export function canViewMaterial(cls, role, now = nowParts()) {
  return canHaveMaterial(cls) && hasEnded(cls, now)
}

export function isPreviewable(mimeType) {
  return PREVIEW_TYPES.has(mimeType)
}

/**
 * Por qué no se pueden subir estos archivos al turno, o null si entran.
 * `existing` son los que ya tiene ({ sizeBytes }); `files`, los File elegidos.
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

/** "820 B", "14 KB", "2,3 MB". */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / 1024 / 1024
  return `${mb.toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`
}
