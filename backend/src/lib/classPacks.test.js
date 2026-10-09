import { describe, expect, it } from 'vitest';
import { StudentPack, expiryFor, validatePackOffer } from './classPacks.js';

const HOY = '2099-09-10';

// 4 clases de 1 h que vencen el 9/10.
const pack = (over = {}) =>
  new StudentPack({ id: 'p1', classCount: 4, classMinutes: 60, expiresOn: '2099-10-09', ...over });

const oferta = (over = {}) => ({
  classCount: 4,
  classMinutes: 60,
  priceCents: 1800000,
  validityDays: 30,
  ...over,
});

describe('validatePackOffer', () => {
  it('acepta un paquete válido', () => {
    expect(validatePackOffer(oferta())).toEqual({ value: oferta() });
  });

  it('un paquete sin cargo vale', () => {
    expect(validatePackOffer(oferta({ priceCents: 0, classCount: 2, validityDays: 1 })).value).toBeTruthy();
  });

  it('rechaza una cantidad fuera de rango o con decimales', () => {
    for (const classCount of [1, 101, 2.5, '4', undefined]) {
      expect(validatePackOffer(oferta({ classCount })).fields).toEqual({ classCount: 'invalid' });
    }
  });

  it('la duración de cada clase va de 30 min a 4 h, de a 5', () => {
    expect(validatePackOffer(oferta({ classMinutes: 30 })).value).toBeTruthy();
    expect(validatePackOffer(oferta({ classMinutes: 240 })).value).toBeTruthy();
    expect(validatePackOffer(oferta({ classMinutes: 45 })).value).toBeTruthy();
    for (const classMinutes of [25, 245, 62, undefined, '60']) {
      expect(validatePackOffer(oferta({ classMinutes })).fields).toEqual({ classMinutes: 'invalid' });
    }
  });

  it('rechaza un precio negativo o con fracciones de centavo', () => {
    for (const priceCents of [-1, 10.5, null]) {
      expect(validatePackOffer(oferta({ priceCents })).fields).toEqual({ priceCents: 'invalid' });
    }
  });

  it('rechaza una vigencia fuera de rango', () => {
    for (const validityDays of [0, 366]) {
      expect(validatePackOffer(oferta({ validityDays })).fields).toEqual({ validityDays: 'invalid' });
    }
  });
});

describe('expiryFor', () => {
  it('cuenta el día de la compra', () => {
    expect(expiryFor('2099-09-10', 1)).toBe('2099-09-10');
    expect(expiryFor('2099-09-10', 30)).toBe('2099-10-09');
  });

  it('cruza fin de mes y de año', () => {
    expect(expiryFor('2099-12-20', 15)).toBe('2100-01-03');
  });
});

describe('StudentPack', () => {
  it('cada asistencia descuenta las clases del paquete que usó', () => {
    expect(pack().remaining()).toBe(4);
    expect(pack({ attended: 2 }).remaining()).toBe(2);
    expect(pack({ attended: 4 }).remaining()).toBe(0);
  });

  it('las reservadas no descuentan, pero no se pueden volver a reservar', () => {
    const p = pack({ attended: 1, reserved: 2 });
    expect(p.remaining()).toBe(3);
    expect(p.available()).toBe(1);
  });

  it('vence después del último día', () => {
    expect(pack().isExpired('2099-10-09')).toBe(false);
    expect(pack().isExpired('2099-10-10')).toBe(true);
  });

  describe('cuánto cubre y cuánto se paga aparte', () => {
    it('una clase de 1 h con 1 clase de 1 h no paga nada', () => {
      expect(pack().extraMinutes({ tokens: 1, minutes: 60 })).toBe(0);
    });

    it('una de 1 h 30 con 1 clase de 1 h paga 30 min', () => {
      expect(pack().extraMinutes({ tokens: 1, minutes: 90 })).toBe(30);
    });

    it('una de 2 h puede usar 2 clases', () => {
      expect(pack().coveredMinutes(2)).toBe(120);
      expect(pack().extraMinutes({ tokens: 2, minutes: 120 })).toBe(0);
    });
  });

  describe('bookingProblem', () => {
    const reserva = (over = {}) => ({ date: '2099-10-09', today: HOY, tokens: 1, minutes: 60, ...over });

    it('sirve con clases disponibles, antes del vencimiento', () => {
      expect(pack().bookingProblem(reserva())).toBeNull();
      expect(pack().bookingProblem(reserva({ tokens: 2, minutes: 150 }))).toBeNull();
    });

    it('hay que usar al menos una clase, entera', () => {
      expect(pack().bookingProblem(reserva({ tokens: 0 })).status).toBe(400);
      expect(pack().bookingProblem(reserva({ tokens: 1.5 })).status).toBe(400);
    });

    it('las clases del paquete no pueden cubrir más de lo que dura la clase', () => {
      const res = pack().bookingProblem(reserva({ tokens: 2, minutes: 90 }));
      expect(res.status).toBe(400);
      expect(res.message).toMatch(/2 clases de 1 h cubren más que una clase de 1 h 30 min/);
      // Una clase de 45 min con una de 1 h tampoco: se gastaría de más.
      expect(pack().bookingProblem(reserva({ minutes: 45 })).status).toBe(400);
    });

    it('no sirve vencido', () => {
      const res = pack().bookingProblem(reserva({ date: '2099-10-11', today: '2099-10-10' }));
      expect(res.status).toBe(409);
      expect(res.message).toMatch(/venció/);
    });

    it('no sirve para una clase después del vencimiento', () => {
      expect(pack().bookingProblem(reserva({ date: '2099-10-10' })).message).toMatch(
        /vence el 09\/10\/2099/
      );
    });

    it('no alcanza si pide más clases de las que quedan', () => {
      expect(pack({ attended: 4 }).bookingProblem(reserva()).message).toMatch(/todas las clases/);
      expect(pack({ attended: 2, reserved: 2 }).bookingProblem(reserva()).message).toMatch(
        /reservadas/
      );
      expect(pack({ attended: 3 }).bookingProblem(reserva({ tokens: 2, minutes: 120 })).message).toMatch(
        /Solo te queda 1 clase/
      );
    });
  });

  it('summary trae las cuentas hechas', () => {
    expect(pack({ attended: 1, reserved: 1 }).summary(HOY)).toEqual({
      remaining: 3,
      available: 2,
      expired: false,
    });
  });
});
