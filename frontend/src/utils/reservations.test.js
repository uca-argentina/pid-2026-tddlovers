import { describe, expect, it } from 'vitest'
import { apiBooking } from '../testing/fixtures.js'
import {
  activeRows,
  calendarClasses,
  pendingClassCount,
  classCapacityLabel,
  CATEGORIES,
  EMPTY_FILTERS,
  filterClasses,
  groupClasses,
  lastClass,
  nextClass,
  orderClassRows,
  subjectsOf,
  classSiblings,
  classPriceLabel,
  classesIn,
  withClassMaterial,
} from './reservations.js'

const category = (key) => CATEGORIES.find((c) => c.key === key)
const AHORA = { iso: '2099-09-14', time: '11:35' }

describe('classesIn', () => {
  const bookings = [
    apiBooking({ id: 'lejos', status: 'pendiente', date: '2099-10-01' }),
    apiBooking({ id: 'cerca', status: 'pendiente', date: '2099-09-20' }),
    apiBooking({ id: 'vieja', status: 'realizada', date: '2099-08-01' }),
    apiBooking({ id: 'nueva', status: 'no_presentada', date: '2099-09-01' }),
    apiBooking({ id: 'cancel', status: 'cancelada' }),
  ]
  const ids = (entries) => entries.map((entry) => entry.cls.id)

  it('en las que vienen, la más cercana primero', () => {
    expect(ids(classesIn(category('pendiente'), groupClasses(bookings)))).toEqual(['cerca', 'lejos'])
  })

  it('finalizadas junta realizadas y no presentadas, la más nueva primero', () => {
    expect(ids(classesIn(category('finalizada'), groupClasses(bookings)))).toEqual(['nueva', 'vieja'])
  })

  it('solo las pendientes, aceptadas y confirmadas muestran la cantidad', () => {
    expect(CATEGORIES.filter((c) => c.showCount).map((c) => c.key)).toEqual([
      'pendiente',
      'aceptada',
      'confirmada',
    ])
  })
})

describe('groupClasses', () => {
  const base = { teacherId: 't1', date: '2099-09-20', startTime: '10:00', maxStudents: 3 }
  const sofia = apiBooking({ ...base, id: '1', studentName: 'Sofía', status: 'confirmada' })
  const ana = apiBooking({ ...base, id: '2', studentName: 'Ana', status: 'pendiente' })
  const beto = apiBooking({ ...base, id: '3', studentName: 'Beto', status: 'cancelada' })

  it('una grupal es una sola clase, con los que siguen primero', () => {
    const [entry] = groupClasses([sofia, beto, ana])
    expect(entry.rows.map((r) => r.id)).toEqual(['2', '1', '3'])
    expect(entry.active.map((r) => r.id)).toEqual(['2', '1'])
    expect(entry.cls.id).toBe('2')
  })

  it('con un alumno pendiente y otro confirmado aparece en las dos categorías, no en canceladas', () => {
    const entries = groupClasses([sofia, ana, beto])
    expect(classesIn(category('pendiente'), entries)).toHaveLength(1)
    expect(classesIn(category('confirmada'), entries)).toHaveLength(1)
    expect(classesIn(category('cancelada'), entries)).toHaveLength(0)
  })

  it('en canceladas solo la que se canceló para todos', () => {
    const todos = groupClasses([{ ...sofia, status: 'cancelada' }, beto])
    expect(classesIn(category('cancelada'), todos)).toHaveLength(1)
  })
})

describe('nextClass y lastClass', () => {
  const terminada = apiBooking({ id: 'terminada', status: 'confirmada', startTime: '09:00', endTime: '10:00' })
  const enCurso = apiBooking({ id: 'en-curso', status: 'confirmada', startTime: '11:00', endTime: '12:30' })
  const despues = apiBooking({ id: 'despues', status: 'pendiente', startTime: '16:00', endTime: '17:00' })
  const cancelada = apiBooking({ id: 'cancelada', status: 'cancelada', startTime: '10:30', endTime: '11:30' })
  const ayer = apiBooking({ id: 'ayer', status: 'realizada', date: '2099-09-13' })
  const todas = [despues, ayer, cancelada, terminada, enCurso]

  it('la próxima es la que no terminó, aunque esté en curso', () => {
    expect(nextClass(todas, AHORA).id).toBe('en-curso')
  })

  it('la última es la más reciente que terminó, sin canceladas', () => {
    expect(lastClass(todas, AHORA).id).toBe('terminada')
  })

  it('sin clases, null', () => {
    expect(nextClass([], AHORA)).toBeNull()
    expect(lastClass([cancelada], AHORA)).toBeNull()
  })
})

