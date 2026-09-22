// Conversión entre las dos formas de la disponibilidad semanal: adentro del
// scheduler es un Set de ids de media hora ('lunes-1330'), y para afuera —el
// backend, la base— son rangos colapsados por día ({ lunes: [{ start:
// '01:00', end: '18:00' }] }). Son las dos direcciones de la misma cosa y no
// dependen de React, así que van como funciones sueltas (igual que
// calendar.js, de donde sale isValidSlotStart).
//
// Tres convenciones que valen para todo el archivo:
//
//   - Un slot es media hora. El día tiene 48, indexados 0 ('00:00') a 47
//     ('23:30'). Las clases duran 1 h, o sea 2 slots (ver CLAUDE.md).
//
//   - Las claves de día van SIN acento y en ASCII ('miercoles', 'sabado').
//     No son texto de pantalla: son clave de JSON, prefijo del id de slot,
//     `key` de React, atributo data-day y, en algún momento, valor en la
//     base. 'miércoles' puede llegar en NFC o en NFD —se ven idénticos pero
//     === dice que no— y este equipo ya tuvo problemas de texto entre Mac y
//     Windows (ver CLAUDE.md y el .gitattributes). Para mostrar están
//     DAY_LABELS acá y WEEKDAY_LABELS en calendar.js.
//
//   - `end` es exclusivo como hora de reloj: los slots 2 y 3 (01:00 y 01:30)
//     se escriben { start: '01:00', end: '02:00' }. Un rango que llega hasta
//     las 23:30 termina en '24:00' y no en '00:00', porque si no se rompe
//     start < end para cualquiera que ordene o valide (incluida la base).

export const DAY_KEYS = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
]

export const DAY_LABELS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
]

export const SLOT_MINUTES = 30
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES

// 'lunes' -> 'Lunes'. Un objeto y no un indexOf adentro de un loop de 336
// celdas.
const LABEL_BY_KEY = DAY_KEYS.reduce((acc, key, index) => {
  acc[key] = DAY_LABELS[index]
  return acc
}, {})

export function dayLabel(dayKey) {
  return LABEL_BY_KEY[dayKey] || dayKey
}

/** 0 -> '00:00', 27 -> '13:30', 47 -> '23:30', 48 -> '24:00' (fin del día). */
export function slotIndexToTime(index) {
  const hours = Math.floor(index / 2)
  const minutes = index % 2 === 0 ? '00' : '30'
  return `${String(hours).padStart(2, '0')}:${minutes}`
}

/**
 * Inversa de slotIndexToTime. Acepta también '24:00' -> 48, que es el fin
 * exclusivo de un rango que llega hasta las 23:30. Devuelve -1 si no es una
 * hora válida: isValidSlotStart (calendar.js) solo cubre 00:00–23:30, que es
 * lo correcto para un INICIO pero deja afuera ese fin.
 */
export function timeToSlotIndex(time) {
  if (typeof time !== 'string') return -1
  if (time === '24:00') return SLOTS_PER_DAY

  const match = /^([01]\d|2[0-3]):(00|30)$/.exec(time)
  if (!match) return -1

  return Number(match[1]) * 2 + (match[2] === '30' ? 1 : 0)
}

export function slotId(dayKey, time) {
  return `${dayKey}-${time.replace(':', '')}`
}

export function slotIdAt(dayKey, index) {
  return slotId(dayKey, slotIndexToTime(index))
}

/** 'lunes-1330' -> { dayKey, time, index }. null si no es un id válido. */
export function parseSlotId(id) {
  if (typeof id !== 'string') return null

  const match = /^([a-z]+)-([01]\d|2[0-3])(00|30)$/.exec(id)
  if (!match) return null
  if (!DAY_KEYS.includes(match[1])) return null

  const time = `${match[2]}:${match[3]}`
  return { dayKey: match[1], time, index: timeToSlotIndex(time) }
}

/** Todos los ids entre dos índices, inclusive y sin importar el orden. */
export function slotIdsBetween(dayKey, a, b) {
  const from = Math.min(a, b)
  const to = Math.max(a, b)
  const ids = []
  for (let index = from; index <= to; index++) {
    ids.push(slotIdAt(dayKey, index))
  }
  return ids
}

