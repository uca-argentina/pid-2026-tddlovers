import { getInitials } from './user.js'

describe('getInitials', () => {
  it('toma la primera letra del nombre y del apellido, en mayúscula', () => {
    expect(getInitials({ nombre: 'Agustín', apellido: 'Klos' })).toBe('AK')
  })

  it('acepta que falte el apellido', () => {
    expect(getInitials({ nombre: 'Ana' })).toBe('A')
  })

  // Sin sesión la barra lateral llama con null: tiene que devolver '' y no
  // explotar, porque es lo que decide si se dibuja el avatar o el ícono.
  it('devuelve vacío si no hay usuario', () => {
    expect(getInitials(null)).toBe('')
    expect(getInitials(undefined)).toBe('')
    expect(getInitials({})).toBe('')
  })
})
