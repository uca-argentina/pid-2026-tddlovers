import {
  annotateClashes,
  bookableRanges,
  countRangeSlots,
  dayKeyFromDate,
  dayKeyFromIso,
  expandAvailability,
  filterCards,
  formatClashes,
  formatFreeCount,
  groupCardsByDate,
  intersectRanges,
  normalizeText,
  rangeOffersStartBetween,
  rangesOverlap,
  resolveQuery,
  subtractBookedLessons,
  subtractRanges,
} from './booking.js'
import { DAY_KEYS } from './availability.js'
import { mondayIndex } from './calendar.js'

// Fechas fijas a propósito: nada acá depende de qué día es hoy. El 14/09/2026
// es lunes, así que la semana va del 14 (lunes) al 20 (domingo).
const LUNES = '2026-09-14'
const MARTES = '2026-09-15'
const DOMINGO = '2026-09-20'

const ENTRADAS = [
  {
    teacherId: 2,
    teacherName: 'Laura Gómez',
    subjectId: 1,
    subjectName: 'Matemática',
    schedule: {
      lunes: [
        { start: '13:00', end: '15:30' },
        { start: '16:00', end: '17:00' },
      ],
    },
  },
  {
    teacherId: 4,
    teacherName: 'Carla Benítez',
    subjectId: 2,
    subjectName: 'Física',
    schedule: { lunes: [{ start: '12:00', end: '17:00' }] },
  },
]

describe('dayKeyFromIso', () => {
  it('traduce una fecha al día de la semana', () => {
    expect(dayKeyFromIso(LUNES)).toBe('lunes')
    expect(dayKeyFromIso(MARTES)).toBe('martes')
    expect(dayKeyFromIso(DOMINGO)).toBe('domingo')
  })

  it('está alineado con mondayIndex', () => {
    // Los dos espacios de índices arrancan en lunes; este test es el que
    // sostiene el puente si alguien toca cualquiera de los dos.
    for (let i = 0; i < 7; i++) {
      const date = new Date(2026, 8, 14 + i)
      expect(dayKeyFromDate(date)).toBe(DAY_KEYS[mondayIndex(date)])
    }
  })
})

describe('rangesOverlap', () => {
  it('los bordes que se tocan NO se pisan', () => {
    // Una clase de 14 a 15 y otra de 15 a 16 conviven.
    expect(rangesOverlap({ start: '14:00', end: '15:00' }, { start: '15:00', end: '16:00' })).toBe(
      false,
    )
  })

  it('media hora en común alcanza para pisarse', () => {
    expect(rangesOverlap({ start: '14:00', end: '15:00' }, { start: '14:30', end: '15:30' })).toBe(
      true,
    )
  })

  it('uno adentro del otro se pisa en los dos sentidos', () => {
    const grande = { start: '12:00', end: '18:00' }
    const chico = { start: '14:00', end: '15:00' }
    expect(rangesOverlap(grande, chico)).toBe(true)
    expect(rangesOverlap(chico, grande)).toBe(true)
  })

  it('rangos separados no se pisan', () => {
    expect(rangesOverlap({ start: '09:00', end: '10:00' }, { start: '14:00', end: '15:00' })).toBe(
      false,
    )
  })
})

