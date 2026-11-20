import {
  EMPTY_BOOKING_FILTERS,
  cardKind,
  countBookableByDate,
  countBookingFilters,
  dayKeyFromIso,
  filterCards,
  filterSubjectsFor,
  formatEnrolled,
  groupCardsByDate,
  lowestRate,
  normalizeText,
  offersStartBetween,
  toMinutes,
} from './booking.js'
import { toMinutes as toMinutesDeWindows } from './windows.js'
import { apiAvailabilityRow, startsBetween } from '../testing/fixtures.js'

// Una fila tal como la manda /api/availability: Laura da Matemática y
// Química, virtual, de 13 a 16.
const tarjeta = (over = {}) =>
  apiAvailabilityRow({
    subjects: [
      { id: 's1', name: 'Matemática', hourlyRateCents: 500000 },
      { id: 's3', name: 'Química', hourlyRateCents: 450000 },
    ],
    ...over,
  })

const grupal = (over = {}) => ({
  start: '09:00',
  end: '10:00',
  subjectId: 's1',
  subjectName: 'Matemática',
  enrolled: 1,
  maxStudents: 4,
  ...over,
})

const ids = (cards) => cards.map((card) => card.id)

describe('dayKeyFromIso', () => {
  it('traduce la fecha al día de la semana', () => {
    expect(dayKeyFromIso('2026-09-14')).toBe('lunes')
    expect(dayKeyFromIso('2026-09-20')).toBe('domingo')
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
    expect(porFecha['2099-09-14'].map((card) => card.id)).toEqual(['c', 'a', 'b'])
  })

  it('pone primero a los destacados tal como los marca el backend', () => {
    // De licencia el backend ya manda teacherFeatured en false.
    const porFecha = groupCardsByDate([
      tarjeta({ id: 'temprano', start: '09:00' }),
      tarjeta({ id: 'licencia', start: '08:00', teacherFeatured: false, onVacation: true }),
      tarjeta({ id: 'destacado', start: '18:00', teacherFeatured: true }),
    ])
    expect(porFecha['2099-09-14'].map((card) => card.id)).toEqual([
      'destacado',
      'licencia',
      'temprano',
    ])
  })
})

describe('countBookableByDate', () => {
  it('cuenta las tarjetas de cada día sin las de licencia', () => {
    const porFecha = {
      '2099-09-14': [tarjeta({ id: 'a' }), tarjeta({ id: 'b', onVacation: true, starts: [] })],
      '2099-09-15': [tarjeta({ id: 'c', onVacation: true, starts: [] })],
    }
    expect(countBookableByDate(porFecha)).toEqual({ '2099-09-14': 1, '2099-09-15': 0 })
  })
})

