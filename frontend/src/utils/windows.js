// Las ventanas de disponibilidad del docente: "el lunes 14 de 13:00 a 16:00
// doy Matemática, clases de 1 h, presencial, hasta 4 alumnos", con la opción
// de que se repita todas las semanas desde ese día.
//
// Funciones puras, sin React, igual que calendar.js y availability.js. De acá
// salen la ubicación de cada ventana en la semana que se muestra, las
// opciones de los selects del formulario y su validación. La validación es la
// misma que hace el backend (lib/availabilityWindow.js): la de acá es para
// avisar antes de mandar, la de allá es la que manda.
//
// Horas en minutos desde medianoche para comparar: '24:00' como texto ordena
// bien de casualidad, pero restar strings no.

import { dayLabel } from './availability.js'
import { addDays, mondayIndex, toISODate } from './calendar.js'
import { dayKeyFromIso } from './booking.js'

// Los valores viajan por la API y viven en la base: en inglés. Lo que se lee
// en pantalla es `label`.
export const MODALITIES = [
  { key: 'virtual', label: 'Virtual' },
  { key: 'in_person', label: 'Presencial' },
  { key: 'hybrid', label: 'Híbrida' },
]

const MODALITY_LABELS = MODALITIES.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

// La duración es libre (45, 50, 75 min...), pero no menos de media hora.
export const MIN_DURATION = 30
// Los mismos techos que los CHECK de la base: frenan un typo con ceros de más.
export const MAX_STUDENTS_LIMIT = 50
export const MAX_PRICE = 10000000
// Grupal con cupo 1 sería individual: el mínimo de una grupal es 2.
export const MIN_GROUP_SIZE = 2

export function modalityLabel(key) {
  return MODALITY_LABELS[key] || key
}

/** ¿Lleva link? Virtual e híbrida. */
export function needsMeetingUrl(modality) {
  return modality === 'virtual' || modality === 'hybrid'
}

/** ¿Lleva dirección? Presencial e híbrida. */
export function needsAddress(modality) {
  return modality === 'in_person' || modality === 'hybrid'
}