describe('intersectRanges', () => {
  it('devuelve el pedazo en común', () => {
    expect(
      intersectRanges({ start: '12:00', end: '17:00' }, { start: '14:00', end: '15:00' }),
    ).toEqual({ start: '14:00', end: '15:00' })
  })

  it('sin nada en común da null', () => {
    expect(intersectRanges({ start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' })).toBeNull()
  })
})

describe('subtractRanges', () => {
  it('un hueco en el medio parte el rango en dos', () => {
    expect(
      subtractRanges([{ start: '12:00', end: '17:00' }], [{ start: '14:00', end: '15:00' }]),
    ).toEqual([
      { start: '12:00', end: '14:00' },
      { start: '15:00', end: '17:00' },
    ])
  })

  it('si lo tapan entero desaparece', () => {
    expect(
      subtractRanges([{ start: '14:00', end: '15:00' }], [{ start: '13:00', end: '16:00' }]),
    ).toEqual([])
  })

  it('lo que no se toca queda igual', () => {
    expect(
      subtractRanges([{ start: '09:00', end: '11:00' }], [{ start: '14:00', end: '15:00' }]),
    ).toEqual([{ start: '09:00', end: '11:00' }])
  })

  it('recorta desde el principio y desde el final', () => {
    expect(
      subtractRanges([{ start: '12:00', end: '17:00' }], [{ start: '12:00', end: '13:00' }]),
    ).toEqual([{ start: '13:00', end: '17:00' }])
    expect(
      subtractRanges([{ start: '12:00', end: '17:00' }], [{ start: '16:00', end: '17:00' }]),
    ).toEqual([{ start: '12:00', end: '16:00' }])
  })

  it('aplica varios ocupados seguidos', () => {
    expect(
      subtractRanges(
        [{ start: '08:00', end: '14:00' }],
        [
          { start: '09:00', end: '10:00' },
          { start: '12:00', end: '13:00' },
        ],
      ),
    ).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '10:00', end: '12:00' },
      { start: '13:00', end: '14:00' },
    ])
  })

  it('sin ocupados devuelve lo mismo', () => {
    expect(subtractRanges([{ start: '09:00', end: '11:00' }], [])).toEqual([
      { start: '09:00', end: '11:00' },
    ])
  })
})

describe('rangeOffersStartBetween', () => {
  const tarde = { start: '13:00', end: '17:00' }

  it('sin límites siempre entra', () => {
    expect(rangeOffersStartBetween(tarde, '', '')).toBe(true)
  })

  it('solo Desde es "arranca después"', () => {
    expect(rangeOffersStartBetween(tarde, '15:00', '')).toBe(true)
    expect(rangeOffersStartBetween(tarde, '17:00', '')).toBe(false)
  })

  it('solo Hasta es "arranca antes"', () => {
    expect(rangeOffersStartBetween(tarde, '', '14:00')).toBe(true)
    expect(rangeOffersStartBetween(tarde, '', '12:00')).toBe(false)
  })

  it('los dos juntos es "entre"', () => {
    expect(rangeOffersStartBetween(tarde, '14:00', '15:00')).toBe(true)
    expect(rangeOffersStartBetween(tarde, '08:00', '11:00')).toBe(false)
  })

  it('el último arranque deja lugar para la clase entera', () => {
    // 13:00–14:00 solo ofrece arrancar 13:00: a las 13:30 no entra una hora.
    const justo = { start: '13:00', end: '14:00' }
    expect(rangeOffersStartBetween(justo, '13:00', '13:00')).toBe(true)
    expect(rangeOffersStartBetween(justo, '13:30', '')).toBe(false)
  })

  it('media hora no ofrece ningún arranque', () => {
    expect(rangeOffersStartBetween({ start: '13:00', end: '13:30' }, '', '')).toBe(false)
  })
})

describe('bookableRanges', () => {
  it('deja solo los tramos de al menos una hora', () => {
    expect(
      bookableRanges([
        { start: '09:00', end: '09:30' },
        { start: '10:00', end: '11:00' },
        { start: '12:00', end: '15:00' },
      ]),
    ).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '12:00', end: '15:00' },
    ])
  })
})

describe('countRangeSlots', () => {
  it('suma las medias horas de todos los rangos', () => {
    expect(
      countRangeSlots([
        { start: '13:00', end: '15:30' },
        { start: '16:00', end: '17:00' },
      ]),
    ).toBe(7)
  })
})

