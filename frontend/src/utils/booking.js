// El puente entre los dos mundos de fechas de la app: la disponibilidad, que
// es una PLANTILLA SEMANAL ({ lunes: [{ start, end }] }, ver availability.js),
// y las clases, que son FECHAS CONCRETAS ('2026-09-14', ver calendar.js).
// Hasta ahora no se tocaban: nadie escribió nunca DAY_KEYS[mondayIndex(fecha)],
// aunque los dos índices arrancan en lunes y están alineados a propósito.
//
// Es el primer archivo de utils/ que importa de otro utils/, y va en un tercer
// archivo justamente por eso: calendar.js no tiene por qué saber qué es una
// materia, y availability.js no tiene por qué saber qué es una fecha. La
// dirección es siempre booking -> {calendar, availability} y nunca al revés,
// así que no hay ciclo posible.
//
// Todo el archivo trabaja en ÍNDICES DE MEDIA HORA (timeToSlotIndex) y no en
// minutos: el dominio entero está alineado a :00/:30 (ver CLAUDE.md) y un
// segundo parser de horas sería una segunda verdad.

import {
  DAY_KEYS,
  dayLabel,
  formatRangeLabel,
  slotIndexToTime,
  SLOTS_PER_CLASS,
  SLOTS_PER_DAY,
  timeToSlotIndex,
} from './availability.js'
import { addDays, fromISODate, mondayIndex, toISODate } from './calendar.js'

/** '2026-09-14' -> 'lunes'. El puente que faltaba. */
export function dayKeyFromIso(iso) {
  const date = fromISODate(iso)
  if (Number.isNaN(date.getTime())) return null
  return DAY_KEYS[mondayIndex(date)]
}

export function dayKeyFromDate(date) {
  return DAY_KEYS[mondayIndex(date)]
}

/** { start, end } -> { from, to } en índices de media hora. null si no sirve. */
function toSpan(range) {
  const from = timeToSlotIndex(range?.start)
  const to = timeToSlotIndex(range?.end)
  if (from < 0 || to < 0 || to <= from) return null
  return { from, to }
}

function toRange(span) {
  return { start: slotIndexToTime(span.from), end: slotIndexToTime(span.to) }
}

/**
 * ¿Se pisan aunque sea un minuto? Los extremos que se tocan NO se pisan: una
 * clase de 14:00 a 15:00 y otra de 15:00 a 16:00 conviven sin problema.
 */
export function rangesOverlap(a, b) {
  const spanA = toSpan(a)
  const spanB = toSpan(b)
  if (!spanA || !spanB) return false
  return spanA.from < spanB.to && spanB.from < spanA.to
}

/** El pedazo en común, o null si no se tocan. */
export function intersectRanges(a, b) {
  const spanA = toSpan(a)
  const spanB = toSpan(b)
  if (!spanA || !spanB) return null

  const from = Math.max(spanA.from, spanB.from)
  const to = Math.min(spanA.to, spanB.to)
  if (to <= from) return null

  return toRange({ from, to })
}

/**
 * Los pedazos de `ranges` que no toca ninguno de `busy`. Un hueco en el medio
 * parte un rango en dos; si lo tapan entero, desaparece.
 */
export function subtractRanges(ranges, busy) {
  const ocupados = busy.map(toSpan).filter(Boolean)

  let spans = ranges.map(toSpan).filter(Boolean)

  for (const ocupado of ocupados) {
    const siguiente = []
    for (const span of spans) {
      if (ocupado.to <= span.from || ocupado.from >= span.to) {
        siguiente.push(span)
        continue
      }
      if (span.from < ocupado.from) siguiente.push({ from: span.from, to: ocupado.from })
      if (ocupado.to < span.to) siguiente.push({ from: ocupado.to, to: span.to })
    }
    spans = siguiente
  }

  return spans.sort((a, b) => a.from - b.from).map(toRange)
}

/**
 * ¿Entra en este rango una clase de 1 h que ARRANQUE entre `fromTime` y
 * `toTime`? Cualquiera de los dos puede venir vacío (sin límite): esa es toda
 * la semántica de los dos selects — solo Desde es "arranca después", solo
 * Hasta es "arranca antes", y los dos juntos es "entre".
 */
export function rangeOffersStartBetween(range, fromTime, toTime) {
  const span = toSpan(range)
  if (!span) return false

  const desde = fromTime ? timeToSlotIndex(fromTime) : 0
  const hasta = toTime ? timeToSlotIndex(toTime) : SLOTS_PER_DAY
  if (desde < 0 || hasta < 0) return false

  // El último arranque posible deja lugar para la clase entera.
  const primero = Math.max(span.from, desde)
  const ultimo = Math.min(span.to - SLOTS_PER_CLASS, hasta)
  return primero <= ultimo
}

