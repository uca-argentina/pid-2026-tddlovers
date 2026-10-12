import { describe, expect, it } from 'vitest'
import { addressErrors, addressToForm, addressToPayload, formatAddress } from './addresses.js'

const casa = {
  label: 'Casa',
  street: 'Av. Corrientes',
  number: '1234',
  postalCode: '1043',
  locality: 'Balvanera',
  city: 'CABA',
  floor: '',
  apartment: '',
  notes: '',
}

describe('addressErrors', () => {
  it('una completa no tiene errores', () => {
    expect(addressErrors(casa, { saving: true })).toEqual({})
  })

  it('marca los obligatorios que faltan', () => {
    expect(addressErrors({ ...casa, number: ' ', city: '' }, { saving: true })).toEqual({
      number: 'Completalo.',
      city: 'Completalo.',
    })
  })

  it('el nombre solo hace falta si se guarda', () => {
    expect(addressErrors({ ...casa, label: '' }, { saving: true })).toHaveProperty('label')
    expect(addressErrors({ ...casa, label: '' }, { saving: false })).toEqual({})
  })

  it('controla los largos', () => {
    expect(addressErrors({ ...casa, floor: '12345678901' }, { saving: false })).toEqual({
      floor: 'Hasta 10 caracteres.',
    })
  })
})

describe('formulario', () => {
  it('pasa los null de la API a vacío y recorta al mandar', () => {
    const form = addressToForm({ ...casa, floor: null, notes: null })
    expect(form.floor).toBe('')
    expect(addressToPayload({ ...form, street: '  Av. Corrientes  ' }).street).toBe('Av. Corrientes')
  })
})

describe('formatAddress', () => {
  it('arma la línea igual que el backend', () => {
    expect(formatAddress(casa)).toBe('Av. Corrientes 1234 · CP 1043 · Balvanera, CABA')
    expect(formatAddress({ ...casa, floor: '3', apartment: 'B', notes: 'Timbre 3B' })).toBe(
      'Av. Corrientes 1234, piso 3, depto. B · CP 1043 · Balvanera, CABA · Timbre 3B',
    )
  })
})