/** Las horas visibles de la grilla. Si vienen mal, el día entero. */
export function hourRangeToIndexes(startHour, endHour) {
  const from = Number.isInteger(startHour) ? startHour * 2 : 0
  const to = Number.isInteger(endHour) ? endHour * 2 : SLOTS_PER_DAY

  if (from < 0 || to > SLOTS_PER_DAY || to <= from) {
    return { fromIndex: 0, toIndex: SLOTS_PER_DAY }
  }
  return { fromIndex: from, toIndex: to }
}

/**
 * Rangos -> Set de ids. Es lo que corre al entrar a la pantalla con un
 * horario ya guardado. Defensiva a propósito: días que no conoce y horas
 * inválidas se ignoran en vez de explotar, porque esto va a comer lo que
 * mande el backend.
 */
export function rangesToSlotIds(schedule) {
  const ids = new Set()
  if (!schedule) return ids

  for (const dayKey of DAY_KEYS) {
    const ranges = schedule[dayKey]
    if (!Array.isArray(ranges)) continue

    for (const range of ranges) {
      const from = timeToSlotIndex(range?.start)
      const to = timeToSlotIndex(range?.end)
      if (from < 0 || to < 0 || to <= from) continue

      for (let index = from; index < to; index++) {
        ids.add(slotIdAt(dayKey, index))
      }
    }
  }

  return ids
}

/**
 * Set de ids -> rangos colapsados, que es lo que se manda a guardar. Los días
 * salen en el orden de DAY_KEYS (no en el del Set) y los que no tienen nada
 * NO aparecen: el objeto se lee como "estos son los días que doy".
 */
export function slotIdsToRanges(slotIds) {
  const porDia = new Map()

  for (const id of slotIds) {
    const parsed = parseSlotId(id)
    if (!parsed) continue
    if (!porDia.has(parsed.dayKey)) porDia.set(parsed.dayKey, [])
    porDia.get(parsed.dayKey).push(parsed.index)
  }

  const schedule = {}

  for (const dayKey of DAY_KEYS) {
    const indices = porDia.get(dayKey)
    if (!indices || indices.length === 0) continue

    indices.sort((a, b) => a - b)

    const ranges = []
    let from = indices[0]
    let prev = indices[0]

    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === prev + 1) {
        prev = indices[i]
        continue
      }
      // Se cortó la racha: cerramos el rango y arrancamos otro.
      ranges.push({ start: slotIndexToTime(from), end: slotIndexToTime(prev + 1) })
      from = indices[i]
      prev = indices[i]
    }
    ranges.push({ start: slotIndexToTime(from), end: slotIndexToTime(prev + 1) })

    schedule[dayKey] = ranges
  }

  return schedule
}

/**
 * Cuántos slots dura una clase. Las clases duran 1 h (ver CLAUDE.md) y un slot
 * es media hora, así que son dos. Un tramo de 1 h 30 vale —entran una clase y
 * queda media hora suelta que el docente sabrá si usa—; lo que no vale es un
 * tramo que no llegue ni a una clase.
 */
export const SLOTS_PER_CLASS = 60 / SLOT_MINUTES

/**
 * Los tramos contiguos que no llegan a durar una clase. Sale de
 * slotIdsToRanges a propósito y no de un recorrido propio: los tramos que se
 * validan tienen que ser LOS MISMOS que se guardan, y si algún día cambia cómo
 * se colapsan, esto cambia solo.
 *
 * Devuelve [] cuando está todo bien, y si no una entrada por tramo, en el orden
 * de DAY_KEYS y por hora adentro de cada día — que es el orden en el que se van
 * a nombrar en el cartel.
 */
export function findShortRuns(slotIds) {
  const schedule = slotIdsToRanges(slotIds)
  const cortos = []

  for (const dayKey of DAY_KEYS) {
    for (const range of schedule[dayKey] || []) {
      const slots = timeToSlotIndex(range.end) - timeToSlotIndex(range.start)
      if (slots >= SLOTS_PER_CLASS) continue
      cortos.push({ dayKey, start: range.start, end: range.end })
    }
  }

  return cortos
}

/**
 * Los ids de media hora que caen adentro de esos tramos, para poder pintarlos.
 * Un tramo tiene la misma forma que un rango, así que esto es rangesToSlotIds
 * con los tramos reagrupados por día.
 */
export function runsToSlotIds(runs) {
  const schedule = {}
  for (const run of runs) {
    if (!schedule[run.dayKey]) schedule[run.dayKey] = []
    schedule[run.dayKey].push({ start: run.start, end: run.end })
  }
  return rangesToSlotIds(schedule)
}

