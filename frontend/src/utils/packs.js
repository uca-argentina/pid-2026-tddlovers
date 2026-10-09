// Los paquetes de clases, del lado del front.
//
// Cada clase del paquete dura lo mismo (classMinutes, lo decide el docente).
// Al reservar, el alumno usa una o más y paga aparte lo que se pase.
//
// Las cuentas (cuántas quedan, cuántas se pueden reservar, si venció) las
// hace el backend (backend/src/lib/classPacks.js) y vienen en cada paquete.
// Acá solo se decide qué mostrar y si ofrecer usar el paquete al reservar; el
// backend vuelve a chequear todo cuando se reserva.

import { formatMinutes } from './windows.js'

const DATE_FORMAT = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** '2099-10-09' -> '9 oct 2099', sin pasar por la zona horaria. */
export function formatPackDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return DATE_FORMAT.format(new Date(y, m - 1, d))
}

/** Los paquetes vigentes del alumno con ese docente, el que vence primero arriba. */
export function activePacksWith(packs, teacherId) {
  return (packs || [])
    .filter((pack) => String(pack.teacherId) === String(teacherId) && !pack.expired)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
}

/**
 * Lo que se le muestra al alumno de su paquete con un docente (el que vence
 * primero), o null si no tiene ninguno vigente.
 */
export function packSummaryWith(packs, teacherId) {
  return activePacksWith(packs, teacherId)[0] || null
}

/**
 * El paquete con el que se podría reservar una clase de ese docente ese día:
 * el que vence primero entre los que tienen clases para reservar, o null.
 */
export function usablePackFor(packs, teacherId, date) {
  return (
    activePacksWith(packs, teacherId).find(
      (pack) => pack.available > 0 && date <= pack.expiresOn,
    ) || null
  )
}

/**
 * Cuántas clases del paquete se pueden usar en una clase de `minutes`: las
 * que quedan, sin cubrir más de lo que dura (el backend rechaza eso).
 */
export function maxTokensFor(pack, minutes) {
  if (!pack || !minutes) return 0
  return Math.min(pack.available, Math.floor(minutes / pack.classMinutes))
}

/** '4 clases de 1 h' / '1 clase de 1 h 30 min'. */
export function packClassesLabel(count, classMinutes) {
  return `${classesLabel(count)} de ${formatMinutes(classMinutes)}`
}

/** '1 clase' / '3 clases'. */
export function classesLabel(count) {
  return count === 1 ? '1 clase' : `${count} clases`
}

/** 'Vale 30 días' / 'Vale 1 día'. */
export function validityLabel(days) {
  return days === 1 ? 'Vale 1 día' : `Vale ${days} días`
}
