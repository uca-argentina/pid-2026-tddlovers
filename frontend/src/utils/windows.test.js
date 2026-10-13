import {
  capacityLabel,
  draftFromWindow,
  draftToPayload,
  emptyDraft,
  formatMinutes,
  formatWeekTitle,
  modalityPlural,
  NEW_ADDRESS,
  occursOn,
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
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  locality: null,
  address: null,
  ...over,
})

// Una dirección como la manda la API colgada de la ventana.
const direccion = (over = {}) => ({
  id: 'a1',
  label: 'Casa',
  street: 'Av. Corrientes',
  number: '1234',
  postalCode: '1043',
  locality: 'Balvanera',
  city: 'CABA',
  floor: null,
  apartment: null,
  notes: null,
  saved: true,
  isDefault: true,
  ...over,
})

const nueva = {
  label: '',
  street: 'Honduras',
  number: '4800',
  postalCode: '1414',
  locality: 'Palermo',
  city: 'CABA',
  floor: '',
  apartment: '',
  notes: '',
}

const borrador = (over = {}) => ({
  ...emptyDraft({ date: '2026-09-14' }),
  meetingUrl: 'https://meet.example.com/abc',
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

describe('borrador <-> ventana', () => {
  it('la ventana no lleva materia, duración ni precio: los elige el alumno', () => {
    const payload = draftToPayload(draftFromWindow(ventana()))
    expect(Object.keys(payload).sort()).toEqual([
      'date',
      'end',
      'maxStudents',
      'meetingUrl',
      'modality',
      'repeatsWeekly',
      'start',
    ])
  })

  it('un borrador nuevo arranca en la modalidad que se le pida', () => {
    expect(emptyDraft({ date: '2026-09-14', modality: 'in_person' }).modality).toBe('in_person')
    expect(emptyDraft({ date: '2026-09-14' }).modality).toBe('virtual')
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
      borrador({ modality: 'in_person', addressChoice: 'a1', meetingUrl: 'https://x.com' }),
    )
    expect(presencial).toMatchObject({ addressId: 'a1', meetingUrl: '' })
    const virtual = draftToPayload(borrador({ addressChoice: 'a1' }))
    expect(virtual).not.toHaveProperty('addressId')
    expect(virtual).not.toHaveProperty('address')
  })

  it('una ventana nueva arranca con la dirección predeterminada, o cargando una', () => {
    expect(emptyDraft({ date: '2026-09-14', defaultAddressId: 'a1' }).addressChoice).toBe('a1')
    expect(emptyDraft({ date: '2026-09-14' }).addressChoice).toBe(NEW_ADDRESS)
  })

  it('una dirección nueva se manda entera, con si hay que guardarla', () => {
    const payload = draftToPayload(
      borrador({
        modality: 'in_person',
        addressChoice: NEW_ADDRESS,
        newAddress: { ...nueva, street: ' Honduras ', label: 'Escuela' },
        saveAddress: true,
      }),
    )
    expect(payload).toMatchObject({
      saveAddress: true,
      address: { street: 'Honduras', label: 'Escuela', postalCode: '1414' },
    })
    expect(payload).not.toHaveProperty('addressId')
  })

  it('al editar, una guardada se elige y una suelta vuelve con sus campos', () => {
    const guardada = draftFromWindow(ventana({ modality: 'in_person', address: direccion() }))
    expect(guardada.addressChoice).toBe('a1')
    const suelta = draftFromWindow(
      ventana({ modality: 'in_person', address: direccion({ saved: false, label: null, floor: '2' }) }),
    )
    expect(suelta.addressChoice).toBe(NEW_ADDRESS)
    expect(suelta.newAddress).toMatchObject({ street: 'Av. Corrientes', floor: '2', label: '' })
  })
})

describe('validateDraft', () => {
  it('un borrador completo no tiene errores', () => {
    expect(validateDraft(borrador())).toEqual({})
  })

  it('pide link y dirección según la modalidad', () => {
    expect(validateDraft(borrador({ meetingUrl: '' }))).toHaveProperty('meetingUrl')
    expect(validateDraft(borrador({ meetingUrl: 'meet' }))).toHaveProperty('meetingUrl')
    const sinElegir = validateDraft(borrador({ modality: 'hybrid', addressChoice: '' }))
    expect(sinElegir.addressId).toBe('Elegí una dirección.')
    const incompleta = validateDraft(
      borrador({ modality: 'hybrid', addressChoice: NEW_ADDRESS, newAddress: { ...nueva, city: '' } }),
    )
    expect(incompleta.address).toEqual({ city: 'Completalo.' })
    const sinNombre = validateDraft(
      borrador({ modality: 'in_person', addressChoice: NEW_ADDRESS, newAddress: nueva, saveAddress: true }),
    )
    expect(sinNombre.address).toHaveProperty('label')
  })

  it('una grupal necesita entre 2 y 50', () => {
    expect(validateDraft(borrador({ group: true, groupSize: '1' }))).toHaveProperty('groupSize')
    expect(validateDraft(borrador({ group: true, groupSize: '51' }))).toHaveProperty('groupSize')
    expect(validateDraft(borrador({ group: true, groupSize: '4' }))).toEqual({})
  })

  it('no deja una modalidad en la que el docente no tiene tarifas', () => {
    const tarifas = { rateModalities: ['in_person'] }
    expect(validateDraft(borrador(), tarifas).modality).toBe('No tenés tarifas para clases virtuales.')
    const presencial = borrador({ modality: 'in_person', addressChoice: 'a1' })
    expect(validateDraft(presencial, tarifas)).toEqual({})
  })

  it('sin la lista de tarifas no chequea la modalidad', () => {
    expect(validateDraft(borrador())).toEqual({})
  })
})

describe('modalityPlural', () => {
  it('nombra la modalidad en plural', () => {
    expect(modalityPlural('virtual')).toBe('virtuales')
    expect(modalityPlural('in_person')).toBe('presenciales')
    expect(modalityPlural('hybrid')).toBe('híbridas')
  })
})