describe('classSiblings', () => {
  it('las reservas no canceladas del misma clase', () => {
    const base = { teacherId: 't1', date: '2099-09-14', startTime: '11:00', maxStudents: 3 }
    const sofia = apiBooking({ ...base, id: '1', studentName: 'Sofía' })
    const ana = apiBooking({ ...base, id: '2', studentName: 'Ana' })
    const fuera = apiBooking({ ...base, id: '3', studentName: 'Beto', status: 'cancelada' })
    const otra = apiBooking({ ...base, id: '4', startTime: '13:00' })

    expect(classSiblings(sofia, [sofia, ana, fuera, otra]).map((c) => c.id)).toEqual(['2', '1'])
  })
})

describe('orderClassRows', () => {
  it('las en pie primero y las canceladas al final, cada grupo por nombre', () => {
    const rows = [
      apiBooking({ id: 'z', studentName: 'Zoe', status: 'cancelada' }),
      apiBooking({ id: 's', studentName: 'Sofía' }),
      apiBooking({ id: 'b', studentName: 'Beto', status: 'cancelada' }),
      apiBooking({ id: 'a', studentName: 'Ana' }),
    ]
    expect(orderClassRows(rows).map((c) => c.id)).toEqual(['a', 's', 'b', 'z'])
  })
})

describe('filterClasses', () => {
  const grupal = { teacherId: 't1', date: '2099-09-20', startTime: '10:00', maxStudents: 3 }
  const mate = { subjectId: 'mate', subjectName: 'Matemática' }
  const bookings = [
    apiBooking({ ...grupal, ...mate, id: 'g1', studentName: 'Sofía Ramírez' }),
    apiBooking({ ...grupal, ...mate, id: 'g2', studentName: 'Ana Pérez' }),
    apiBooking({
      id: 'f',
      date: '2099-09-05',
      subjectId: 'fisica',
      subjectName: 'Física',
      teacherName: 'Carla Benítez',
      studentName: 'Tomás Díaz',
    }),
  ]
  const entries = groupClasses(bookings)
  const ids = (list) => list.map((entry) => entry.cls.id).sort()
  const filtrar = (filters, role = 'teacher') =>
    ids(filterClasses(entries, { ...EMPTY_FILTERS, ...filters }, role))

  it('sin filtros, todo', () => {
    expect(filtrar({})).toEqual(['f', 'g2'])
  })

  it('por materia', () => {
    expect(filtrar({ subjectId: 'fisica' })).toEqual(['f'])
  })

  it('por fecha, con las dos puntas incluidas', () => {
    expect(filtrar({ from: '2099-09-05', to: '2099-09-05' })).toEqual(['f'])
    expect(filtrar({ from: '2099-09-06' })).toEqual(['g2'])
    expect(filtrar({ to: '2099-09-19' })).toEqual(['f'])
  })

  it('el docente busca por cualquier alumno de la clase, sin tildes', () => {
    expect(filtrar({ name: 'ramirez' })).toEqual(['g2'])
    expect(filtrar({ name: 'TOMÁS' })).toEqual(['f'])
  })

  it('el alumno busca por el docente', () => {
    expect(filtrar({ name: 'benitez' }, 'student')).toEqual(['f'])
    expect(filtrar({ name: 'ramirez' }, 'student')).toEqual([])
  })

  it('lista las materias de la categoría, sin repetir', () => {
    expect(subjectsOf(entries)).toEqual([
      { id: 'fisica', name: 'Física' },
      { id: 'mate', name: 'Matemática' },
    ])
  })
})

describe('withClassMaterial', () => {
  it('marca el material en las reservas en pie de la clase, no en las canceladas ni en otros', () => {
    const base = { teacherId: 't1', date: '2099-09-14', startTime: '11:00', maxStudents: 3 }
    const ana = apiBooking({ ...base, id: 'a', status: 'realizada', hasMaterial: false })
    const beto = apiBooking({ ...base, id: 'b', status: 'cancelada', hasMaterial: false })
    const otra = apiBooking({ ...base, id: 'c', startTime: '13:00', status: 'realizada', hasMaterial: false })

    const porId = Object.fromEntries(
      withClassMaterial([ana, beto, otra], ana, true).map((c) => [c.id, c.hasMaterial]),
    )
    expect(porId).toEqual({ a: true, b: false, c: false })
  })
})

