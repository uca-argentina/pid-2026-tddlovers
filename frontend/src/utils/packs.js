// Los paquetes de clases, del lado del front.
//
// Las cuentas (cuántas quedan, cuántas se pueden reservar, si venció) las
// hace el backend (backend/src/lib/classPacks.js) y vienen en cada paquete.
// Acá solo se decide qué mostrar y si ofrecer usar el paquete al reservar; el
// backend vuelve a chequear todo cuando se reserva.

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
 * Lo que se le muestra al alumno de sus paquetes con un docente, o null si no
 * tiene ninguno vigente: { remaining, available, expiresOn } sumando todos.
 */
export function packSummaryWith(packs, teacherId) {
  const activos = activePacksWith(packs, teacherId)
  if (activos.length === 0) return null
  return {
    remaining: activos.reduce((total, pack) => total + pack.remaining, 0),
    available: activos.reduce((total, pack) => total + pack.available, 0),
    expiresOn: activos[0].expiresOn,
  }
}

/**
 * El paquete con el que se podría reservar una clase de ese docente ese día
 * (el mismo criterio que StudentPack.choose del backend: el que vence
 * primero), o null.
 */
export function usablePackFor(packs, teacherId, date) {
  return (
    activePacksWith(packs, teacherId).find(
      (pack) => pack.available > 0 && date <= pack.expiresOn,
    ) || null
  )
}

/** '1 clase' / '3 clases'. */
export function classesLabel(count) {
  return count === 1 ? '1 clase' : `${count} clases`
}

/** 'Vale 30 días' / 'Vale 1 día'. */
export function validityLabel(days) {
  return days === 1 ? 'Vale 1 día' : `Vale ${days} días`
}
