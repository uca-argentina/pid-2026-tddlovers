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
// uno con teacherId, classMinutes, expiresOn, expired, remaining, available y
// `usable` (no vencido, available > 0 y docente aprobado: lo decide el backend).
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

function deTeacher(pack, teacherId) {
  return String(pack.teacherId) === String(teacherId)
}

const byExpiry = (a, b) => a.expiresOn.localeCompare(b.expiresOn)

/**
 * FILTRO: el paquete con el que se puede reservar una clase de ese docente ese
 * día: el que vence primero entre los usables. Si se puede usar lo decide el
 * backend (`usable`: no vencido, con clases disponibles y docente aprobado;
 * GET /api/packs/mine, backend/src/lib/classPacks.js); acá solo se suma lo que
 * depende de la clase: que el día no pase el vencimiento. Es el MISMO paquete
 * para la tarjeta del tablero y para el modal.
 *
 * @param {Array|null} packs - de GET /api/packs/mine (o packsForReschedule).
 * @param {string} teacherId - el docente de la ventana.
 * @param {string} date - el día de la clase, 'YYYY-MM-DD'.
 * @returns {object|null}
 * Lo usan: pages/Booking/BookingDialog.jsx y BookingResults.jsx.
 */
export function usablePackFor(packs, teacherId, date) {
  return (
    (packs || [])
      .filter((pack) => pack.usable && deTeacher(pack, teacherId) && date <= pack.expiresOn)
      .sort(byExpiry)[0] || null
  )
}

/**
 * Por qué ningún paquete del alumno con ese docente sirve para ese día, para
 * explicarlo en el modal en vez de esconderlo: 'expires' si alguno usable
 * vence antes de la clase, 'used' si los que no vencieron ya tienen todas sus
 * clases reservadas, o null (no tiene ninguno vigente, o hay uno que sirve).
 * Mira `usable` y `expired` del backend, no los recalcula.
 * Lo usa: pages/Booking/BookingDialog.jsx.
 */
export function unusablePackReason(packs, teacherId, date) {
  const conDocente = (packs || []).filter((pack) => deTeacher(pack, teacherId) && !pack.expired)
  if (conDocente.length === 0 || usablePackFor(packs, teacherId, date)) return null
  return conDocente.some((pack) => pack.usable) ? 'expires' : 'used'
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
 * @returns {Array} copia con `available` y `usable` ajustados en el paquete de esa clase.
 * Lo usa: pages/Booking/BookingBoard.jsx (para la tarjeta y el modal).
 */
export function packsForReschedule(packs, rescheduleOf) {
  const lista = packs || []
  if (!rescheduleOf?.studentPackId || !rescheduleOf.packTokens) return lista
  return lista.map((pack) => {
    if (String(pack.id) !== String(rescheduleOf.studentPackId)) return pack
    const available = pack.available + rescheduleOf.packTokens
    // `usable` lo calcula el backend sin saber que se reprograma: si era
    // false solo por no tener clases disponibles, ahora sí tiene. Se repite
    // su regla entera (también que el docente siga aprobado), no solo la parte
    // que cambia.
    const usable = !pack.expired && available > 0 && pack.teacherApproved !== false
    return { ...pack, available, usable }
  })
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