describe('classPriceLabel', () => {
  it('un solo monto si todos los alumnos pagan lo mismo', () => {
    const rows = [apiBooking({ id: 'a', priceCents: 500000 }), apiBooking({ id: 'b', priceCents: 500000 })]
    expect(classPriceLabel(rows)).toMatch(/^\$\s5\.000$/)
  })

  it('un rango si cada uno paga distinto, sin contar a los que se bajaron', () => {
    const rows = [
      apiBooking({ id: 'a', priceCents: 500000 }),
      apiBooking({ id: 'b', priceCents: 250000, packTokens: 1 }),
      apiBooking({ id: 'c', priceCents: 0, status: 'cancelada' }),
    ]
    expect(classPriceLabel(rows)).toMatch(/^\$\s2\.500 – \$\s5\.000$/)
  })
})

describe('activeRows', () => {
  it('saca solo las canceladas', () => {
    const filas = [
      apiBooking({ id: 'a', status: 'pendiente' }),
      apiBooking({ id: 'b', status: 'cancelada' }),
      apiBooking({ id: 'c', status: 'realizada' }),
    ]
    expect(activeRows(filas).map((row) => row.id)).toEqual(['a', 'c'])
  })
})

describe('calendarClasses', () => {
  it('una entrada por clase, sin las canceladas para todos', () => {
    const grupal = { startTime: '10:00', maxStudents: 3 }
    const clases = [
      apiBooking({ ...grupal, id: 'g1', studentName: 'Bea', status: 'confirmada' }),
      apiBooking({ ...grupal, id: 'g2', studentName: 'Ana', status: 'cancelada' }),
      apiBooking({ id: 'x', startTime: '15:00', status: 'cancelada' }),
    ]
    const entradas = calendarClasses(clases)
    expect(entradas).toHaveLength(1)
    expect(entradas[0]).toMatchObject({ id: 'g1', classKey: entradas[0].classId })
    expect(entradas[0].rows.map((row) => row.id)).toEqual(['g1', 'g2'])
  })

  it('dos clases distintas en el mismo horario no se mezclan (agrupa por classId)', () => {
    // La de las 10 se canceló para todos y después se reservó otra a esa hora.
    const vieja = apiBooking({ id: 'v', classId: 'k-vieja', startTime: '10:00', status: 'cancelada' })
    const nueva = apiBooking({ id: 'n', classId: 'k-nueva', startTime: '10:00', status: 'confirmada' })
    const clases = calendarClasses([vieja, nueva])
    expect(clases.map((clase) => clase.id)).toEqual(['n'])
    expect(clases[0].rows.map((row) => row.id)).toEqual(['n'])
  })
})

describe('pendingClassCount', () => {
  it('cuenta clases con alguna reserva pendiente, no reservas', () => {
    const grupal = { startTime: '10:00', maxStudents: 3, status: 'pendiente' }
    const clases = [
      apiBooking({ ...grupal, id: 'g1' }),
      apiBooking({ ...grupal, id: 'g2' }),
      apiBooking({ ...grupal, id: 'g3' }),
      apiBooking({ id: 'i', startTime: '15:00', status: 'pendiente' }),
      apiBooking({ id: 'c', startTime: '17:00', status: 'confirmada' }),
    ]
    expect(pendingClassCount(clases)).toBe(2)
  })
})

describe('classCapacityLabel', () => {
  it('individual', () => {
    expect(classCapacityLabel(apiBooking(), null, 'teacher')).toBe('Individual')
  })

  it('el docente cuenta las reservas en pie de la clase', () => {
    const cls = apiBooking({ maxStudents: 4 })
    const filas = [cls, apiBooking({ id: 'c2', maxStudents: 4, status: 'cancelada' })]
    expect(classCapacityLabel(cls, filas, 'teacher')).toBe('Grupal · 1 de 4')
  })

  it('el alumno ve `enrolled`', () => {
    expect(classCapacityLabel(apiBooking({ maxStudents: 4, enrolled: 3 }), null, 'student')).toBe(
      'Grupal · 3 de 4',
    )
  })
})