// Cuántos tramos se nombran antes de cortar. Tres entran en el renglón del
// cartel; con siete días pintados mal, la lista completa no se lee.
const MAX_SHORT_RUNS_LISTED = 3

/** 'A', 'A y B', 'A, B y C'. La conjunción va sin coma antes. */
function joinWithY(items) {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/**
 * 'Martes 05:30 – 06:00 y Jueves 12:00 – 12:30 duran media hora'.
 *
 * Dice 'media hora' y no 'menos de una hora' porque con clases de 1 h el único
 * tramo corto posible es de un slot. Si algún día la clase dura otra cosa, esta
 * frase hay que reescribirla — la lógica de arriba se adapta sola con
 * SLOTS_PER_CLASS, el texto no.
 */
function describeShortRuns(runs) {
  const listados = runs
    .slice(0, MAX_SHORT_RUNS_LISTED)
    .map((run) => `${dayLabel(run.dayKey)} ${formatRangeLabel(run.start, run.end)}`)

  const resto = runs.length - listados.length
  if (resto > 0) listados.push(`${resto} ${resto === 1 ? 'horario' : 'horarios'} más`)

  return `${joinWithY(listados)} ${runs.length === 1 ? 'dura' : 'duran'} media hora`
}

/** El cartel de error. null si no hay nada que avisar. */
export function formatShortRunsError(runs) {
  if (runs.length === 0) return null
  return `No se puede guardar: ${describeShortRuns(runs)}, y las clases duran 1 hora.`
}

/** Lo mismo para el renglón de estado, sin el prefijo de error. */
export function formatShortRunsStatus(runs) {
  if (runs.length === 0) return ''
  return `${describeShortRuns(runs)}.`
}

/** '14:00 – 15:00'. Raya (–), no guion, y 24 h como el resto de la app. */
export function formatRangeLabel(start, end) {
  return `${start} – ${end}`
}

/** Cuántas horas suman N medias horas. Mismo vocabulario que formatDuration. */
export function formatSlotTotal(count) {
  const total = count * SLOT_MINUTES
  const hours = Math.floor(total / 60)
  const minutes = total % 60

  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

export function countSlots(slotIds, dayKey) {
  if (!dayKey) return slotIds.size

  let count = 0
  for (const id of slotIds) {
    if (id.startsWith(`${dayKey}-`)) count++
  }
  return count
}

/** ¿Son el mismo conjunto? Para saber si hay cambios sin guardar. */
export function sameSlots(a, b) {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

/** Unión de varios horarios en un solo Set (los horarios que bloquean). */
export function mergeSchedules(schedules) {
  const ids = new Set()
  for (const schedule of schedules) {
    for (const id of rangesToSlotIds(schedule)) {
      ids.add(id)
    }
  }
  return ids
}

/**
 * Copia los horarios de un día a otros. REEMPLAZA lo que haya en el destino,
 * no lo suma: es lo que la gente quiere decir con "copiar", y sumar dejaría
 * horarios que nadie pidió. Los slots que el destino tiene ocupados por otra
 * materia no se pueden copiar, así que se saltean y se cuentan en `skipped`
 * para que la pantalla pueda explicar por qué no quedó igual.
 */
export function copyDayTo(slotIds, fromDay, toDays, blockedBySlot = {}) {
  const next = new Set()
  // El día de origen nunca es destino: si se colara, el primer loop le
  // borraría los slots (por ser destino) y el segundo no se los devolvería
  // (por ser el origen), o sea que copiar un día sobre sí mismo lo vaciaría.
  const targets = new Set([...toDays].filter((dayKey) => dayKey !== fromDay))

  // Arrancamos con todo lo que NO es de los días destino.
  for (const id of slotIds) {
    const parsed = parseSlotId(id)
    if (!parsed || !targets.has(parsed.dayKey)) next.add(id)
  }

  const sourceIndexes = []
  for (const id of slotIds) {
    const parsed = parseSlotId(id)
    if (parsed && parsed.dayKey === fromDay) sourceIndexes.push(parsed.index)
  }

  let skipped = 0
  for (const dayKey of targets) {
    if (dayKey === fromDay) continue
    for (const index of sourceIndexes) {
      const id = slotIdAt(dayKey, index)
      if (blockedBySlot[id]) {
        skipped++
        continue
      }
      next.add(id)
    }
  }

  return { slotIds: next, skipped }
}

/**
 * El modelo de render de una columna. Devuelve una entrada por celda visible
 * (la capa de INTERACCIÓN: los botones de media hora) y aparte los bloques ya
 * fusionados (la capa de PRESENTACIÓN: un rectángulo con la etiqueta
 * '14:00 – 15:00' por cada tramo contiguo).
 *
 * Las dos capas salen del mismo recorrido para que no se puedan
 * desincronizar, y se dibujan sobre la MISMA grilla CSS: los botones ocupan
 * una fila cada uno y los bloques van con grid-row: span N por encima, con
 * pointer-events: none. Un elemento que abarca varias filas tapa también los
 * gaps de 1px que hay entre ellas, así que el bloque borra sus propias líneas
 * internas y se ve entero, sin perder la granularidad de media hora.
 *
 * Dos celdas ocupadas seguidas solo se fusionan si las ocupa la MISMA
 * materia: si no, el bloque diría el nombre de una sola y mentiría.
 */
export function buildDayColumn({
  dayKey,
  fromIndex,
  toIndex,
  selectedIds,
  savedIds = new Set(),
  blockedBySlot = {},
  invalidIds = new Set(),
}) {
  const cells = []
  const blocks = []

  let open = null

  const closeBlock = (endIndex) => {
    if (!open) return
    blocks.push({
      key: `${dayKey}-${open.from}`,
      from: open.from,
      span: endIndex - open.from,
      start: slotIndexToTime(open.from),
      end: slotIndexToTime(endIndex),
      label: formatRangeLabel(slotIndexToTime(open.from), slotIndexToTime(endIndex)),
      state: open.state,
      blockedBy: open.blockedBy,
      pending: open.pending,
      invalid: open.invalid,
    })
    open = null
  }

  for (let index = fromIndex; index < toIndex; index++) {
    const id = slotIdAt(dayKey, index)
    const blockedBy = blockedBySlot[id] || null
    const selected = selectedIds.has(id)
    // Cuatro estados y no dos: además de lo que está pintado, hay que mostrar
    // lo que se va a BORRAR — un horario que estaba guardado y el docente
    // despintó. Si solo desapareciera, no habría forma de ver esa mitad de lo
    // que está por guardarse.
    let state = 'free'
    if (blockedBy) state = 'blocked'
    else if (selected) state = 'selected'
    else if (savedIds.has(id)) state = 'removed'
    // Pintado pero todavía sin guardar. Volver a pintar un horario que ya
    // estaba guardado lo deja en false, o sea que vuelve a verse como guardado
    // — que es exactamente lo que va a pasar al guardar.
    const pending = state === 'selected' && !savedIds.has(id)
    // Que un tramo sea inválido es propiedad del TRAMO ENTERO, no de la celda,
    // así que viene calculado de afuera (findShortRuns sobre todos los slots).
    // Si se dedujera acá del span, un tramo legal cortado por startHour/endHour
    // se marcaría mal: con startHour 9, un 08:30–09:30 se ve como media hora y
    // no lo es.
    const invalid = state === 'selected' && invalidIds.has(id)

    cells.push({
      id,
      index,
      time: slotIndexToTime(index),
      state,
      blockedBy,
      pending,
      invalid,
      // La media hora se pinta apenas distinta para que el par :00/:30 se lea
      // como una hora sin dibujar dos tipos de línea.
      isHalf: index % 2 === 1,
    })

    if (state === 'free') {
      closeBlock(index)
      continue
    }


    // Un bloque se corta si cambia el estado, la materia que lo ocupa, o si el
    // tramo pasa a ser inválido. Lo último no puede pasar hoy (dos celdas
    // pegadas son el mismo tramo y comparten el veredicto) pero mantiene la
    // regla "un bloque, un mensaje" si mañana se agrega otra validación.
    // Un bloque se corta si cambia cualquiera de las cosas que se dibujan: el
    // estado, la materia que lo ocupa, si está sin guardar o si es inválido.
    // Así extender un horario guardado da dos bloques (el azul de lo que ya
    // estaba y el verde de lo nuevo) en vez de uno solo que mienta.
    const cambio =
      open &&
      (open.state !== state ||
        open.blockedBy !== blockedBy ||
        open.pending !== pending ||
        open.invalid !== invalid)
    if (cambio) closeBlock(index)
    if (!open) {
      open = { from: index, state, blockedBy, pending, invalid }
    }
  }

  closeBlock(toIndex)

  return { cells, blocks }
}
