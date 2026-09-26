import {
  centsToInput,
  classPriceCents,
  durationOptions,
  formatHourlyRate,
  formatMoney,
  parseMoney,
  rateModalities,
  ratesForModality,
  resolveRates,
} from './rates.js'

// Intl separa el signo con un espacio duro: se compara normalizado.
const plano = (text) => text.replace(/\s/g, ' ')

describe('formatMoney', () => {
  it('muestra pesos, con centavos solo si hay', () => {
    expect(plano(formatMoney(500000))).toBe('$ 5.000')
    expect(plano(formatMoney(416667))).toBe('$ 4.166,67')
    expect(plano(formatMoney(500050))).toBe('$ 5.000,50')
  })

  it('0 es sin cargo', () => {
    expect(formatMoney(0)).toBe('Sin cargo')
  })
})

describe('formatHourlyRate', () => {
  it('agrega la hora', () => {
    expect(plano(formatHourlyRate(500000))).toBe('$ 5.000/h')
    expect(formatHourlyRate(0)).toBe('Sin cargo')
  })
})

describe('parseMoney', () => {
  it('acepta cómo se escribe un monto acá y devuelve centavos', () => {
    expect(parseMoney('5000')).toBe(500000)
    expect(parseMoney('5.000')).toBe(500000)
    expect(parseMoney('$ 5.000')).toBe(500000)
    expect(parseMoney('5.000,5')).toBe(500050)
    expect(parseMoney('5000,05')).toBe(500005)
    expect(parseMoney('0')).toBe(0)
  })

  it('rechaza lo que no es un monto', () => {
    expect(parseMoney('')).toBeNaN()
    expect(parseMoney('mil')).toBeNaN()
    expect(parseMoney('5000,555')).toBeNaN()
    expect(parseMoney('-5')).toBeNaN()
  })

  it('ida y vuelta con centsToInput', () => {
    expect(centsToInput(500000)).toBe('5000')
    expect(centsToInput(500050)).toBe('5000,50')
    expect(centsToInput(5)).toBe('0,05')
    expect(parseMoney(centsToInput(123456))).toBe(123456)
  })
})

describe('classPriceCents', () => {
  it('la parte proporcional de la tarifa, al centavo (igual que el backend)', () => {
    expect(classPriceCents(500000, 60)).toBe(500000)
    expect(classPriceCents(500000, 50)).toBe(416667)
    expect(classPriceCents(0, 90)).toBe(0)
  })
})

describe('durationOptions', () => {
  it('de 30 minutos hasta el máximo, de a 5', () => {
    expect(durationOptions(50)).toEqual([30, 35, 40, 45, 50])
    expect(durationOptions(30)).toEqual([30])
    expect(durationOptions(25)).toEqual([])
  })
})

describe('tarifas del docente', () => {
  const rates = [
    { subjectId: 3, modality: 'virtual', hourlyRateCents: 600000 },
    { subjectId: 1, modality: 'virtual', hourlyRateCents: 500000 },
    { subjectId: 1, modality: 'in_person', hourlyRateCents: 700000 },
  ]
  const catalogo = [
    { id: 1, name: 'Matemática' },
    { id: 3, name: 'Álgebra' },
  ]

  it('rateModalities: sin repetir', () => {
    expect(rateModalities(rates)).toEqual(['virtual', 'in_person'])
    expect(rateModalities(undefined)).toEqual([])
  })

  it('resolveRates les pone nombre y las ordena por materia', () => {
    expect(resolveRates(rates, catalogo).map((rate) => rate.subjectName)).toEqual([
      'Álgebra',
      'Matemática',
      'Matemática',
    ])
  })

  it('sin catálogo no rompe', () => {
    expect(resolveRates(rates, [])[0].subjectName).toBe('Materia')
  })

  it('ratesForModality filtra por modalidad', () => {
    const presenciales = ratesForModality(resolveRates(rates, catalogo), 'in_person')
    expect(presenciales).toHaveLength(1)
    expect(presenciales[0]).toMatchObject({ subjectName: 'Matemática', hourlyRateCents: 700000 })
  })
})
