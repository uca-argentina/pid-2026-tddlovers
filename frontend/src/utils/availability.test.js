import { DAY_KEYS, dayLabel, formatRangeLabel, timeToSlotIndex } from './availability.js'

describe('DAY_KEYS', () => {
  it('arranca en lunes y va sin acentos', () => {
    expect(DAY_KEYS[0]).toBe('lunes')
    expect(DAY_KEYS).toContain('miercoles')
    expect(DAY_KEYS.join('')).toMatch(/^[a-z]+$/)
  })
})

describe('dayLabel', () => {
  it('pone el acento para mostrar', () => {
    expect(dayLabel('miercoles')).toBe('Miércoles')
    expect(dayLabel('sabado')).toBe('Sábado')
  })
})

describe('timeToSlotIndex', () => {
  it('cuenta medias horas desde medianoche', () => {
    expect(timeToSlotIndex('00:00')).toBe(0)
    expect(timeToSlotIndex('13:30')).toBe(27)
  })

  it('acepta 24:00 como fin del día', () => {
    expect(timeToSlotIndex('24:00')).toBe(48)
  })

  it('devuelve -1 para lo que no cae en :00 o :30', () => {
    expect(timeToSlotIndex('13:15')).toBe(-1)
    expect(timeToSlotIndex('25:00')).toBe(-1)
    expect(timeToSlotIndex(null)).toBe(-1)
  })
})

describe('formatRangeLabel', () => {
  it('usa raya y no guion', () => {
    expect(formatRangeLabel('14:00', '15:00')).toBe('14:00 – 15:00')
  })
})
