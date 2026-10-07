import { describe, expect, it } from 'vitest';
import { StudentPack, expiryFor, validatePackOffer } from './classPacks.js';

const HOY = '2099-09-10';

const pack = (over = {}) =>
  new StudentPack({ id: 'p1', classCount: 4, expiresOn: '2099-10-09', ...over });

describe('validatePackOffer', () => {
  it('acepta un paquete válido', () => {
    expect(validatePackOffer({ classCount: 4, priceCents: 1800000, validityDays: 30 })).toEqual({
      value: { classCount: 4, priceCents: 1800000, validityDays: 30 },
    });
  });

  it('un paquete sin cargo vale', () => {
    expect(validatePackOffer({ classCount: 2, priceCents: 0, validityDays: 1 }).value).toBeTruthy();
  });

  it('rechaza una cantidad fuera de rango o con decimales', () => {
    for (const classCount of [1, 101, 2.5, '4', undefined]) {
      const res = validatePackOffer({ classCount, priceCents: 100, validityDays: 30 });
      expect(res.fields).toEqual({ classCount: 'invalid' });
    }
  });

  it('rechaza un precio negativo o con fracciones de centavo', () => {
    for (const priceCents of [-1, 10.5, null]) {
      const res = validatePackOffer({ classCount: 4, priceCents, validityDays: 30 });
      expect(res.fields).toEqual({ priceCents: 'invalid' });
    }
  });

  it('rechaza una vigencia fuera de rango', () => {
    for (const validityDays of [0, 366]) {
      const res = validatePackOffer({ classCount: 4, priceCents: 100, validityDays });
      expect(res.fields).toEqual({ validityDays: 'invalid' });
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
  it('cada asistencia descuenta una clase', () => {
    expect(pack().remaining()).toBe(4);
    expect(pack({ attended: 1 }).remaining()).toBe(3);
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

  describe('bookingProblem', () => {
    it('sirve con clases disponibles, antes del vencimiento', () => {
      expect(pack().bookingProblem({ date: '2099-10-09', today: HOY })).toBeNull();
    });

    it('no sirve vencido', () => {
      const res = pack().bookingProblem({ date: '2099-10-11', today: '2099-10-10' });
      expect(res.status).toBe(409);
      expect(res.message).toMatch(/venció/);
    });

    it('no sirve para una clase después del vencimiento', () => {
      const res = pack().bookingProblem({ date: '2099-10-10', today: HOY });
      expect(res.message).toMatch(/vence el 09\/10\/2099/);
    });

    it('no sirve sin clases', () => {
      expect(pack({ attended: 4 }).bookingProblem({ date: HOY, today: HOY }).message).toMatch(
        /todas las clases/
      );
      expect(pack({ attended: 2, reserved: 2 }).bookingProblem({ date: HOY, today: HOY }).message).toMatch(
        /reservadas/
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

  describe('choose', () => {
    it('elige el que vence primero entre los que sirven', () => {
      const tarde = pack({ id: 'tarde', expiresOn: '2099-12-31' });
      const pronto = pack({ id: 'pronto', expiresOn: '2099-09-30' });
      expect(StudentPack.choose([tarde, pronto], { date: HOY, today: HOY }).pack.id).toBe('pronto');
    });

    it('saltea los que no sirven', () => {
      const lleno = pack({ id: 'lleno', expiresOn: '2099-09-30', attended: 4 });
      const otro = pack({ id: 'otro', expiresOn: '2099-12-31' });
      expect(StudentPack.choose([lleno, otro], { date: HOY, today: HOY }).pack.id).toBe('otro');
    });

    it('sin paquetes, explica', () => {
      expect(StudentPack.choose([], { date: HOY, today: HOY }).error.message).toMatch(
        /No tenés un paquete/
      );
    });

    it('si ninguno sirve, devuelve el motivo', () => {
      const res = StudentPack.choose([pack({ attended: 4 })], { date: HOY, today: HOY });
      expect(res.error.status).toBe(409);
    });
  });
});