describe('expandAvailability', () => {
  it('proyecta la plantilla semanal sobre cada fecha que corresponde', () => {
    const rows = expandAvailability(ENTRADAS, LUNES, DOMINGO)
    // Solo hay plantilla para lunes, así que dos filas (una por docente).
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ date: LUNES, dayKey: 'lunes', teacherId: 2, subjectId: 1 })
    expect(rows[0].ranges).toEqual([
      { start: '13:00', end: '15:30' },
      { start: '16:00', end: '17:00' },
    ])
  })

  it('repite la fila en cada semana del rango', () => {
    const rows = expandAvailability(ENTRADAS, LUNES, '2026-09-21')
    // Dos lunes en el rango (14 y 21) por dos docentes.
    expect(rows).toHaveLength(4)
    expect(rows.filter((row) => row.date === '2026-09-21')).toHaveLength(2)
  })

  it('un día sin plantilla no genera fila', () => {
    const rows = expandAvailability(ENTRADAS, MARTES, MARTES)
    expect(rows).toEqual([])
  })

  it('el id identifica fecha, docente y materia', () => {
    const rows = expandAvailability(ENTRADAS, LUNES, LUNES)
    expect(rows[0].id).toBe(`${LUNES}|2|1`)
  })
})

describe('subtractBookedLessons', () => {
  const rows = expandAvailability(ENTRADAS, LUNES, LUNES)

  it('resta lo reservado con ESE docente aunque sea de otra materia', () => {
    // Nadie da dos clases a la vez: la materia no importa para restar.
    const resultado = subtractBookedLessons(rows, [
      { date: LUNES, teacherId: 2, startTime: '14:00', endTime: '15:00', subjectId: 3 },
    ])
    const laura = resultado.find((row) => row.teacherId === 2)
    expect(laura.ranges).toEqual([
      { start: '13:00', end: '14:00' },
      { start: '15:00', end: '15:30' },
      { start: '16:00', end: '17:00' },
    ])
  })

  it('no toca la disponibilidad de otro docente', () => {
    const resultado = subtractBookedLessons(rows, [
      { date: LUNES, teacherId: 2, startTime: '14:00', endTime: '15:00' },
    ])
    const carla = resultado.find((row) => row.teacherId === 4)
    expect(carla.ranges).toEqual([{ start: '12:00', end: '17:00' }])
  })

  it('no toca otro día', () => {
    const resultado = subtractBookedLessons(rows, [
      { date: MARTES, teacherId: 2, startTime: '14:00', endTime: '15:00' },
    ])
    expect(resultado.find((row) => row.teacherId === 2).ranges).toHaveLength(2)
  })

  it('la fila que se queda sin nada desaparece', () => {
    const resultado = subtractBookedLessons(rows, [
      { date: LUNES, teacherId: 2, startTime: '13:00', endTime: '15:30' },
      { date: LUNES, teacherId: 2, startTime: '16:00', endTime: '17:00' },
    ])
    expect(resultado.find((row) => row.teacherId === 2)).toBeUndefined()
    expect(resultado).toHaveLength(1)
  })
})

