import {
  capacityLabel,
  draftFromWindow,
  draftToPayload,
  emptyDraft,
  formatMinutes,
  formatPrice,
  formatWeekTitle,
  occursOn,
  parsePrice,
  repeatLabel,
  startOfWeek,
  validateDraft,
  visibleHours,
  weekDates,
  windowsOn,
} from './windows.js'
import { toISODate } from './calendar.js'

// 2026-09-14 es lunes.
const ventana = (over = {}) => ({
  id: 'w1',
  date: '2026-09-14',
  repeatsWeekly: false,
  start: '13:00',
  end: '15:00',
  subjectId: 's1',
  subjectName: 'Matemática',
  durationMinutes: 60,
  price: 15000,
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  address: null,
  ...over,
})

const borrador = (over = {}) => ({
  ...emptyDraft({ date: '2026-09-14', subjectId: 's1' }),
  meetingUrl: 'https://meet.example.com/abc',
  price: '15000',
  ...over,
})

describe('occursOn / windowsOn', () => {
  it('una suelta cae solo en su fecha', () => {
    expect(occursOn(ventana(), '2026-09-14')).toBe(true)
    expect(occursOn(ventana(), '2026-09-21')).toBe(false)
  })

  it('una semanal se repite desde su fecha, nunca antes', () => {
    const semanal = ventana({ repeatsWeekly: true })
    expect(occursOn(semanal, '2026-09-21')).toBe(true)
    expect(occursOn(semanal, '2026-09-15')).toBe(false)
    expect(occursOn(semanal, '2026-09-07')).toBe(false)
  })

  it('ordena las del día por hora', () => {
    const tarde = ventana({ id: 'w2', start: '18:00', end: '19:00' })
    const temprano = ventana({ id: 'w3', start: '08:00', end: '09:00' })
    expect(windowsOn([tarde, ventana(), temprano], '2026-09-14').map((w) => w.id)).toEqual([
      'w3',
      'w1',
      'w2',
    ])
  })
})

describe('semanas', () => {
  it('la semana arranca el lunes', () => {
    expect(toISODate(startOfWeek(new Date(2026, 8, 20)))).toBe('2026-09-14')
    expect(toISODate(startOfWeek(new Date(2026, 8, 14)))).toBe('2026-09-14')
    expect(weekDates(new Date(2026, 8, 14)).map(toISODate)).toHaveLength(7)
  })

  it('el título dice el mes una vez, o los dos si la semana cruza', () => {
    expect(formatWeekTitle(new Date(2026, 8, 14))).toBe('14 – 20 de septiembre de 2026')
    expect(formatWeekTitle(new Date(2026, 8, 28))).toBe('28 de septiembre – 4 de octubre de 2026')
  })
})

describe('textos', () => {
  it('formatMinutes', () => {
    expect(formatMinutes(30)).toBe('30 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(90)).toBe('1 h 30 min')
  })

  it('capacityLabel', () => {
    expect(capacityLabel(1)).toBe('Individual')
    expect(capacityLabel(4)).toBe('Grupal · hasta 4')
  })

  it('repeatLabel usa el plural del día', () => {
    expect(repeatLabel(ventana())).toBe('Todos los lunes')
    expect(repeatLabel(ventana({ date: '2026-09-19' }))).toBe('Todos los sábados')
  })
})

describe('visibleHours', () => {
  it('muestra de 8 a 20 como mínimo', () => {
    expect(visibleHours([])).toEqual({ from: 8, to: 20 })
  })

  it('se estira para que entre todo', () => {
    expect(visibleHours([ventana({ start: '06:30', end: '24:00' })])).toEqual({ from: 6, to: 24 })
  })
})

describe('precio', () => {
  it('se muestra en pesos, y 0 es sin cargo', () => {
    // Intl separa el signo con un espacio duro: se compara sin espacios.
    expect(formatPrice(15000).replace(/\s/g, ' ')).toBe('$ 15.000')
    expect(formatPrice(0)).toBe('Sin cargo')
  })

  it('acepta como se escribe un monto acá, sin centavos', () => {
    expect(parsePrice('15000')).toBe(15000)
    expect(parsePrice('15.000')).toBe(15000)
    expect(parsePrice('$ 15.000')).toBe(15000)
    expect(parsePrice('1500,50')).toBeNaN()
    expect(parsePrice('')).toBeNaN()
  })
})

describe('borrador <-> ventana', () => {
  it('duración y precio se editan como texto y se mandan como número', () => {
    expect(draftFromWindow(ventana())).toMatchObject({ durationMinutes: '60', price: '15000' })
    expect(draftToPayload(borrador({ durationMinutes: '45', price: '12.500' }))).toMatchObject({
      durationMinutes: 45,
      price: 12500,
    })
  })

  it('una grupal conserva el cupo; una individual arranca con el mínimo de grupo', () => {
    expect(draftFromWindow(ventana({ maxStudents: 5 }))).toMatchObject({ group: true, groupSize: '5' })
    expect(draftFromWindow(ventana())).toMatchObject({ group: false, groupSize: '2' })
  })

  it('individual se manda con cupo 1, aunque haya un número escrito', () => {
    expect(draftToPayload(borrador({ group: false, groupSize: '8' })).maxStudents).toBe(1)
    expect(draftToPayload(borrador({ group: true, groupSize: '8' })).maxStudents).toBe(8)
  })

  it('no manda la ubicación que la modalidad no usa', () => {
    const presencial = draftToPayload(
      borrador({ modality: 'in_person', address: ' Aula 3 ', meetingUrl: 'https://x.com' }),
    )
    expect(presencial).toMatchObject({ address: 'Aula 3', meetingUrl: '' })
  })
})

describe('validateDraft', () => {
  it('un borrador completo no tiene errores', () => {
    expect(validateDraft(borrador())).toEqual({})
  })

  it('pide materia, link y dirección según la modalidad', () => {
    expect(validateDraft(borrador({ subjectId: '' }))).toHaveProperty('subjectId')
    expect(validateDraft(borrador({ meetingUrl: '' }))).toHaveProperty('meetingUrl')
    expect(validateDraft(borrador({ meetingUrl: 'meet' }))).toHaveProperty('meetingUrl')
    const hibrida = validateDraft(borrador({ modality: 'hybrid', address: '' }))
    expect(hibrida).toHaveProperty('address')
  })

  it('una grupal necesita entre 2 y 50', () => {
    expect(validateDraft(borrador({ group: true, groupSize: '1' }))).toHaveProperty('groupSize')
    expect(validateDraft(borrador({ group: true, groupSize: '51' }))).toHaveProperty('groupSize')
    expect(validateDraft(borrador({ group: true, groupSize: '4' }))).toEqual({})
  })

  it('la duración es libre, desde 30 minutos y sin pasarse del horario', () => {
    expect(validateDraft(borrador({ durationMinutes: '45' }))).toEqual({})
    expect(validateDraft(borrador({ durationMinutes: '29' }))).toHaveProperty('durationMinutes')
    expect(validateDraft(borrador({ durationMinutes: 'una hora' }))).toHaveProperty(
      'durationMinutes',
    )
    const larga = validateDraft(borrador({ start: '09:00', end: '10:00', durationMinutes: '90' }))
    expect(larga.durationMinutes).toBe('No entra en el horario, que dura 1 h.')
  })

  it('pide el precio, que puede ser 0', () => {
    expect(validateDraft(borrador({ price: '' }))).toHaveProperty('price')
    expect(validateDraft(borrador({ price: 'mil' }))).toHaveProperty('price')
    expect(validateDraft(borrador({ price: '0' }))).toEqual({})
  })
})
