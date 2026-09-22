import { describe, expect, it } from 'vitest';
import { validateSchedule } from './schedule.js';

describe('validateSchedule', () => {
  it('accepts an empty week (the teacher cleared everything)', () => {
    expect(validateSchedule({})).toBeNull();
  });

  it('accepts half-hour aligned windows', () => {
    expect(
      validateSchedule({
        lunes: [{ start: '09:00', end: '11:00' }],
        miercoles: [{ start: '18:30', end: '20:00' }],
      })
    ).toBeNull();
  });

  it('accepts a window ending at midnight written as 24:00', () => {
    expect(validateSchedule({ viernes: [{ start: '23:00', end: '24:00' }] })).toBeNull();
  });

  it('accepts ranges that touch at the edges', () => {
    // 14:00-15:00 y 15:00-16:00 no se pisan.
    expect(
      validateSchedule({
        martes: [
          { start: '14:00', end: '15:00' },
          { start: '15:00', end: '16:00' },
        ],
      })
    ).toBeNull();
  });

  it('rejects a day that is not a weekday key', () => {
    expect(validateSchedule({ lunés: [{ start: '09:00', end: '10:00' }] })).toMatch(/no es un día/);
  });

  it('rejects times that are not on :00 or :30', () => {
    expect(validateSchedule({ lunes: [{ start: '09:07', end: '10:07' }] })).toMatch(/en punto/);
  });

  it('rejects a window shorter than one hour', () => {
    expect(validateSchedule({ lunes: [{ start: '09:00', end: '09:30' }] })).toMatch(
      /menos de una hora/
    );
  });

  it('rejects a backwards range', () => {
    expect(validateSchedule({ lunes: [{ start: '11:00', end: '09:00' }] })).toMatch(/al revés/);
  });

  it('rejects overlapping ranges on the same day', () => {
    expect(
      validateSchedule({
        lunes: [
          { start: '09:00', end: '12:00' },
          { start: '11:00', end: '13:00' },
        ],
      })
    ).toMatch(/superpuestos/);
  });

  it('rejects a non-object schedule', () => {
    expect(validateSchedule(null)).toMatch(/formato inválido/);
    expect(validateSchedule([])).toMatch(/formato inválido/);
  });
});