export function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 30 -> '30 min', 60 -> '1 h', 90 -> '1 h 30 min'. */
export function formatMinutes(total) {
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

const PRICE_FORMAT = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

/** 15000 -> '$ 15.000'; 0 -> 'Sin cargo'. Es por alumno y por clase. */
export function formatPrice(price) {
  if (price === 0) return 'Sin cargo'
  return PRICE_FORMAT.format(price)
}

/**
 * Lo que se tipeó en el campo de precio -> pesos enteros, o NaN. Acepta cómo
 * se escribe un monto acá: '15000', '15.000', '$ 15.000'. Una coma es de
 * centavos, y centavos no hay.
 */
export function parsePrice(text) {
  const limpio = String(text).replace(/[\s$.]/g, '')
  return /^\d+$/.test(limpio) ? Number(limpio) : NaN
}

/** '45' -> 45, o NaN si no son minutos enteros. */
export function parseMinutes(text) {
  const limpio = String(text).trim()
  return /^\d+$/.test(limpio) ? Number(limpio) : NaN
}

/** 'Individual' o 'Grupal · hasta 5'. */
export function capacityLabel(maxStudents) {
  return maxStudents > 1 ? `Grupal · hasta ${maxStudents}` : 'Individual'
}

/**
 * ¿La ventana cae en esa fecha? La suya, o —si se repite— cualquier fecha
 * posterior del mismo día de la semana. El backend decide igual
 * (occursOn en lib/availabilityExpansion.js).
 */
export function occursOn(window, iso) {
  if (iso === window.date) return true
  return Boolean(
    window.repeatsWeekly && iso > window.date && dayKeyFromIso(iso) === dayKeyFromIso(window.date),
  )
}

/** Las ventanas que caen ese día, de la más temprana a la más tarde. */
export function windowsOn(windows, iso) {
  return windows
    .filter((window) => occursOn(window, iso))
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
}

/** El lunes de la semana de `date`. */
export function startOfWeek(date) {
  return addDays(date, -mondayIndex(date))
}

/** Los 7 días de la semana que arranca en `monday`. */
export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

const DAY_MONTH_FORMAT = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' })
const DAY_MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/**
 * '14 – 20 de septiembre de 2026', o con los dos meses si la semana cruza
 * uno: '28 de septiembre – 4 de octubre de 2026'. El año va una sola vez,
 * salvo que la semana cruce de año.
 */
export function formatWeekTitle(monday) {
  const sunday = addDays(monday, 6)
  const fin = DAY_MONTH_YEAR_FORMAT.format(sunday)

  if (monday.getFullYear() !== sunday.getFullYear()) {
    return `${DAY_MONTH_YEAR_FORMAT.format(monday)} – ${fin}`
  }
  if (monday.getMonth() !== sunday.getMonth()) {
    return `${DAY_MONTH_FORMAT.format(monday)} – ${fin}`
  }
  return `${monday.getDate()} – ${fin}`
}

/**
 * 'lunes' -> 'lunes', 'sabado' -> 'sábados': el plural para "todos los ...".
 * Los días que ya terminan en s no cambian.
 */
export function weekdayPlural(iso) {
  const dia = dayLabel(dayKeyFromIso(iso)).toLowerCase()
  return dia.endsWith('s') ? dia : `${dia}s`
}

/** 'Todos los lunes'. */
export function repeatLabel(window) {
  return `Todos los ${weekdayPlural(window.date)}`
}

/**
 * Qué horas muestra el calendario semanal: de 8 a 20 como mínimo (un día de
 * clases normal) y estirado a lo que haga falta para que entre todo.
 */
export function visibleHours(windows) {
  let from = 8
  let to = 20
  for (const window of windows) {
    from = Math.min(from, Math.floor(toMinutes(window.start) / 60))
    to = Math.max(to, Math.ceil(toMinutes(window.end) / 60))
  }
  return { from, to }
}

// --- El formulario --------------------------------------------------------

/**
 * Lo que el formulario edita. Se parece a la ventana pero separa "es grupal"
 * del cupo: así destildar grupal y volver a tildarlo no pierde el número que
 * se había escrito. Duración y precio son texto, tal cual se tipean: se
 * convierten recién al mandar.
 */
export function emptyDraft({ date, subjectId = '' }) {
  return {
    id: null,
    date,
    repeatsWeekly: false,
    start: '09:00',
    end: '10:00',
    subjectId,
    durationMinutes: '60',
    price: '',
    modality: 'virtual',
    group: false,
    groupSize: String(MIN_GROUP_SIZE),
    meetingUrl: '',
    locality: '',
    address: '',
  }
}

export function draftFromWindow(window) {
  return {
    id: window.id,
    date: window.date,
    repeatsWeekly: window.repeatsWeekly,
    start: window.start,
    end: window.end,
    subjectId: window.subjectId,
    durationMinutes: String(window.durationMinutes),
    price: String(window.price ?? ''),
    modality: window.modality,
    group: window.maxStudents > 1,
    groupSize: String(window.maxStudents > 1 ? window.maxStudents : MIN_GROUP_SIZE),
    meetingUrl: window.meetingUrl || '',
    locality: window.locality || '',
    address: window.address || '',
  }
}

/** Lo que va al backend. */
export function draftToPayload(draft) {
  return {
    date: draft.date,
    repeatsWeekly: draft.repeatsWeekly,
    start: draft.start,
    end: draft.end,
    subjectId: draft.subjectId,
    durationMinutes: parseMinutes(draft.durationMinutes),
    price: parsePrice(draft.price),
    modality: draft.modality,
    maxStudents: draft.group ? Number(draft.groupSize) : 1,
    meetingUrl: needsMeetingUrl(draft.modality) ? draft.meetingUrl.trim() : '',
    locality: needsAddress(draft.modality) ? draft.locality.trim() : '',
    address: needsAddress(draft.modality) ? draft.address.trim() : '',
  }
}

function isHttpUrl(text) {
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * { campo: mensaje } con lo que está mal; vacío si se puede guardar. Todos a
 * la vez y no el primero: el formulario los muestra al lado de cada campo.
 */
export function validateDraft(draft) {
  const errors = {}

  if (!draft.subjectId) errors.subjectId = 'Elegí la materia.'

  const largo = toMinutes(draft.end) - toMinutes(draft.start)
  const duracion = parseMinutes(draft.durationMinutes)
  if (Number.isNaN(duracion)) errors.durationMinutes = 'Escribí los minutos, por ejemplo 45.'
  else if (duracion < MIN_DURATION) {
    errors.durationMinutes = `Como mínimo ${MIN_DURATION} minutos.`
  } else if (duracion > largo) {
    errors.durationMinutes = `No entra en el horario, que dura ${formatMinutes(largo)}.`
  }

  const precio = parsePrice(draft.price)
  if (String(draft.price).trim() === '') errors.price = 'Poné el precio (0 si es sin cargo).'
  else if (Number.isNaN(precio) || precio > MAX_PRICE) {
    errors.price = 'Un monto en pesos, sin centavos.'
  }

  if (draft.group) {
    const cupo = Number(draft.groupSize)
    if (!Number.isInteger(cupo) || cupo < MIN_GROUP_SIZE || cupo > MAX_STUDENTS_LIMIT) {
      errors.groupSize = `Entre ${MIN_GROUP_SIZE} y ${MAX_STUDENTS_LIMIT} alumnos.`
    }
  }

  if (needsMeetingUrl(draft.modality)) {
    const link = draft.meetingUrl.trim()
    if (!link) errors.meetingUrl = 'Pegá el link de la videollamada.'
    else if (!isHttpUrl(link)) errors.meetingUrl = 'Tiene que ser un link (https://...).'
  }

  if (needsAddress(draft.modality) && !draft.locality.trim()) {
    errors.locality = 'Escribí la zona, por ejemplo Palermo, CABA.'
  }
  if (needsAddress(draft.modality) && !draft.address.trim()) {
    errors.address = 'Escribí la dirección exacta.'
  }

  return errors
}

/** El día de hoy como 'YYYY-MM-DD', para saber qué ya pasó. */
export function todayIso() {
  return toISODate(new Date())
}