describe('offersStartBetween', () => {
  it('mira los inicios que manda el backend', () => {
    expect(offersStartBetween(tarjeta(), '14:00', '')).toBe(true)
    expect(offersStartBetween(tarjeta(), '15:30', '')).toBe(true)
    expect(offersStartBetween(tarjeta(), '16:00', '')).toBe(false)
    expect(offersStartBetween(tarjeta(), '', '13:00')).toBe(true)
    expect(offersStartBetween(tarjeta(), '', '12:00')).toBe(false)
  })

  it('no inventa inicios que el backend no mandó', () => {
    const recortada = tarjeta({ starts: [{ start: '15:00', maxMinutes: 60 }] })
    expect(offersStartBetween(recortada, '', '14:30')).toBe(false)
  })

  it('cuenta también sumarse a una grupal', () => {
    const soloGrupal = tarjeta({ starts: [], groups: [grupal()] })
    expect(offersStartBetween(soloGrupal, '', '09:00')).toBe(true)
    expect(offersStartBetween(soloGrupal, '10:00', '')).toBe(false)
  })

  it('una de licencia se ubica por su rango', () => {
    const licencia = tarjeta({ onVacation: true, starts: [] })
    expect(offersStartBetween(licencia, '14:00', '')).toBe(true)
    expect(offersStartBetween(licencia, '16:00', '')).toBe(false)
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

  it('sin filtros pasan todas', () => {
    expect(ids(filterCards([virtual, presencial]))).toEqual(['v', 'p'])
  })

  it('por materia: pasa la ventana que ofrece alguna de las elegidas', () => {
    expect(ids(filterCards([virtual, presencial], { subjectIds: ['s2'] }))).toEqual(['p'])
    expect(ids(filterCards([virtual, presencial], { subjectIds: ['s3'] }))).toEqual(['v', 'p'])
    expect(ids(filterCards([virtual, presencial], { subjectIds: ['s1', 's2'] }))).toEqual(['v', 'p'])
  })

  it('por materia: una tarjeta cuya única grupal es de otra materia no pasa', () => {
    // Bug: antes alcanzaba con que la materia estuviera tarifada, aunque lo
    // único reservable fuera una grupal de otra.
    const soloGrupalDeMate = tarjeta({ id: 'g', starts: [], groups: [grupal()] })
    expect(ids(filterCards([soloGrupalDeMate], { subjectIds: ['s3'] }))).toEqual([])
    expect(ids(filterCards([soloGrupalDeMate], { subjectIds: ['s1'] }))).toEqual(['g'])
  })

  it('por materia: una de licencia pasa por las materias que ofrecería', () => {
    const licencia = tarjeta({ id: 'l', onVacation: true, starts: [] })
    expect(ids(filterCards([licencia], { subjectIds: ['s3'] }))).toEqual(['l'])
    expect(ids(filterCards([licencia], { subjectIds: ['s2'] }))).toEqual([])
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

  it('por día', () => {
    expect(ids(filterCards([virtual], { dayKeys: ['martes'] }))).toEqual([])
    expect(ids(filterCards([virtual], { dayKeys: ['lunes'] }))).toEqual(['v'])
  })

  it('el texto libre pega con el docente o con una materia, sin importar acentos', () => {
    expect(ids(filterCards([virtual, presencial], { teacherQuery: 'gomez' }))).toEqual(['v'])
    expect(ids(filterCards([virtual, presencial], { teacherQuery: 'fisi' }))).toEqual(['p'])
    expect(ids(filterCards([virtual, presencial], { teacherQuery: 'quimica' }))).toEqual(['v', 'p'])
    expect(ids(filterCards([virtual, presencial], { teacherQuery: 'zzz' }))).toEqual([])
  })

  it('por favoritos', () => {
    expect(ids(filterCards([virtual, presencial], { teacherIds: ['t1'] }))).toEqual(['v', 'p'])
    expect(ids(filterCards([virtual, presencial], { teacherIds: [] }))).toEqual([])
  })

  it('por horario de arranque', () => {
    expect(ids(filterCards([virtual], { fromTime: '17:00' }))).toEqual([])
    const tarde = tarjeta({ id: 't', starts: startsBetween('15:00', '16:00') })
    expect(ids(filterCards([virtual, tarde], { toTime: '14:00' }))).toEqual(['v'])
  })
})

describe('filterSubjectsFor', () => {
  const catalogo = [
    { id: 's1', name: 'Matemática' },
    { id: 's2', name: 'Física' },
    { id: 's3', name: 'Química' },
    { id: 's4', name: 'Historia' },
  ]

  it('solo las materias que aparecen en las filas, en el orden del catálogo', () => {
    const filas = [tarjeta({ subjects: [{ id: 's3', name: 'Química', hourlyRateCents: 1 }] })]
    expect(filterSubjectsFor(filas, catalogo, []).map((s) => s.id)).toEqual(['s3'])
  })

  it('suma las de las grupales y las ya elegidas aunque no queden', () => {
    const filas = [tarjeta({ subjects: [], groups: [grupal({ subjectId: 's2' })] })]
    expect(filterSubjectsFor(filas, catalogo, ['s4']).map((s) => s.id)).toEqual(['s2', 's4'])
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

describe('toMinutes', () => {
  it('pasa la hora a minutos, con 24:00 como fin del día', () => {
    expect(toMinutes('13:45')).toBe(825)
    expect(toMinutes('24:00')).toBe(1440)
  })

  it('lo que no es hora da -1', () => {
    expect(toMinutes('')).toBe(-1)
    expect(toMinutes(undefined)).toBe(-1)
    expect(toMinutes('25:00')).toBe(-1)
  })

  it('es la misma función que usa windows.js', () => {
    expect(toMinutesDeWindows).toBe(toMinutes)
  })
})

describe('countBookingFilters', () => {
  it('sin nada elegido es 0', () => {
    expect(countBookingFilters(EMPTY_BOOKING_FILTERS)).toBe(0)
  })

  it('cuenta cada chip, el horario como uno, el docente y favoritos', () => {
    const filters = {
      ...EMPTY_BOOKING_FILTERS,
      dayKeys: ['lunes', 'martes'],
      modalities: ['virtual'],
      fromTime: '10:00',
      toTime: '12:00',
      teacherQuery: 'laura',
      onlyFavorites: true,
    }
    expect(countBookingFilters(filters)).toBe(6)
  })
})
