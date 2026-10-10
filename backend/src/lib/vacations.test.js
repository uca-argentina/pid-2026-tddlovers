import { describe, expect, it } from 'vitest';
import { VacationRange } from './vacations.js';

const HOY = '2099-09-10';
const rango = (startDate, endDate) => new VacationRange({ startDate, endDate });

describe('VacationRange.validate', () => {
  it('acepta un rango válido, aunque sea de un solo día', () => {
    expect(VacationRange.validate({ startDate: '2099-12-20', endDate: '2100-01-05' }, { today: HOY }).value)
      .toMatchObject({ startDate: '2099-12-20', endDate: '2100-01-05' });
    expect(VacationRange.validate({ startDate: HOY, endDate: HOY }, { today: HOY }).value).toBeTruthy();
  });

  it('pide fechas reales', () => {
    expect(VacationRange.validate({ endDate: HOY }, { today: HOY }).fields).toEqual({ startDate: 'invalid' });
    expect(VacationRange.validate({ startDate: HOY, endDate: '2099-02-31' }, { today: HOY }).fields).toEqual({
      endDate: 'invalid',
    });
  });

  it('el último día no puede ser antes del primero', () => {
    const res = VacationRange.validate({ startDate: '2099-10-10', endDate: '2099-10-01' }, { today: HOY });
    expect(res.fields).toEqual({ endDate: 'invalid' });
  });

  it('no se cargan vacaciones que ya terminaron, pero sí unas que siguen', () => {
    expect(VacationRange.validate({ startDate: '2099-09-01', endDate: '2099-09-09' }, { today: HOY }).message)
      .toMatch(/ya terminaron/);
    expect(VacationRange.validate({ startDate: '2099-09-01', endDate: HOY }, { today: HOY }).value).toBeTruthy();
  });

  it('dura hasta un año', () => {
    expect(VacationRange.validate({ startDate: HOY, endDate: '2100-09-09' }, { today: HOY }).value).toBeTruthy();
    expect(VacationRange.validate({ startDate: HOY, endDate: '2100-09-10' }, { today: HOY }).message).toMatch(
      /365 días/
    );
  });
});

describe('VacationRange', () => {
  it('incluye los dos extremos', () => {
    const r = rango('2099-10-01', '2099-10-05');
    expect(r.includes('2099-10-01')).toBe(true);
    expect(r.includes('2099-10-05')).toBe(true);
    expect(r.includes('2099-10-06')).toBe(false);
    expect(r.days()).toBe(5);
  });

  it('se pisa si comparte algún día, incluido un borde', () => {
    const r = rango('2099-10-01', '2099-10-05');
    expect(r.overlaps(rango('2099-10-05', '2099-10-08'))).toBe(true);
    expect(r.overlaps(rango('2099-10-06', '2099-10-08'))).toBe(false);
    expect(r.firstOverlap([rango('2099-11-01', '2099-11-02'), rango('2099-09-28', '2099-10-01')]).startDate).toBe(
      '2099-09-28'
    );
  });

  it('dice si un docente está de vacaciones un día', () => {
    const vacaciones = [{ teacherId: 't1', startDate: '2099-10-01', endDate: '2099-10-05' }];
    expect(VacationRange.covers(vacaciones, '2099-10-03', 't1')).toBe(true);
    expect(VacationRange.covers(vacaciones, '2099-10-03', 't2')).toBe(false);
    expect(VacationRange.covers(vacaciones, '2099-10-06', 't1')).toBe(false);
  });

  it('se describe en criollo', () => {
    expect(rango('2099-10-01', '2099-10-05').describe()).toBe('del 01/10/2099 al 05/10/2099');
    expect(rango('2099-10-01', '2099-10-01').describe()).toBe('el 01/10/2099');
  });
});
