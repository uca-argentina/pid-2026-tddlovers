// Los paquetes de clases, del lado del front.
//
// Cada clase del paquete dura lo mismo (classMinutes, lo decide el docente).
// Al reservar, el alumno usa una o más y paga aparte lo que se pase.
//
// Las cuentas (cuántas quedan, cuántas se pueden reservar, si venció) las
// hace el backend (backend/src/lib/classPacks.js) y vienen en cada paquete.
// Acá solo se decide qué mostrar y si ofrecer usar el paquete al reservar; el
// backend vuelve a chequear todo cuando se reserva.
//
// Los paquetes del alumno llegan de GET /api/packs/mine (fetchMyPacks): cada
// uno con teacherId, classMinutes, expiresOn, expired, remaining y available.
// Lo usan: pages/Booking/ (BookingDialog, BookingCard, BookingResults),
// pages/Packs/PacksPage.jsx y pages/Neuronas/NeuronasPage.jsx (formatPackDate).

import { formatMinutes } from './windows.js'
import { classPriceCents } from './rates.js'
import { rewardApplies, rewardPriceCents } from './neuronas.js'

const DATE_FORMAT = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/**
 * '2099-10-09' -> '9 oct 2099', sin pasar por la zona horaria.
 * Lo usan: pages/Packs/PacksPage.jsx, pages/Booking/BookingDialog.jsx, pages/Neuronas/NeuronasPage.jsx.
 */
export function formatPackDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return DATE_FORMAT.format(new Date(y, m - 1, d))
}

/**
 * Los paquetes vigentes del alumno con ese docente, el que vence primero arriba.
 *
 * @param {Array|null} packs - de GET /api/packs/mine.
 * @param {string} teacherId - el `teacherId` de la fila/tarjeta de disponibilidad.
 * @returns {Array} filtrados (no vencidos) y ordenados por expiresOn.
 * Lo usa: pages/Booking/BookingDialog.jsx.
 */
export function activePacksWith(packs, teacherId) {
  return (packs || [])
    .filter((pack) => String(pack.teacherId) === String(teacherId) && !pack.expired)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
}

/**
 * Lo que se le muestra al alumno de su paquete con un docente (el que vence
 * primero), o null si no tiene ninguno vigente. Para el "Te quedan N clases…"
 * de la tarjeta. Lo usa: pages/Booking/BookingResults.jsx.
 */
export function packSummaryWith(packs, teacherId) {
  return activePacksWith(packs, teacherId)[0] || null
}

/**
 * El paquete con el que se podría reservar una clase de ese docente ese día:
 * el que vence primero entre los que tienen clases para reservar, o null.
 *
 * @param {Array|null} packs - de GET /api/packs/mine (o packsForReschedule).
 * @param {string} teacherId - el docente de la ventana.
 * @param {string} date - el día de la clase, 'YYYY-MM-DD' (no puede pasarse de expiresOn).
 * @returns {object|null}
 * Lo usa: pages/Booking/BookingDialog.jsx.
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
 * Lo usa: quoteBooking (acá mismo).
 */
export function maxTokensFor(pack, minutes) {
  if (!pack || !minutes) return 0
  return Math.min(pack.available, Math.floor(minutes / pack.classMinutes))
}

/**
 * Los paquetes como quedan al reprogramar `rescheduleOf`: la clase vieja se
 * cancela en la misma transacción, así que las clases del paquete que tenía
 * apartadas vuelven a estar para reservar (el backend hace lo mismo con
 * excludeClassId). Sin esto, con el paquete justo, reprogramar cobraría entera
 * una clase que el paquete cubre.
 *
 * @param {Array|null} packs - de GET /api/packs/mine.
 * @param {object|null} rescheduleOf - la clase que se reprograma (GET /api/classes/:id,
 *   de ?reprogramar=<id>), con studentPackId y packTokens.
 * @returns {Array} copia con `available` ajustado en el paquete de esa clase.
 * Lo usa: pages/Booking/BookingDialog.jsx.
 */
export function packsForReschedule(packs, rescheduleOf) {
  const lista = packs || []
  if (!rescheduleOf?.studentPackId || !rescheduleOf.packTokens) return lista
  return lista.map((pack) =>
    String(pack.id) === String(rescheduleOf.studentPackId)
      ? { ...pack, available: pack.available + rescheduleOf.packTokens }
      : pack,
  )
}

/**
 * Lo que cuesta la clase armada en el modal, de una sola vez:
 *   - `maxTokens`: cuántas clases del paquete entran como mucho;
 *   - `tokens`: cuántas usa (lo pedido recortado a lo que entra; null = todas
 *     las que entran). 0 si hay canje: paquete y neuronas no se combinan;
 *   - `extraMinutes`: lo que se paga aparte con la tarifa;
 *   - `reward`: el canje que se aplica, o null si no vale (no entra, materia
 *     gratis, el docente no acepta, no alcanza el saldo);
 *   - `priceCents`: lo que se paga, o null si falta la materia o la duración;
 *   - `coveredBy`: 'pack' o 'reward' si la clase queda cubierta entera.
 *
 * El precio espeja al backend (validateBooking en routes/classes): con paquete
 * se cobra solo lo que se pasa, con canje lo que deja el canje. El que vale es
 * el de allá.
 *
 * Entradas (todas del estado de BookingDialog): hourlyRateCents de la materia
 * elegida (fila de GET /api/availability), minutes (duración elegida), pack
 * (usablePackFor), packTokens (el stepper; null = todas), rewardType (canje
 * elegido), acceptsRewards (teacherAcceptsRewards de la fila) y balance
 * (de GET /api/neuronas).
 * Lo usa: pages/Booking/BookingDialog.jsx.
 * Espejo: priceBooking/validateBooking de backend/src/routes/classes/index.js.
 */
export function quoteBooking({
  hourlyRateCents = null,
  minutes = null,
  pack = null,
  packTokens = null,
  rewardType = null,
  acceptsRewards = false,
  balance = Infinity,
}) {
  const conTarifa = hourlyRateCents !== null && Boolean(minutes)
  const reward =
    rewardType &&
    conTarifa &&
    rewardApplies(rewardType, { acceptsRewards, hourlyRateCents, minutes, balance })
      ? rewardType
      : null

  const maxTokens = maxTokensFor(pack, minutes)
  let tokens = 0
  if (!reward) tokens = packTokens === null ? maxTokens : Math.max(0, Math.min(packTokens, maxTokens))
  const extraMinutes = Math.max((minutes || 0) - (pack ? tokens * pack.classMinutes : 0), 0)

  let priceCents = null
  if (conTarifa) {
    priceCents = reward
      ? rewardPriceCents(reward, { hourlyRateCents, minutes })
      : classPriceCents(hourlyRateCents, extraMinutes)
  }

  let coveredBy = null
  if (tokens > 0 && extraMinutes === 0) coveredBy = 'pack'
  else if (reward && priceCents === 0) coveredBy = 'reward'

  return { maxTokens, tokens, extraMinutes, reward, priceCents, coveredBy }
}

/**
 * '4 clases de 1 h' / '1 clase de 1 h 30 min'.
 * Lo usan: pages/Booking/BookingCard.jsx y BookingDialog.jsx, pages/Packs/PacksPage.jsx.
 */
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