describe('annotateClashes', () => {
  const rows = expandAvailability(ENTRADAS, LUNES, LUNES)

  const claseConLaura = {
    id: 'sl-1',
    date: LUNES,
    teacherId: 2,
    teacherName: 'Laura Gómez',
    subjectId: 1,
    subjectName: 'Matemática',
    startTime: '14:00',
    endTime: '15:00',
  }

  it('una superposición parcial NO impide reservar', () => {
    // A Carla le quedan 12:00–14:00 y 15:00–17:00: en las dos entra una hora.
    const cards = annotateClashes(rows, [claseConLaura])
    const carla = cards.find((card) => card.teacherId === 4)

    expect(carla.clashes).toHaveLength(1)
    expect(carla.clashes[0]).toMatchObject({ subjectName: 'Matemática', teacherName: 'Laura Gómez' })
    expect(carla.bookable).toBe(true)
    expect(carla.free).toEqual([
      { start: '12:00', end: '14:00' },
      { start: '15:00', end: '17:00' },
    ])
  })

  it('si solo quedan pedazos de media hora no se puede reservar', () => {
    const angosto = expandAvailability(
      [
        {
          teacherId: 2,
          teacherName: 'Laura Gómez',
          subjectId: 3,
          subjectName: 'Álgebra',
          schedule: { lunes: [{ start: '08:30', end: '10:30' }] },
        },
      ],
      LUNES,
      LUNES,
    )
    const cards = annotateClashes(angosto, [
      { ...claseConLaura, teacherId: 9, startTime: '09:00', endTime: '10:00' },
    ])

    // Quedan 08:30–09:00 y 10:00–10:30: nada donde entre una hora.
    expect(cards[0].free).toEqual([])
    expect(cards[0].bookable).toBe(false)
    expect(cards[0].clashes).toHaveLength(1)
  })

  it('deja el total de horas del docente, no el que queda libre', () => {
    const cards = annotateClashes(rows, [claseConLaura])
    // Carla ofrece 12:00–17:00 = 10 medias horas, aunque 2 choquen.
    expect(cards.find((card) => card.teacherId === 4).totalSlots).toBe(10)
  })

  it('sin clases propias no hay choques y todo es reservable', () => {
    const cards = annotateClashes(rows, [])
    expect(cards.every((card) => card.clashes.length === 0)).toBe(true)
    expect(cards.every((card) => card.bookable)).toBe(true)
  })
})

describe('groupCardsByDate', () => {
  it('agrupa por fecha y ordena por hora', () => {
    const cards = [
      { date: LUNES, ranges: [{ start: '16:00', end: '17:00' }], subjectName: 'B', teacherName: 'B' },
      { date: LUNES, ranges: [{ start: '09:00', end: '10:00' }], subjectName: 'A', teacherName: 'A' },
      { date: MARTES, ranges: [{ start: '08:00', end: '09:00' }], subjectName: 'C', teacherName: 'C' },
    ]
    const porFecha = groupCardsByDate(cards)

    expect(Object.keys(porFecha).sort()).toEqual([LUNES, MARTES])
    expect(porFecha[LUNES].map((card) => card.ranges[0].start)).toEqual(['09:00', '16:00'])
  })
})

describe('filterCards', () => {
  const cards = [
    {
      dayKey: 'lunes',
      subjectId: 1,
      teacherName: 'Laura Gómez',
      ranges: [{ start: '13:00', end: '17:00' }],
    },
    {
      dayKey: 'martes',
      subjectId: 2,
      teacherName: 'Carla Benítez',
      ranges: [{ start: '08:00', end: '11:00' }],
    },
  ]

  it('sin filtros devuelve todo', () => {
    expect(filterCards(cards, {})).toHaveLength(2)
  })

  it('filtra por día', () => {
    expect(filterCards(cards, { dayKeys: ['lunes'] })).toHaveLength(1)
  })

  it('filtra por materia', () => {
    expect(filterCards(cards, { subjectIds: [2] })[0].dayKey).toBe('martes')
  })

  it('filtra por docente sin importar acentos ni mayúsculas', () => {
    expect(filterCards(cards, { teacherQuery: 'gomez' })).toHaveLength(1)
    expect(filterCards(cards, { teacherQuery: 'GÓMEZ' })).toHaveLength(1)
  })

  it('filtra por hora de arranque', () => {
    expect(filterCards(cards, { fromTime: '12:00' })).toHaveLength(1)
    expect(filterCards(cards, { toTime: '09:00' })).toHaveLength(1)
  })

  it('los cuatro filtros se combinan con Y', () => {
    expect(
      filterCards(cards, {
        dayKeys: ['lunes'],
        subjectIds: [1],
        fromTime: '14:00',
        teacherQuery: 'laura',
      }),
    ).toHaveLength(1)
    // Mismo caso pero con un día que no es: no queda nada.
    expect(
      filterCards(cards, {
        dayKeys: ['martes'],
        subjectIds: [1],
        teacherQuery: 'laura',
      }),
    ).toHaveLength(0)
  })

  it('NO recorta los rangos que se muestran', () => {
    // La tarjeta sigue diciendo la verdad sobre el docente aunque el filtro
    // sea más angosto: recortarla sería inventar otra disponibilidad.
    const resultado = filterCards(cards, { fromTime: '15:00' })
    expect(resultado[0].ranges).toEqual([{ start: '13:00', end: '17:00' }])
  })
})

