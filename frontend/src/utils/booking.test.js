import {
  annotateClashes,
  cardKind,
  dayKeyFromIso,
  filterCards,
  formatClashes,
  formatEnrolled,
  groupCardsByDate,
  lowestRate,
  normalizeText,
  offersStartBetween,
  rangesOverlap,
  resolveQuery,
  startOptions,
} from './booking.js'

// 2026-09-14 es lunes. Una fila tal como la manda /api/availability.
const tarjeta = (over = {}) => ({
  id: 'w1|2026-09-14',
  windowId: 'w1',
  date: '2026-09-14',
  dayKey: 'lunes',
  teacherId: 't1',
  teacherName: 'Laura Gómez',
  start: '13:00',
  end: '16:00',
  modality: 'virtual',
  maxStudents: 1,
  locality: null,
  subjects: [
    { id: 's1', name: 'Matemática', hourlyRateCents: 500000 },
    { id: 's3', name: 'Química', hourlyRateCents: 450000 },
  ],
  free: [{ start: '13:00', end: '16:00' }],
  groups: [],
  ...over,
})

const inicios = (options) => options.map((option) => option.start)

const clase = (over = {}) => ({
  id: 'c1',
  date: '2026-09-14',
  startTime: '14:00',
  endTime: '15:00',
  teacherId: 't2',
  teacherName: 'Carla Benítez',
  subjectName: 'Física',
  ...over,
})

describe('dayKeyFromIso', () => {
  it('traduce la fecha al día de la semana', () => {
    expect(dayKeyFromIso('2026-09-14')).toBe('lunes')
    expect(dayKeyFromIso('2026-09-20')).toBe('domingo')
  })
})

describe('rangesOverlap', () => {
  it('tocarse en el borde no es pisarse', () => {
    expect(rangesOverlap({ start: '14:00', end: '15:00' }, { start: '15:00', end: '16:00' })).toBe(
      false,
    )
    expect(rangesOverlap({ start: '14:00', end: '15:00' }, { start: '14:30', end: '15:30' })).toBe(
      true,
    )
  })

  it('entiende clases que terminan fuera de la media hora', () => {
    expect(rangesOverlap({ start: '13:00', end: '13:45' }, { start: '13:30', end: '14:30' })).toBe(
      true,
    )
    expect(rangesOverlap({ start: '13:00', end: '13:45' }, { start: '13:45', end: '14:30' })).toBe(
      false,
    )
  })

  it('entiende 24:00', () => {
    expect(rangesOverlap({ start: '23:00', end: '24:00' }, { start: '23:30', end: '24:00' })).toBe(
      true,
    )
  })
})

describe('startOptions', () => {
  it('cada :00/:30 del tramo donde entra una clase de 30 min, con la más larga posible', () => {
    expect(startOptions([{ start: '13:00', end: '14:15' }])).toEqual([
      { start: '13:00', maxMinutes: 75, blocked: false },
      { start: '13:30', maxMinutes: 45, blocked: false },
    ])
  })

  it('la duración máxima va de a 5 minutos', () => {
    // 13:00 a 13:47: entran 45, no 47.
    expect(startOptions([{ start: '13:00', end: '13:47' }])[0].maxMinutes).toBe(45)
  })

  it('una clase propia bloquea lo que pisa y corta lo que viene antes', () => {
    const opciones = startOptions([{ start: '13:00', end: '16:00' }], [{ start: '14:10', end: '15:00' }])
    expect(opciones.find((o) => o.start === '13:00')).toEqual({
      start: '13:00',
      maxMinutes: 70,
      blocked: false,
    })
    // 13:30 + 30 min = 14:00, antes de las 14:10: entra, hasta 40 min.
    expect(opciones.find((o) => o.start === '13:30').maxMinutes).toBe(40)
    // 14:00 + 30 min se pisa con la de 14:10.
    expect(opciones.find((o) => o.start === '14:00').blocked).toBe(true)
    expect(opciones.find((o) => o.start === '14:30').blocked).toBe(true)
    expect(opciones.find((o) => o.start === '15:00')).toEqual({
      start: '15:00',
      maxMinutes: 60,
      blocked: false,
    })
  })

  it('recorre varios tramos', () => {
    const tramos = [
      { start: '09:00', end: '09:30' },
      { start: '11:00', end: '12:00' },
    ]
    expect(inicios(startOptions(tramos))).toEqual(['09:00', '11:00', '11:30'])
  })
})

