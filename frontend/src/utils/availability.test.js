import { DAY_KEYS, dayLabel, formatRangeLabel } from './availability.js'

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

describe('formatRangeLabel', () => {
  it('usa raya y no guion', () => {
    expect(formatRangeLabel('14:00', '15:00')).toBe('14:00 – 15:00')
  })
})
