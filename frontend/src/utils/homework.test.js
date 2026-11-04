import { apiHomework, apiSubmission } from '../testing/fixtures.js'
import {
  isPastDue,
  isSafeLink,
  sortStudentHomeworks,
  submissionCounts,
  submissionStatus,
  targetLabel,
} from './homework.js'

const NOW = { iso: '2099-09-20', time: '12:00' }

describe('isPastDue', () => {
  it('el minuto del vencimiento todavía está en término', () => {
    expect(isPastDue({ dueDate: '2099-09-20', dueTime: '12:00' }, NOW)).toBe(false)
    expect(isPastDue({ dueDate: '2099-09-20', dueTime: '11:59' }, NOW)).toBe(true)
  })
})

describe('isSafeLink', () => {
  it('solo deja pasar enlaces web', () => {
    expect(isSafeLink('https://x.com')).toBe(true)
    expect(isSafeLink('javascript:alert(1)')).toBe(false)
    expect(isSafeLink('hola')).toBe(false)
  })
})

describe('submissionStatus', () => {
  const homework = apiHomework()

  it('sin entregar: pendiente, y vencida al pasar la fecha', () => {
    expect(submissionStatus(homework, apiSubmission(), NOW).label).toBe('Pendiente')
    expect(
      submissionStatus(apiHomework({ dueDate: '2099-09-19' }), apiSubmission(), NOW).label,
    ).toBe('Vencida')
  })

  it('entregada y corregida', () => {
    const entregada = apiSubmission({ submittedAt: '2099-09-20T12:00:00.000Z' })
    expect(submissionStatus(homework, entregada, NOW).label).toBe('Entregada')
    expect(
      submissionStatus(homework, { ...entregada, correctedAt: '2099-09-21T12:00:00.000Z' }, NOW)
        .label,
    ).toBe('Corregida')
  })
})

describe('targetLabel', () => {
  it('nombra al alumno o a la clase', () => {
    expect(targetLabel(apiHomework({ submissions: [apiSubmission()] }))).toBe('Sofía Ramírez')
    expect(
      targetLabel(
        apiHomework({ classDate: '2099-09-14', classStartTime: '13:00', subjectName: 'Física' }),
      ),
    ).toContain('Clase grupal de Física')
  })
})

describe('submissionCounts', () => {
  it('cuenta las entregadas y las que esperan corrección', () => {
    const submissions = [
      apiSubmission({ id: '1' }),
      apiSubmission({ id: '2', submittedAt: 'x' }),
      apiSubmission({ id: '3', submittedAt: 'x', correctedAt: 'y' }),
    ]
    expect(submissionCounts({ submissions })).toEqual({ total: 3, entregadas: 2, porCorregir: 1 })
  })
})

describe('sortStudentHomeworks', () => {
  it('lo pendiente primero y lo más urgente arriba', () => {
    const tareas = [
      apiHomework({ id: 'hecha', submission: apiSubmission({ submittedAt: 'x' }) }),
      apiHomework({ id: 'lejos', dueDate: '2099-10-01', submission: apiSubmission() }),
      apiHomework({ id: 'cerca', dueDate: '2099-09-15', submission: apiSubmission() }),
    ]
    expect(sortStudentHomeworks(tareas).map((tarea) => tarea.id)).toEqual([
      'cerca',
      'lejos',
      'hecha',
    ])
  })
})
