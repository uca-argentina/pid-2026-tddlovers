import {
  allowedActions,
  cancelDeadlineHint,
  cancelDescription,
  owesPayment,
  statusLabel,
} from './classStates.js'

// La clase es el lunes 14/9/2099 a las 13:00.
const clase = (over = {}) => ({
  date: '2099-09-14',
  startTime: '13:00',
  status: 'pendiente',
  paidAt: null,
  ...over,
})

const LEJOS = { iso: '2099-09-10', time: '10:00' }
const JUSTO_24H = { iso: '2099-09-13', time: '13:00' }
const CASI = { iso: '2099-09-13', time: '13:01' }
const EMPEZADA = { iso: '2099-09-14', time: '13:00' }

describe('allowedActions', () => {
  it('pendiente: el docente acepta o rechaza, el alumno la retira', () => {
    expect(allowedActions(clase(), 'teacher', LEJOS)).toEqual(['accept', 'cancel'])
    expect(allowedActions(clase(), 'student', CASI)).toEqual(['cancel'])
  })

  it('aceptada: el alumno paga, y cancela solo con 24 h', () => {
    expect(allowedActions(clase({ status: 'aceptada' }), 'student', JUSTO_24H)).toEqual([
      'cancel',
      'pay',
    ])
    expect(allowedActions(clase({ status: 'aceptada' }), 'student', CASI)).toEqual(['pay'])
  })

  it('confirmada: reprogramar con 24 h, y el docente toma lista desde que empieza', () => {
    expect(allowedActions(clase({ status: 'confirmada', paidAt: 'x' }), 'student', LEJOS)).toEqual([
      'cancel',
      'reschedule',
    ])
    expect(allowedActions(clase({ status: 'confirmada', paidAt: 'x' }), 'teacher', EMPEZADA)).toEqual([
      'attend',
    ])
  })

  it('una clase dada sin pagar todavía se paga', () => {
    expect(allowedActions(clase({ status: 'realizada' }), 'student', EMPEZADA)).toEqual(['pay'])
    expect(owesPayment(clase({ status: 'realizada' }))).toBe(true)
    expect(owesPayment(clase({ status: 'realizada', paidAt: 'x' }))).toBe(false)
  })

  it('cancelada no admite nada', () => {
    expect(allowedActions(clase({ status: 'cancelada' }), 'teacher', LEJOS)).toEqual([])
    expect(allowedActions(clase({ status: 'cancelada' }), 'student', LEJOS)).toEqual([])
  })
})

describe('textos', () => {
  it('etiquetas en castellano', () => {
    expect(statusLabel('no_presentada')).toBe('No presentada')
  })

  it('dice quién canceló, desde quien mira', () => {
    const rechazada = clase({ status: 'cancelada', cancelReason: 'rechazada', cancelledBy: 'teacher' })
    expect(cancelDescription(rechazada, 'student')).toBe('El docente rechazó la reserva.')
    expect(cancelDescription(rechazada, 'teacher')).toBe('La rechazaste.')

    const delAlumno = clase({ status: 'cancelada', cancelReason: 'cancelada', cancelledBy: 'student' })
    expect(cancelDescription(delAlumno, 'student')).toBe('La cancelaste vos.')
    expect(cancelDescription(delAlumno, 'teacher')).toBe('La canceló el alumno.')

    expect(cancelDescription(clase({ status: 'cancelada', cancelReason: 'vencida' }), 'student')).toMatch(
      /no respondió/,
    )
    expect(cancelDescription(clase({ status: 'pendiente' }), 'student')).toBeNull()
  })

  it('avisa hasta cuándo se puede cancelar', () => {
    // Exactamente 24 h antes. La coma después del día la pone Intl y depende
    // del ICU del entorno.
    expect(cancelDeadlineHint(clase({ status: 'confirmada' }), LEJOS)).toMatch(
      /^Podés cancelar o reprogramar hasta el domingo,? 13 de septiembre a las 13:00\.$/,
    )
    expect(cancelDeadlineHint(clase({ status: 'confirmada' }), CASI)).toMatch(/menos de 24 h/)
    expect(cancelDeadlineHint(clase(), LEJOS)).toBeNull()
  })
})