describe('normalizeText', () => {
  it('saca acentos y mayúsculas', () => {
    expect(normalizeText('Matemática')).toBe('matematica')
    expect(normalizeText('  Laura GÓMEZ ')).toBe('laura gomez')
  })

  it('aguanta valores vacíos', () => {
    expect(normalizeText(null)).toBe('')
    expect(normalizeText(undefined)).toBe('')
  })
})

describe('resolveQuery', () => {
  const subjects = [
    { id: 1, name: 'Matemática' },
    { id: 2, name: 'Física' },
  ]

  it('una materia se resuelve como filtro de materia', () => {
    expect(resolveQuery('mate', subjects)).toEqual({ subjectId: 1, teacherQuery: '' })
  })

  it('no le importan los acentos', () => {
    expect(resolveQuery('matematica', subjects)).toEqual({ subjectId: 1, teacherQuery: '' })
    expect(resolveQuery('fisica', subjects)).toEqual({ subjectId: 2, teacherQuery: '' })
  })

  it('lo que no es materia es nombre de docente', () => {
    // startsWith y no includes: si no, 'gómez' podría pegar con una materia.
    expect(resolveQuery('gómez', subjects)).toEqual({ subjectId: null, teacherQuery: 'gómez' })
  })

  it('vacío no filtra nada', () => {
    expect(resolveQuery('', subjects)).toEqual({ subjectId: null, teacherQuery: '' })
    expect(resolveQuery('   ', subjects)).toEqual({ subjectId: null, teacherQuery: '' })
  })
})

describe('formatClashes', () => {
  const conLaura = {
    subjectName: 'Matemática',
    teacherName: 'Laura Gómez',
    startTime: '14:00',
    endTime: '15:00',
  }
  const conCarla = {
    subjectName: 'Física',
    teacherName: 'Carla Benítez',
    startTime: '16:00',
    endTime: '17:00',
  }

  it('sin choques no dice nada', () => {
    expect(formatClashes([])).toBeNull()
  })

  it('uno solo nombra materia, docente y horario', () => {
    expect(formatClashes([conLaura])).toBe(
      'Se superpone con Matemática con Laura Gómez (14:00 – 15:00).',
    )
  })

  it('dos se unen con "y" y sin el horario', () => {
    expect(formatClashes([conLaura, conCarla])).toBe(
      'Se superpone con Matemática con Laura Gómez y Física con Carla Benítez.',
    )
  })

  it('más de dos se cortan', () => {
    const cuatro = [conLaura, conCarla, conLaura, conCarla]
    expect(formatClashes(cuatro)).toContain('y 2 clases más')
  })

  it('si no queda hora libre lo dice adelante', () => {
    expect(formatClashes([conLaura], false)).toMatch(/^No te queda una hora libre:/)
  })

  it('los nombres propios no pierden las mayúsculas', () => {
    // El prefijo de "no queda hora libre" se armaba con toLowerCase sobre la
    // frase entera y dejaba "base de datos con martín sosa".
    const texto = formatClashes(
      [
        {
          subjectName: 'Base de Datos',
          teacherName: 'Martín Sosa',
          startTime: '09:00',
          endTime: '10:00',
        },
      ],
      false,
    )
    expect(texto).toContain('Base de Datos')
    expect(texto).toContain('Martín Sosa')
  })
})

describe('formatFreeCount', () => {
  it('singular y plural', () => {
    expect(formatFreeCount(1)).toBe('1 libre')
    expect(formatFreeCount(3)).toBe('3 libres')
    expect(formatFreeCount(0)).toBe('0 libres')
  })
})
