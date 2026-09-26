// Lo que hace la pantalla del alumno con las filas que manda el backend. Cada
// fila es UNA ventana de un docente en UNA fecha (ver
// lib/availabilityExpansion.js en el backend): modalidad, cupo, las materias
// que se pueden reservar con su tarifa (`subjects`), los tramos libres
// (`free`) y las grupales a las que sumarse (`groups`). Lo que ya está
// reservado con ese docente ya viene restado; acá solo se cruza con las
// clases PROPIAS del alumno y se filtra.
//
// No hay turnos cerrados: la duración la elige el alumno. De cada tramo libre
// salen inicios en :00/:30, cada uno con la clase más larga que entra.
//
// Es el primer archivo de utils/ que importa de otro utils/: la dirección es
// siempre booking -> {calendar, availability} y nunca al revés, así que no
// hay ciclo posible. (windows.js importa de acá, y acá no se importa de
// windows.js por lo mismo.)

import { DAY_KEYS, dayLabel, formatRangeLabel } from './availability.js'
import { fromISODate, mondayIndex } from './calendar.js'
import { CLASS_MINUTES_STEP, MIN_CLASS_MINUTES } from './rates.js'

// Los inicios van de a media hora, igual que en el backend.
const START_STEP = 30

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
export function toMinutes(time) {
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

function toTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * ¿Esta clase propia ES esta grupal? Pasa cuando el alumno ya se anotó y la
 * grupal sigue ofreciéndose porque queda lugar para otros.
 */
function isSameClass(lesson, card, group) {
  return String(lesson.teacherId) === String(card.teacherId) && lesson.startTime === group.start
}

/**
 * Los inicios que salen de los tramos libres, cada uno con la clase más larga
 * que entra (`maxMinutes`, de a 5): hasta el fin del tramo o hasta la
 * próxima clase propia, lo que llegue primero. `blocked` si ni la clase más
 * corta entra sin pisarse con una clase propia.
 *
 * `busy` son las clases propias del día, { start, end }. Sin ellas (sin
 * usuario) son todos los inicios del tramo.
 */
export function startOptions(free, busy = []) {
  const ocupado = busy.map(toSpan).filter(Boolean)
  const opciones = []

  for (const tramo of free || []) {
    const span = toSpan(tramo)
    if (!span) continue

    for (let inicio = span.from; inicio + MIN_CLASS_MINUTES <= span.to; inicio += START_STEP) {
      let limite = span.to
      let blocked = false
      for (const clase of ocupado) {
        if (clase.from < inicio + MIN_CLASS_MINUTES && inicio < clase.to) blocked = true
        else if (clase.from >= inicio + MIN_CLASS_MINUTES) limite = Math.min(limite, clase.from)
      }
      const maxMinutes = Math.floor((limite - inicio) / CLASS_MINUTES_STEP) * CLASS_MINUTES_STEP
      opciones.push({ start: toTime(inicio), maxMinutes, blocked })
    }
  }

  return opciones
}

/**
 * Cruza cada fila con las clases que el alumno ya tiene ese día. No se resta
 * nada: el rato del docente sigue existiendo, lo que pasa es que este alumno
 * no lo puede tomar. Queda:
 *   - `groups`, cada una con `joined` (ya está anotado) y `blocked` (se le
 *     pisa con otra clase suya, o es la misma);
 *   - `starts`: los inicios posibles (ver startOptions), ya recortados por
 *     las clases propias;
 *   - `clashes`: las clases propias que se pisan con la ventana, sin contar
 *     aquellas en las que ya está anotado ahí mismo (esas se avisan aparte).
 */
export function annotateClashes(cards, myLessons) {
  return cards.map((card) => {
    const delDia = myLessons.filter((lesson) => lesson.date === card.date)

    const groups = (card.groups || []).map((group) => {
      const joined = delDia.some((lesson) => isSameClass(lesson, card, group))
      const blocked = joined || delDia.some((lesson) => rangesOverlap(group, lessonRange(lesson)))
      return { ...group, joined, blocked }
    })

    const starts = startOptions(card.free, delDia.map(lessonRange))

    const window = { start: card.start, end: card.end }
    const clashes = delDia
      .filter((lesson) => rangesOverlap(window, lessonRange(lesson)))
      .filter((lesson) => !groups.some((group) => group.joined && isSameClass(lesson, card, group)))
      .map((lesson) => ({
        id: lesson.id,
        subjectName: lesson.subjectName,
        teacherName: lesson.teacherName,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
      }))

    return {
      ...card,
      groups,
      starts,
      clashes,
      joined: groups.filter((group) => group.joined),
      bookable:
        groups.some((group) => !group.blocked) || starts.some((option) => !option.blocked),
    }
  })
}

/** La tarifa más baja de la ventana, para el "desde $ X/h" de la tarjeta. */
export function lowestRate(card) {
  const tarifas = (card.subjects || []).map((subject) => subject.hourlyRateCents)
  return tarifas.length > 0 ? Math.min(...tarifas) : null
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
 * ¿Alguna clase puede ARRANCAR entre `fromTime` y `toTime`? Cualquiera de
 * los dos puede venir vacío (sin límite). Cuenta sumarse a una grupal y
 * cualquier inicio de un tramo libre.
 */
export function offersStartBetween(card, fromTime, toTime) {
  const desde = fromTime ? toMinutes(fromTime) : 0
  const hasta = toTime ? toMinutes(toTime) : Infinity
  const inicios = [
    ...(card.groups || []).map((group) => group.start),
    ...(card.starts || startOptions(card.free)).map((option) => option.start),
  ]
  return inicios.some((start) => {
    const inicio = toMinutes(start)
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
 * El filtro de materia deja pasar la ventana si el docente da ALGUNA de las
 * elegidas en esa modalidad: la materia se elige recién al reservar.
 *
 * OJO: el filtro de horas elige qué TARJETAS entran, pero NO esconde horarios.
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
    if (
      subjectIds.length > 0 &&
      !(card.subjects || []).some((subject) =>
        subjectIds.some((id) => String(id) === String(subject.id)),
      )
    ) {
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

  // El nombre exacto gana: el buscador predictivo manda el nombre completo de
  // la materia elegida, y "Física" no puede terminar en "Física II" solo
  // porque esa vino primero en el catálogo.
  const materia =
    subjects.find((subject) => normalizeText(subject.name) === texto) ||
    subjects.find((subject) => normalizeText(subject.name).startsWith(texto))
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

/** '2 de 5 anotados'. */
export function formatEnrolled(enrolled, maxStudents) {
  return `${enrolled} de ${maxStudents} ${maxStudents === 1 ? 'anotado' : 'anotados'}`
}

/** 'Lunes' para el chip del filtro de días. */
export function dayChipLabel(dayKey) {
  return dayLabel(dayKey)
}
