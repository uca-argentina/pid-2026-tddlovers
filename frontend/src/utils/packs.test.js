import { packsForReschedule, quoteBooking, usablePackFor } from './packs.js'

// Un paquete de clases de 1 h con 2 para reservar.
const paquete = (overrides = {}) => ({
  id: 'p1',
  teacherId: 't1',
  classMinutes: 60,
  available: 2,
  expiresOn: '2099-12-31',
  expired: false,
  ...overrides,
})

const MATE = 500000

describe('quoteBooking', () => {
  it('sin paquete ni canje cobra tarifa × duración', () => {
    expect(quoteBooking({ hourlyRateCents: MATE, minutes: 50 })).toEqual({
      maxTokens: 0,
      tokens: 0,
      extraMinutes: 50,
      reward: null,
      priceCents: 416667,
      coveredBy: null,
    })
  })

  it('sin materia o sin duración no hay precio', () => {
    expect(quoteBooking({ minutes: 60 }).priceCents).toBeNull()
    expect(quoteBooking({ hourlyRateCents: MATE }).priceCents).toBeNull()
  })

  it('con paquete usa todas las que entran y cobra solo lo que se pasa', () => {
    const quote = quoteBooking({ hourlyRateCents: MATE, minutes: 90, pack: paquete() })
    expect(quote).toMatchObject({ maxTokens: 1, tokens: 1, extraMinutes: 30, priceCents: 250000 })
    expect(quote.coveredBy).toBeNull()
  })

  it('respeta las que eligió, recortadas a lo que entra', () => {
    const pack = paquete()
    expect(quoteBooking({ hourlyRateCents: MATE, minutes: 120, pack, packTokens: 0 })).toMatchObject(
      { tokens: 0, priceCents: 1000000 },
    )
    expect(quoteBooking({ hourlyRateCents: MATE, minutes: 60, pack, packTokens: 2 })).toMatchObject({
      tokens: 1,
      priceCents: 0,
      coveredBy: 'pack',
    })
  })

  it('un canje válido gana sobre el paquete y deja lo que cuesta con él', () => {
    const quote = quoteBooking({
      hourlyRateCents: MATE,
      minutes: 60,
      pack: paquete(),
      rewardType: 'free_60',
      acceptsRewards: true,
      balance: 1000,
    })
    expect(quote).toMatchObject({ tokens: 0, reward: 'free_60', priceCents: 0, coveredBy: 'reward' })
  })

  it('el canje no se aplica sobre una materia gratis, sin el docente o sin saldo', () => {
    const base = { minutes: 60, rewardType: 'free_30', acceptsRewards: true, balance: 1000 }
    expect(quoteBooking({ ...base, hourlyRateCents: 0 }).reward).toBeNull()
    expect(quoteBooking({ ...base, hourlyRateCents: MATE, acceptsRewards: false }).reward).toBeNull()
    expect(quoteBooking({ ...base, hourlyRateCents: MATE, balance: 100 }).reward).toBeNull()
    expect(quoteBooking({ ...base, hourlyRateCents: MATE, minutes: 0 }).reward).toBeNull()
  })

  it('un canje que no entra en la duración no se aplica', () => {
    const quote = quoteBooking({
      hourlyRateCents: MATE,
      minutes: 30,
      rewardType: 'free_60',
      acceptsRewards: true,
    })
    expect(quote).toMatchObject({ reward: null, priceCents: 250000 })
  })
})

describe('packsForReschedule', () => {
  it('le devuelve al paquete las clases que tenía apartadas la clase vieja', () => {
    const packs = [paquete({ available: 0 }), paquete({ id: 'p2', available: 3 })]
    const vieja = { studentPackId: 'p1', packTokens: 1 }

    const ajustados = packsForReschedule(packs, vieja)

    expect(ajustados.map((pack) => pack.available)).toEqual([1, 3])
    // Con el paquete justo, recién así se puede volver a usar.
    expect(usablePackFor(packs, 't1', '2099-01-01').id).toBe('p2')
    expect(usablePackFor([packs[0]], 't1', '2099-01-01')).toBeNull()
    expect(usablePackFor(packsForReschedule([packs[0]], vieja), 't1', '2099-01-01').id).toBe('p1')
  })

  it('sin reprogramar, o si la vieja no usó paquete, quedan igual', () => {
    const packs = [paquete()]
    expect(packsForReschedule(packs, null)).toBe(packs)
    expect(packsForReschedule(packs, { studentPackId: null, packTokens: 0 })).toBe(packs)
  })
})
