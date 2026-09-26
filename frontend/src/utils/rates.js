// Plata y tarifas. El docente pone en su perfil cuánto cobra la hora de cada
// materia en cada modalidad; el alumno elige materia y duración al reservar,
// y la clase cuesta tarifa × duración.
//
// Todo en CENTAVOS enteros, igual que el backend (lib/teacherRates.js):
// $ 5.000/h por 50 min son $ 4.166,67, y con enteros la cuenta da lo mismo
// acá que allá. La cuenta de acá es para mostrar el precio antes de
// reservar; la que vale es la del backend.
//
// No importa de ningún otro utils/: lo usan windows.js y booking.js, y así no
// hay ciclo posible.

// El mismo techo que el CHECK de teacher_rates: $ 10.000.000 la hora.
export const MAX_HOURLY_RATE_CENTS = 1000000000

// La clase más corta que se puede reservar, y de a cuánto se elige la duración.
export const MIN_CLASS_MINUTES = 30
export const CLASS_MINUTES_STEP = 5

const WHOLE_FORMAT = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

const CENTS_FORMAT = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * 500000 -> '$ 5.000'; 416667 -> '$ 4.166,67'; 0 -> 'Sin cargo'. Los
 * centavos se muestran solo si hay: '$ 5.000,00' es ruido.
 */
export function formatMoney(cents) {
  if (cents === 0) return 'Sin cargo'
  if (cents % 100 === 0) return WHOLE_FORMAT.format(cents / 100)
  return CENTS_FORMAT.format(cents / 100)
}

/** '$ 5.000/h', o 'Sin cargo'. */
export function formatHourlyRate(cents) {
  return cents === 0 ? 'Sin cargo' : `${formatMoney(cents)}/h`
}

/**
 * Lo que se tipeó en un campo de plata -> centavos, o NaN. Acepta cómo se
 * escribe un monto acá: '5000', '5.000', '$ 5.000', '5.000,50'. El punto es
 * de miles y la coma de centavos (hasta dos).
 */
export function parseMoney(text) {
  const limpio = String(text).replace(/[\s$.]/g, '')
  const match = /^(\d+)(?:,(\d{1,2}))?$/.exec(limpio)
  if (!match) return NaN
  const centavos = (match[2] || '').padEnd(2, '0')
  return Number(match[1]) * 100 + Number(centavos)
}

/** Para volver a poner un monto en un campo: 500000 -> '5000', 500050 -> '5000,50'. */
export function centsToInput(cents) {
  const pesos = Math.floor(cents / 100)
  const resto = cents % 100
  return resto === 0 ? String(pesos) : `${pesos},${String(resto).padStart(2, '0')}`
}

/** Lo que sale una clase: la parte proporcional de la tarifa, al centavo. */
export function classPriceCents(hourlyRateCents, minutes) {
  return Math.round((hourlyRateCents * minutes) / 60)
}

/** Las duraciones que se pueden elegir hasta `maxMinutes`: 30, 35, 40... */
export function durationOptions(maxMinutes) {
  const opciones = []
  for (let minutos = MIN_CLASS_MINUTES; minutos <= maxMinutes; minutos += CLASS_MINUTES_STEP) {
    opciones.push(minutos)
  }
  return opciones
}

/** Las modalidades en las que el docente tiene al menos una tarifa. */
export function rateModalities(rates) {
  return [...new Set((rates || []).map((rate) => rate.modality))]
}

/**
 * Las tarifas del usuario con el nombre de la materia, para mostrarlas:
 * [{ subjectId, subjectName, modality, hourlyRateCents }]. Si el catálogo no
 * cargó, el nombre queda genérico en vez de romper la pantalla.
 */
export function resolveRates(rates, catalog) {
  const nombres = {}
  for (const subject of catalog || []) nombres[String(subject.id)] = subject.name
  return (rates || [])
    .map((rate) => ({ ...rate, subjectName: nombres[String(rate.subjectId)] || 'Materia' }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName))
}

/** Las materias que se ofrecen en una modalidad: las tarifas resueltas de esa modalidad. */
export function ratesForModality(resolvedRates, modality) {
  return resolvedRates.filter((rate) => rate.modality === modality)
}
