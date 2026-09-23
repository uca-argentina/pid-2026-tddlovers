// Lo que hace la pantalla del alumno con las filas que manda el backend. Cada
// fila es UNA ventana de un docente en UNA fecha (ver
// lib/availabilityExpansion.js en el backend): materia, modalidad, cupo y los
// turnos que quedan en `slots`. Lo que ya está reservado con ese docente ya
// viene restado; acá solo se cruza con las clases PROPIAS del alumno y se
// filtra.
//
// Es el primer archivo de utils/ que importa de otro utils/: la dirección es
// siempre booking -> {calendar, availability} y nunca al revés, así que no
// hay ciclo posible. (windows.js importa de acá, y acá no se importa de
// windows.js por lo mismo.)

import { DAY_KEYS, dayLabel, formatRangeLabel } from './availability.js'
import { fromISODate, mondayIndex } from './calendar.js'

/** '2026-09-14' -> 'lunes'. */
export function dayKeyFromIso(iso) {
  const date = fromISODate(iso)
  if (Number.isNaN(date.getTime())) return null
  return DAY_KEYS[mondayIndex(date)]
}

export function dayKeyFromDate(date) {
  return DAY_KEYS[mondayIndex(date)]
}

/** 'HH:MM' -> minutos desde medianoche ('24:00' -> 1440), o -1 si no es hora. */
function toMinutes(time) {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(time ?? '')
  if (!match) return -1
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * { start, end } -> { from, to } en MINUTOS, no en medias horas: la duración
 * de las clases es libre, así que una puede terminar 13:45. null si no sirve.
 */
function toSpan(range) {
  const from = toMinutes(range?.start)
  const to = toMinutes(range?.end)
  if (from < 0 || to < 0 || to <= from) return null
  return { from, to }
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

function lessonRange(lesson) {
  return { start: lesson.startTime, end: lesson.endTime }
}

/**
 * ¿Esta clase propia ES este turno? Pasa con una grupal: el alumno ya se
 * anotó y el turno sigue ofreciéndose porque queda lugar para otros.
 */
function isSameClass(lesson, card, slot) {
  return String(lesson.teacherId) === String(card.teacherId) && lesson.startTime === slot.start
}

/**
 * Cruza cada fila con las clases que el alumno ya tiene ese día. No se resta
 * nada: el turno del docente sigue existiendo, lo que pasa es que este alumno
 * no lo puede tomar. Cada turno queda marcado:
 *   - `joined`: ya está anotado en esa grupal;
 *   - `blocked`: se le pisa con otra clase suya (o es la misma).
 *
 * `clashes` son las clases propias que se pisan con la ventana, sin contar
 * aquellas en las que ya está anotado ahí mismo (esas se avisan aparte).
 */
export function annotateClashes(cards, myLessons) {
  return cards.map((card) => {
    const delDia = myLessons.filter((lesson) => lesson.date === card.date)

    const slots = card.slots.map((slot) => {
      const joined = delDia.some((lesson) => isSameClass(lesson, card, slot))
      const blocked = joined || delDia.some((lesson) => rangesOverlap(slot, lessonRange(lesson)))
      return { ...slot, joined, blocked }
    })

    const window = { start: card.start, end: card.end }
    const clashes = delDia
      .filter((lesson) => rangesOverlap(window, lessonRange(lesson)))
      .filter((lesson) => !slots.some((slot) => slot.joined && isSameClass(lesson, card, slot)))
      .map((lesson) => ({
        id: lesson.id,
        subjectName: lesson.subjectName,
        teacherName: lesson.teacherName,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
      }))

    return {
      ...card,
      slots,
      clashes,
      joined: slots.filter((slot) => slot.joined),
      bookable: slots.some((slot) => !slot.blocked),
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
      const inicio = a.start.localeCompare(b.start)
      if (inicio !== 0) return inicio
      return a.teacherName.localeCompare(b.teacherName)
    })
  }

  return porFecha
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
 * ¿Algún turno ARRANCA entre `fromTime` y `toTime`? Cualquiera de los dos
 * puede venir vacío (sin límite).
 */
export function offersStartBetween(card, fromTime, toTime) {
  const desde = fromTime ? toMinutes(fromTime) : 0
  const hasta = toTime ? toMinutes(toTime) : Infinity
  return card.slots.some((slot) => {
    const inicio = toMinutes(slot.start)
    return inicio >= desde && inicio <= hasta
  })
}

/** 'individual' o 'group': el tipo de clase para el filtro. */
export function cardKind(card) {
  return card.maxStudents > 1 ? 'group' : 'individual'
}

/**
 * Aplica los filtros. Se combinan con Y: una lista vacía o un string vacío
 * significa "no filtra". Dentro de un mismo grupo de chips es O (Virtual o
 * Presencial).
 *
 * OJO: el filtro de horas elige qué TARJETAS entran, pero NO esconde turnos.
 * La tarjeta dice la verdad sobre la ventana del docente; recortarla sería
 * inventar una disponibilidad más chica de la que hay.
 */
export function filterCards(cards, filters = {}) {
  const {
    dayKeys = [],
    subjectIds = [],
    modalities = [],
    kinds = [],
    fromTime = '',
    toTime = '',
    teacherQuery = '',
  } = filters
  const docente = normalizeText(teacherQuery)

  return cards.filter((card) => {
    if (dayKeys.length > 0 && !dayKeys.includes(card.dayKey)) return false
    // El id se compara como string: puede venir de la URL.
    if (subjectIds.length > 0 && !subjectIds.some((id) => String(id) === String(card.subject.id))) {
      return false
    }
    if (modalities.length > 0 && !modalities.includes(card.modality)) return false
    if (kinds.length > 0 && !kinds.includes(cardKind(card))) return false
    if (docente && !normalizeText(card.teacherName).includes(docente)) return false
    if ((fromTime || toTime) && !offersStartBetween(card, fromTime, toTime)) return false
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

// Cuántos choques se nombran antes de cortar.
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
  // comía las mayúsculas a los nombres propios.
  return bookable
    ? `Se superpone con ${joinWithY(listados)}${detalle}.`
    : `No te queda ningún horario libre: se superpone con ${joinWithY(listados)}${detalle}.`
}

/** '3 horarios' / '1 horario'. */
export function formatSlotCount(count) {
  return `${count} ${count === 1 ? 'horario' : 'horarios'}`
}

/** '2 de 5 anotados'. */
export function formatEnrolled(enrolled, maxStudents) {
  return `${enrolled} de ${maxStudents} ${maxStudents === 1 ? 'anotado' : 'anotados'}`
}

/** 'Lunes' para el chip del filtro de días. */
export function dayChipLabel(dayKey) {
  return dayLabel(dayKey)
}
