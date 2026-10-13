import { describe, expect, it } from 'vitest';
import { formatAddress, validateAddress } from './addresses.js';

const casa = (over = {}) => ({
  label: 'Casa',
  street: 'Av. Corrientes',
  number: '1234',
  postalCode: '1043',
  locality: 'Balvanera',
  city: 'CABA',
  ...over,
});

describe('validateAddress', () => {
  it('normaliza y deja los opcionales vacíos en null', () => {
    const { value } = validateAddress(casa({ street: '  Av. Corrientes ', floor: ' ', notes: '' }), {
      saving: true,
    });
    expect(value).toEqual({
      label: 'Casa',
      street: 'Av. Corrientes',
      number: '1234',
      postalCode: '1043',
      locality: 'Balvanera',
      city: 'CABA',
      floor: null,
      apartment: null,
      notes: null,
    });
  });

  it('guardar pide nombre; una dirección suelta no', () => {
    expect(validateAddress(casa({ label: '' }), { saving: true }).fields).toEqual({ label: 'required' });
    expect(validateAddress(casa({ label: '' }), { saving: false }).value.label).toBeNull();
  });

  it('pide los obligatorios, uno por vez', () => {
    expect(validateAddress(casa({ number: '' }), { saving: true })).toEqual({
      message: 'Falta el número.',
      fields: { number: 'required' },
    });
    expect(validateAddress(casa({ locality: '  ' }), { saving: true }).fields).toEqual({
      locality: 'required',
    });
  });

  it('controla los largos', () => {
    expect(validateAddress(casa({ floor: '12345678901' }), { saving: true })).toEqual({
      message: 'El piso puede tener hasta 10 caracteres.',
      fields: { floor: 'invalid' },
    });
    expect(validateAddress(casa({ label: 'x'.repeat(41) }), { saving: true }).fields).toEqual({
      label: 'invalid',
    });
  });

  it('rechaza lo que no es un objeto', () => {
    expect(validateAddress(null, { saving: false }).message).toMatch(/formato/);
  });
});

describe('formatAddress', () => {
  it('arma la línea con lo que haya', () => {
    expect(formatAddress(casa())).toBe('Av. Corrientes 1234 · CP 1043 · Balvanera, CABA');
    expect(formatAddress(casa({ floor: '3', apartment: 'B', notes: 'Timbre 3B' }))).toBe(
      'Av. Corrientes 1234, piso 3, depto. B · CP 1043 · Balvanera, CABA · Timbre 3B'
    );
  });
});
