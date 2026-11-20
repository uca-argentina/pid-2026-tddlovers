// Chequeos de formato que comparten varias rutas y reglas. Antes cada archivo
// tenía su copia, y no todas validaban igual: una fecha como '2026-02-30'
// pasaba la regex en algunas y terminaba en un 500 de Postgres.
//
// Lo usan: casi todas las rutas de routes/* (isUuid sobre ids de params y
// body) y las reglas de lib/ (isRealDate en availabilityExpansion,
// availabilityWindow, homework y vacations; UUID_RE en teacherRates).

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Es un id válido (UUID en texto)? Los ids de la app son UUID opacos
 * (gen_random_uuid()); un id mal formado que llegara a Postgres daría un 500.
 *
 * @param {*} value - normalmente un `request.params.id` o un id del body.
 * @returns {boolean}
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * ¿Es una fecha 'YYYY-MM-DD' que existe en el calendario?
 *
 * @param {*} iso - una fecha del body o de la query (`?from&to`, `date`, `dueDate`...).
 * @returns {boolean} false si no es texto, no tiene el formato o no existe ('2026-02-30').
 */
export function isRealDate(iso) {
  if (typeof iso !== 'string' || !ISO_DATE_RE.test(iso)) return false;
  // '2026-02-31' pasa la regex pero no existe: Date la corre al 3 de marzo.
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}
