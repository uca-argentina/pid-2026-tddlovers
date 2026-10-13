import { describe, expect, it } from 'vitest'
import { apiClass } from '../testing/fixtures.js'
import {
  CATEGORIES,
  EMPTY_FILTERS,
  filterTurns,
  groupTurns,
  lastClass,
  nextClass,
  subjectsOf,
  turnSiblings,
  turnsIn,
} from './reservations.js'

const category = (key) => CATEGORIES.find((c) => c.key === key)
const AHORA = { iso: '2099-09-14', time: '11:35' }

describe('turnsIn', () => {
  const classes = [
    apiClass({ id: 'lejos', status: 'pendiente', date: '2099-10-01' }),
    apiClass({ id: 'cerca', status: 'pendiente', date: '2099-09-20' }),
    apiClass({ id: 'vieja', status: 'realizada', date: '2099-08-01' }),
    apiClass({ id: 'nueva', status: 'no_presentada', date: '2099-09-01' }),
    apiClass({ id: 'cancel', status: 'cancelada' }),
  ]
  const ids = (turns) => turns.map((turn) => turn.cls.id)

  it('en las que vienen, la más cercana primero', () => {
    expect(ids(turnsIn(category('pendiente'), groupTurns(classes)))).toEqual(['cerca', 'lejos'])
  })

  it('finalizadas junta realizadas y no presentadas, la más nueva primero', () => {
    expect(ids(turnsIn(category('finalizada'), groupTurns(classes)))).toEqual(['nueva', 'vieja'])
  })

  it('solo las pendientes, aceptadas y confirmadas muestran la cantidad', () => {
    expect(CATEGORIES.filter((c) => c.showCount).map((c) => c.key)).toEqual([
      'pendiente',
      'aceptada',
      'confirmada',
    ])
  })
})

describe('groupTurns', () => {
  const base = { teacherId: 't1', date: '2099-09-20', startTime: '10:00', maxStudents: 3 }
  const sofia = apiClass({ ...base, id: '1', studentName: 'Sofía', status: 'confirmada' })
  const ana = apiClass({ ...base, id: '2', studentName: 'Ana', status: 'pendiente' })
  const beto = apiClass({ ...base, id: '3', studentName: 'Beto', status: 'cancelada' })

  it('una grupal es una sola clase, con los que siguen primero', () => {
    const [turn] = groupTurns([sofia, beto, ana])
    expect(turn.rows.map((r) => r.id)).toEqual(['2', '1', '3'])
    expect(turn.active.map((r) => r.id)).toEqual(['2', '1'])
    expect(turn.cls.id).toBe('2')
  })

  it('con un alumno pendiente y otro confirmado aparece en las dos categorías, no en canceladas', () => {
    const turns = groupTurns([sofia, ana, beto])
    expect(turnsIn(category('pendiente'), turns)).toHaveLength(1)
    expect(turnsIn(category('confirmada'), turns)).toHaveLength(1)
    expect(turnsIn(category('cancelada'), turns)).toHaveLength(0)
  })

  it('en canceladas solo la que se canceló para todos', () => {
    const todos = groupTurns([{ ...sofia, status: 'cancelada' }, beto])
    expect(turnsIn(category('cancelada'), todos)).toHaveLength(1)
  })
})

describe('nextClass y lastClass', () => {
  const terminada = apiClass({ id: 'terminada', status: 'confirmada', startTime: '09:00', endTime: '10:00' })
  const enCurso = apiClass({ id: 'en-curso', status: 'confirmada', startTime: '11:00', endTime: '12:30' })
  const despues = apiClass({ id: 'despues', status: 'pendiente', startTime: '16:00', endTime: '17:00' })
  const cancelada = apiClass({ id: 'cancelada', status: 'cancelada', startTime: '10:30', endTime: '11:30' })
  const ayer = apiClass({ id: 'ayer', status: 'realizada', date: '2099-09-13' })
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

describe('turnSiblings', () => {
  it('las reservas no canceladas del mismo turno', () => {
    const base = { teacherId: 't1', date: '2099-09-14', startTime: '11:00', maxStudents: 3 }
    const sofia = apiClass({ ...base, id: '1', studentName: 'Sofía' })
    const ana = apiClass({ ...base, id: '2', studentName: 'Ana' })
    const fuera = apiClass({ ...base, id: '3', studentName: 'Beto', status: 'cancelada' })
    const otra = apiClass({ ...base, id: '4', startTime: '13:00' })

    expect(turnSiblings(sofia, [sofia, ana, fuera, otra]).map((c) => c.id)).toEqual(['2', '1'])
  })
})

describe('filterTurns', () => {
  const grupal = { teacherId: 't1', date: '2099-09-20', startTime: '10:00', maxStudents: 3 }
  const mate = { subjectId: 'mate', subjectName: 'Matemática' }
  const classes = [
    apiClass({ ...grupal, ...mate, id: 'g1', studentName: 'Sofía Ramírez' }),
    apiClass({ ...grupal, ...mate, id: 'g2', studentName: 'Ana Pérez' }),
    apiClass({
      id: 'f',
      date: '2099-09-05',
      subjectId: 'fisica',
      subjectName: 'Física',
      teacherName: 'Carla Benítez',
      studentName: 'Tomás Díaz',
    }),
  ]
  const turns = groupTurns(classes)
  const ids = (list) => list.map((turn) => turn.cls.id).sort()
  const filtrar = (filters, role = 'teacher') =>
    ids(filterTurns(turns, { ...EMPTY_FILTERS, ...filters }, role))

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
    expect(subjectsOf(turns)).toEqual([
      { id: 'fisica', name: 'Física' },
      { id: 'mate', name: 'Matemática' },
    ])
  })
})