describe('annotateClashes', () => {
  it('sin clases propias todo se puede reservar', () => {
    const [card] = annotateClashes([tarjeta()], [])
    expect(card.bookable).toBe(true)
    expect(card.clashes).toEqual([])
    expect(card.starts.every((option) => !option.blocked)).toBe(true)
    expect(inicios(card.starts)).toEqual(['13:00', '13:30', '14:00', '14:30', '15:00', '15:30'])
  })

  it('bloquea solo los inicios que se pisan con otra clase propia', () => {
    const [card] = annotateClashes([tarjeta()], [clase({ startTime: '14:30', endTime: '15:30' })])
    expect(card.starts.map((option) => option.blocked)).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
    ])
    expect(card.bookable).toBe(true)
    expect(card.clashes).toHaveLength(1)
  })

  it('sin ningún horario libre la tarjeta no se puede reservar', () => {
    const [card] = annotateClashes([tarjeta()], [clase({ startTime: '13:00', endTime: '16:00' })])
    expect(card.bookable).toBe(false)
  })

  it('ignora las clases de otro día', () => {
    const [card] = annotateClashes([tarjeta()], [clase({ date: '2026-09-15' })])
    expect(card.clashes).toEqual([])
  })

  it('una grupal en la que ya está anotado se marca aparte, no como choque', () => {
    const grupal = tarjeta({
      teacherId: 't1',
      maxStudents: 4,
      free: [],
      groups: [{ start: '14:00', end: '15:00', subjectId: 's1', subjectName: 'Matemática', enrolled: 2 }],
    })
    const mia = clase({ teacherId: 't1', teacherName: 'Laura Gómez', subjectName: 'Matemática' })
    const [card] = annotateClashes([grupal], [mia])

    expect(card.groups[0]).toMatchObject({ joined: true, blocked: true })
    expect(card.joined).toHaveLength(1)
    expect(card.clashes).toEqual([])
    expect(card.bookable).toBe(false)
  })

  it('una grupal con lugar alcanza para que se pueda reservar', () => {
    const grupal = tarjeta({
      maxStudents: 4,
      free: [],
      groups: [{ start: '14:00', end: '15:00', subjectId: 's1', subjectName: 'Matemática', enrolled: 2 }],
    })
    expect(annotateClashes([grupal], [])[0].bookable).toBe(true)
  })
})

describe('lowestRate', () => {
  it('la tarifa más baja de las materias de la ventana', () => {
    expect(lowestRate(tarjeta())).toBe(450000)
    expect(lowestRate(tarjeta({ subjects: [] }))).toBeNull()
  })
})

describe('groupCardsByDate', () => {
  it('agrupa por fecha y ordena por hora y docente', () => {
    const porFecha = groupCardsByDate([
      tarjeta({ id: 'b', start: '15:00' }),
      tarjeta({ id: 'a', start: '09:00', teacherName: 'Zoe' }),
      tarjeta({ id: 'c', start: '09:00', teacherName: 'Ana' }),
    ])
    expect(porFecha['2026-09-14'].map((card) => card.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('offersStartBetween', () => {
  it('mira dónde puede ARRANCAR una clase: hasta 30 min antes del fin del tramo', () => {
    expect(offersStartBetween(tarjeta(), '14:00', '')).toBe(true)
    expect(offersStartBetween(tarjeta(), '15:30', '')).toBe(true)
    expect(offersStartBetween(tarjeta(), '16:00', '')).toBe(false)
    expect(offersStartBetween(tarjeta(), '', '13:00')).toBe(true)
    expect(offersStartBetween(tarjeta(), '', '12:00')).toBe(false)
  })

  it('cuenta también sumarse a una grupal', () => {
    const grupal = tarjeta({
      free: [],
      groups: [{ start: '09:00', end: '10:00', subjectId: 's1', subjectName: 'Matemática', enrolled: 1 }],
    })
    expect(offersStartBetween(grupal, '', '09:00')).toBe(true)
    expect(offersStartBetween(grupal, '10:00', '')).toBe(false)
  })
})

describe('filterCards', () => {
  const virtual = tarjeta({ id: 'v' })
  const presencial = tarjeta({
    id: 'p',
    modality: 'in_person',
    maxStudents: 5,
    subjects: [
      { id: 's2', name: 'Física', hourlyRateCents: 800000 },
      { id: 's3', name: 'Química', hourlyRateCents: 800000 },
    ],
    teacherName: 'Carla Benítez',
  })
  const ids = (cards) => cards.map((card) => card.id)

  it('sin filtros pasan todas', () => {
    expect(ids(filterCards([virtual, presencial]))).toEqual(['v', 'p'])
  })

  it('por materia: pasa la ventana que ofrece alguna de las elegidas', () => {
    expect(ids(filterCards([virtual, presencial], { subjectIds: ['s2'] }))).toEqual(['p'])
    expect(ids(filterCards([virtual, presencial], { subjectIds: ['s3'] }))).toEqual(['v', 'p'])
    expect(ids(filterCards([virtual, presencial], { subjectIds: ['s1', 's2'] }))).toEqual(['v', 'p'])
  })

  it('compara los ids de materia como string', () => {
    const conNumeros = tarjeta({ id: 'n', subjects: [{ id: 7, name: 'Historia', hourlyRateCents: 1 }] })
    expect(ids(filterCards([conNumeros], { subjectIds: ['7'] }))).toEqual(['n'])
  })

  it('por modalidad', () => {
    expect(ids(filterCards([virtual, presencial], { modalities: ['in_person'] }))).toEqual(['p'])
    expect(
      ids(filterCards([virtual, presencial], { modalities: ['virtual', 'in_person'] })),
    ).toEqual(['v', 'p'])
  })

  it('por tipo de clase', () => {
    expect(cardKind(presencial)).toBe('group')
    expect(ids(filterCards([virtual, presencial], { kinds: ['individual'] }))).toEqual(['v'])
  })

  it('por día y por docente, sin importar acentos', () => {
    expect(ids(filterCards([virtual], { dayKeys: ['martes'] }))).toEqual([])
    expect(ids(filterCards([virtual, presencial], { teacherQuery: 'gomez' }))).toEqual(['v'])
  })

  it('por horario de arranque', () => {
    expect(ids(filterCards([virtual], { fromTime: '17:00' }))).toEqual([])
  })
})

describe('textos de la tarjeta', () => {
  it('formatEnrolled', () => {
    expect(formatEnrolled(2, 5)).toBe('2 de 5 anotados')
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
    expect(formatClashes([conLaura], false)).toMatch(/^No te queda ningún horario libre:/)
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