/** Los tramos donde entra al menos una clase. El resto no se puede reservar. */
export function bookableRanges(ranges) {
  return ranges.filter((range) => {
    const span = toSpan(range)
    return span ? span.to - span.from >= SLOTS_PER_CLASS : false
  })
}

/**
 * En qué medias horas puede ARRANCAR una clase adentro de estos tramos. Es lo
 * que hace falta para elegir la hora: la clase dura 1 h entera, así que el
 * último arranque de un tramo deja lugar para las dos medias horas.
 *
 * Devuelve índices, no horas: la línea de tiempo dibuja por índice.
 */
export function startOptions(ranges) {
  const starts = []

  for (const range of ranges) {
    const span = toSpan(range)
    if (!span) continue
    for (let index = span.from; index <= span.to - SLOTS_PER_CLASS; index++) {
      starts.push(index)
    }
  }

  return starts.sort((a, b) => a - b)
}

/** Cuántas medias horas suman estos rangos. */
export function countRangeSlots(ranges) {
  return ranges.reduce((total, range) => {
    const span = toSpan(range)
    return span ? total + (span.to - span.from) : total
  }, 0)
}

/**
 * Plantillas semanales -> filas con fecha. Una fila por (docente, día) con
 * TODOS los rangos de ese día, que es exactamente una tarjeta. La materia no
 * es parte del horario: la fila lleva las que da el docente y el alumno elige
 * una al reservar.
 *
 * Es el mismo cálculo que hace el backend (lib/availabilityExpansion.js); la
 * pantalla ya recibe las filas hechas y esto queda para los tests.
 *
 * entries: [{ teacherId, teacherName, subjects: [{ id, name }], schedule }]
 */
export function expandAvailability(entries, from, to) {
  const rows = []
  const desde = fromISODate(from)
  const hasta = fromISODate(to)

  for (let date = desde; date <= hasta; date = addDays(date, 1)) {
    const iso = toISODate(date)
    const dayKey = dayKeyFromDate(date)

    for (const entry of entries) {
      const ranges = entry.schedule?.[dayKey]
      if (!Array.isArray(ranges) || ranges.length === 0) continue

      rows.push({
        id: `${iso}|${entry.teacherId}`,
        date: iso,
        dayKey,
        teacherId: entry.teacherId,
        teacherName: entry.teacherName,
        subjects: entry.subjects || [],
        ranges: ranges.map((range) => ({ start: range.start, end: range.end })),
      })
    }
  }

  return rows
}

/**
 * Saca de cada fila lo que ya está reservado CON ESE DOCENTE ese día, sin
 * mirar la materia: nadie da dos clases a la vez. Una vez reservado, ese
 * horario deja de existir para todo el mundo (ver CLAUDE.md), así que se
 * resta de verdad y no se muestra como aviso.
 *
 * Las filas que quedan sin ningún rango desaparecen.
 */
export function subtractBookedLessons(rows, lessons) {
  return rows
    .map((row) => {
      const ocupados = lessons.filter(
        (lesson) => lesson.teacherId === row.teacherId && lesson.date === row.date,
      )
      if (ocupados.length === 0) return row

      const ranges = subtractRanges(
        row.ranges,
        ocupados.map((lesson) => ({ start: lesson.startTime, end: lesson.endTime })),
      )
      return { ...row, ranges }
    })
    .filter((row) => row.ranges.length > 0)
}

/**
 * Agrega a cada fila las clases PROPIAS que se le pisan y qué queda realmente
 * reservable. Estas no se restan: el horario del docente sigue existiendo, lo
 * que pasa es que este alumno no lo puede tomar.
 *
 * Ojo: un choque nunca puede nombrar una clase con EL MISMO docente de la
 * tarjeta, porque esa ya la sacó subtractBookedLessons.
 */
export function annotateClashes(rows, myLessons) {
  return rows.map((row) => {
    const delDia = myLessons.filter((lesson) => lesson.date === row.date)

    const clashes = delDia.filter((lesson) =>
      row.ranges.some((range) =>
        rangesOverlap(range, { start: lesson.startTime, end: lesson.endTime }),
      ),
    )

    const free = subtractRanges(
      row.ranges,
      delDia.map((lesson) => ({ start: lesson.startTime, end: lesson.endTime })),
    )
    const libres = bookableRanges(free)

    return {
      ...row,
      totalSlots: countRangeSlots(row.ranges),
      clashes: clashes.map((lesson) => ({
        id: lesson.id,
        subjectName: lesson.subjectName,
        teacherName: lesson.teacherName,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
      })),
      free: libres,
      bookable: libres.length > 0,
    }
  })
}

/** { [iso]: Card[] }, cada lista ordenada por hora y docente. */
export function groupCardsByDate(cards) {
  const porFecha = {}

  for (const card of cards) {
    if (!porFecha[card.date]) porFecha[card.date] = []
    porFecha[card.date].push(card)
  }

  for (const iso of Object.keys(porFecha)) {
    porFecha[iso].sort((a, b) => {
      const inicio = (a.ranges[0]?.start || '').localeCompare(b.ranges[0]?.start || '')
      if (inicio !== 0) return inicio
      return a.teacherName.localeCompare(b.teacherName)
    })
  }

  return porFecha
}

