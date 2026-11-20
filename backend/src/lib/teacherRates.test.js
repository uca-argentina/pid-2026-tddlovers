import { describe, expect, it } from 'vitest';
import {
  bookingPriceCents,
  classPriceCents,
  isValidClassMinutes,
  validateRates,
} from './teacherRates.js';

const MATE = '47ac9e88-4099-4ab4-b1fe-3898d7b279c4';
const FISICA = 'fe220bd6-9180-448d-8430-4dcccc866303';

const tarifa = (over = {}) => ({
  subjectId: MATE,
  modality: 'virtual',
  hourlyRateCents: 500000,
  ...over,
});

describe('classPriceCents', () => {
  it('charges the proportional part of the hourly rate', () => {
    expect(classPriceCents(500000, 60)).toBe(500000);
    expect(classPriceCents(500000, 90)).toBe(750000);
  });

  it('rounds to the nearest cent', () => {
    // $ 5.000/h por 50 min = $ 4.166,666...
    expect(classPriceCents(500000, 50)).toBe(416667);
    expect(classPriceCents(100, 35)).toBe(58);
  });

  it('a free rate stays free', () => {
    expect(classPriceCents(0, 45)).toBe(0);
  });
});

describe('isValidClassMinutes', () => {
  it('accepts from 30 minutes, in steps of 5', () => {
    expect(isValidClassMinutes(30)).toBe(true);
    expect(isValidClassMinutes(45)).toBe(true);
    expect(isValidClassMinutes(50)).toBe(true);
    expect(isValidClassMinutes(125)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isValidClassMinutes(25)).toBe(false);
    expect(isValidClassMinutes(47)).toBe(false);
    expect(isValidClassMinutes(45.5)).toBe(false);
    expect(isValidClassMinutes('60')).toBe(false);
    expect(isValidClassMinutes(undefined)).toBe(false);
  });
});

describe('validateRates', () => {
  const validar = (rates, subjectIds = [MATE, FISICA]) => validateRates(rates, subjectIds);

  it('accepts one rate per subject and modality, cents included', () => {
    const rates = [
      tarifa(),
      tarifa({ modality: 'in_person', hourlyRateCents: 650050 }),
      tarifa({ subjectId: FISICA, hourlyRateCents: 0 }),
    ];
    expect(validar(rates).value).toEqual(rates);
  });

  it('an empty list is valid: the teacher has no rates', () => {
    expect(validar([]).value).toEqual([]);
  });

  it('only rates subjects in the profile', () => {
    expect(validar([tarifa()], [FISICA]).fields).toEqual({ rates: 'invalid' });
    expect(validar([tarifa({ subjectId: 'abc' })]).fields).toEqual({ rates: 'invalid' });
  });

  it('rejects an unknown modality', () => {
    expect(validar([tarifa({ modality: 'presencial' })]).fields).toEqual({ rates: 'invalid' });
  });

  it('rejects amounts that are not whole cents or are out of range', () => {
    expect(validar([tarifa({ hourlyRateCents: 100.5 })]).fields).toEqual({ rates: 'invalid' });
    expect(validar([tarifa({ hourlyRateCents: '500000' })]).fields).toEqual({ rates: 'invalid' });
    expect(validar([tarifa({ hourlyRateCents: -1 })]).fields).toEqual({ rates: 'invalid' });
    expect(validar([tarifa({ hourlyRateCents: 1000000001 })]).fields).toEqual({ rates: 'invalid' });
  });

  it('rejects two rates for the same subject and modality', () => {
    const res = validar([tarifa(), tarifa({ hourlyRateCents: 1 })]);
    expect(res.message).toBe('Hay dos tarifas para la misma materia y modalidad.');
  });

  it('rejects something that is not a list', () => {
    expect(validar({ mate: 5000 }).fields).toEqual({ rates: 'invalid' });
  });
});

describe('bookingPriceCents', () => {
  // $ 5.000 la hora.
  const base = { hourlyRateCents: 500000 };

  it('without a pack or a reward, the whole class at the rate', () => {
    expect(bookingPriceCents({ ...base, minutes: 90 })).toBe(750000);
    expect(bookingPriceCents({ ...base, minutes: 50 })).toBe(416667);
  });

  it('with a pack, only what the tokens do not cover', () => {
    // 1 h 30 con una clase de 1 h del paquete: se pagan 30 min.
    expect(bookingPriceCents({ ...base, minutes: 90, packClassMinutes: 60, packTokens: 1 })).toBe(
      250000
    );
    // Cubierta entera.
    expect(bookingPriceCents({ ...base, minutes: 90, packClassMinutes: 45, packTokens: 2 })).toBe(0);
  });

  it('free rewards cover their minutes, the rest at the rate', () => {
    expect(bookingPriceCents({ ...base, minutes: 90, rewardType: 'free_30' })).toBe(500000);
    expect(bookingPriceCents({ ...base, minutes: 60, rewardType: 'free_60' })).toBe(0);
  });

  it('discounts apply to the first 60 minutes only', () => {
    // 1 h 30 = $ 7.500; 10 % de la primera hora = $ 500.
    expect(bookingPriceCents({ ...base, minutes: 90, rewardType: 'discount_10' })).toBe(700000);
    // 30 min = $ 2.500; 20 % = $ 500.
    expect(bookingPriceCents({ ...base, minutes: 30, rewardType: 'discount_20' })).toBe(200000);
  });
});