/**
 * ¿La tarjeta es de un docente que da alguna de estas materias? El id se
 * compara como string: puede venir de la URL, y ahí siempre es string aunque
 * el de la tarjeta no lo sea.
 */
function teachesAny(card, subjectIds) {
  return (card.subjects || []).some((subject) =>
    subjectIds.some((id) => String(id) === String(subject.id)),
  )
}

/**
 * Qué materia llega ya elegida al modal de reserva, o null si el alumno la
 * tiene que elegir. Solo se elige sola cuando no hay duda: el docente da una
 * sola, o de las que da hay una sola entre las que el alumno filtró. Elegir
 * "la primera" sería reservar algo que el alumno no pidió.
 */
export function preselectedSubjectId(card, filterSubjectIds = []) {
  const subjects = card.subjects || []
  if (subjects.length === 1) return subjects[0].id
  if (filterSubjectIds.length === 0) return null

  const filtradas = subjects.filter((subject) =>
    filterSubjectIds.some((id) => String(id) === String(subject.id)),
  )
  return filtradas.length === 1 ? filtradas[0].id : null
}

/** Minúsculas y sin acentos, para comparar lo tipeado contra nombres con tilde. */
export function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Aplica los filtros. Los cuatro se combinan con Y: una lista vacía o un
 * string vacío significa "no filtra".
 *
 * OJO: el filtro de horas elige qué TARJETAS entran, pero NO recorta los
 * rangos que se muestran. Una tarjeta que dice "13:00 – 15:30" filtrando
 * "Desde 14:00" está diciendo la verdad sobre el docente; recortarla sería
 * inventar una disponibilidad más chica de la que hay.
 */
export function filterCards(cards, filters = {}) {
  const { dayKeys = [], subjectIds = [], fromTime = '', toTime = '', teacherQuery = '' } = filters
  const docente = normalizeText(teacherQuery)

  return cards.filter((card) => {
    if (dayKeys.length > 0 && !dayKeys.includes(card.dayKey)) return false
    // La tarjeta es de un docente, no de una materia: entra si da alguna de
    // las elegidas.
    if (subjectIds.length > 0 && !teachesAny(card, subjectIds)) return false
    if (docente && !normalizeText(card.teacherName).includes(docente)) return false

    if (fromTime || toTime) {
      const entra = card.ranges.some((range) => rangeOffersStartBetween(range, fromTime, toTime))
      if (!entra) return false
    }

    return true
  })
}

/**
 * Qué significa el `q` de la URL: si pega con una materia es un filtro de
 * materia (como si se hubiera tocado el chip), y si no es un pedazo de nombre
 * de docente. Nunca las dos cosas a la vez.
 *
 * startsWith y no includes: así "mate" encuentra Matemática pero "gómez" no
 * pega de casualidad con ninguna materia.
 */
export function resolveQuery(q, subjects) {
  const texto = normalizeText(q)
  if (!texto) return { subjectId: null, teacherQuery: '' }

  const materia = subjects.find((subject) => normalizeText(subject.name).startsWith(texto))
  if (materia) return { subjectId: materia.id, teacherQuery: '' }

  return { subjectId: null, teacherQuery: q.trim() }
}

// Cuántos choques se nombran antes de cortar, igual que describeShortRuns.
const MAX_CLASHES_LISTED = 2

function joinWithY(items) {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/** 'Se superpone con Matemática con Laura Gómez (14:00 – 15:00).' */
export function formatClashes(clashes, bookable = true) {
  if (clashes.length === 0) return null

  const listados = clashes
    .slice(0, MAX_CLASHES_LISTED)
    .map((clash) => `${clash.subjectName} con ${clash.teacherName}`)

  const resto = clashes.length - listados.length
  if (resto > 0) listados.push(`${resto} ${resto === 1 ? 'clase más' : 'clases más'}`)

  const detalle =
    clashes.length === 1
      ? ` (${formatRangeLabel(clashes[0].startTime, clashes[0].endTime)})`
      : ''

  // Se arma por partes y NO con toLowerCase sobre la frase entera: eso le
  // comía las mayúsculas a los nombres propios ("base de datos con martín
  // sosa").
  const detalleCompleto = `se superpone con ${joinWithY(listados)}${detalle}`
  return bookable
    ? `Se superpone con ${joinWithY(listados)}${detalle}.`
    : `No te queda una hora libre: ${detalleCompleto}.`
}

/** '3 libres' / '1 libre'. */
export function formatFreeCount(count) {
  return `${count} ${count === 1 ? 'libre' : 'libres'}`
}

/** 'Lunes' para el chip del filtro de días. */
export function dayChipLabel(dayKey) {
  return dayLabel(dayKey)
}
