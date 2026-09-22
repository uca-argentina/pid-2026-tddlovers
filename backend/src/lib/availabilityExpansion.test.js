import { describe, expect, it } from 'vitest';
import {
  datesBetween,
  dayKeyFromIso,
  expandAvailability,
  subtractRanges,
} from './availabilityExpansion.js';

// 2026-09-14 es lunes.
const LUNES = '2026-09-14';
const MARTES = '2026-09-15';

const entry = (over = {}) => ({
  teacherId: 't1',
  teacherName: 'Laura Gómez',
  subjects: [{ id: 's1', name: 'Matemática' }],
  schedule: { lunes: [{ start: '13:00', end: '15:30' }] },
  ...over,
});

describe('dayKeyFromIso', () => {
  it('maps a date to its weekday, week starting on Monday', () => {
    expect(dayKeyFromIso('2026-09-14')).toBe('lunes');
    expect(dayKeyFromIso('2026-09-20')).toBe('domingo');
  });
});

describe('datesBetween', () => {
  it('includes both ends', () => {
    expect(datesBetween('2026-09-14', '2026-09-16')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ]);
  });

  it('crosses a month boundary', () => {
    expect(datesBetween('2026-09-30', '2026-10-01')).toEqual(['2026-09-30', '2026-10-01']);
  });
});

describe('subtractRanges', () => {
  it('returns the range untouched when nothing is booked', () => {
    expect(subtractRanges([{ start: '13:00', end: '15:30' }], [])).toEqual([
      { start: '13:00', end: '15:30' },
    ]);
  });

  it('splits a range when the booking is in the middle', () => {
    expect(
      subtractRanges([{ start: '13:00', end: '17:00' }], [{ start: '14:00', end: '15:00' }])
    ).toEqual([
      { start: '13:00', end: '14:00' },
      { start: '15:00', end: '17:00' },
    ]);
  });

  it('drops a range that is fully booked', () => {
    expect(
      subtractRanges([{ start: '14:00', end: '15:00' }], [{ start: '14:00', end: '15:00' }])
    ).toEqual([]);
  });

  it('does not treat touching edges as an overlap', () => {
    // 15:00-16:00 no toca 14:00-15:00.
    expect(
      subtractRanges([{ start: '14:00', end: '15:00' }], [{ start: '15:00', end: '16:00' }])
    ).toEqual([{ start: '14:00', end: '15:00' }]);
  });

  it('handles a window that ends at midnight', () => {
    expect(
      subtractRanges([{ start: '22:00', end: '24:00' }], [{ start: '23:00', end: '24:00' }])
    ).toEqual([{ start: '22:00', end: '23:00' }]);
  });
});

describe('expandAvailability', () => {
  it('projects the weekly template onto matching dates only', () => {
    const rows = expandAvailability({
      entries: [entry()],
      bookings: [],
      from: LUNES,
      to: MARTES,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe(LUNES);
    expect(rows[0].dayKey).toBe('lunes');
    expect(rows[0].ranges).toEqual([{ start: '13:00', end: '15:30' }]);
  });

  it('builds the documented composite id', () => {
    const [row] = expandAvailability({ entries: [entry()], bookings: [], from: LUNES, to: LUNES });
    expect(row.id).toBe(`${LUNES}|t1`);
  });

  it('subtracts an hour booked with that teacher', () => {
    const [row] = expandAvailability({
      entries: [entry()],
      bookings: [{ teacherId: 't1', date: LUNES, start: '13:00', end: '14:00' }],
      from: LUNES,
      to: LUNES,
    });
    expect(row.ranges).toEqual([{ start: '14:00', end: '15:30' }]);
  });

  it('carries the teacher subjects so the student can pick one', () => {
    const [row] = expandAvailability({ entries: [entry()], bookings: [], from: LUNES, to: LUNES });
    expect(row.subjects).toEqual([{ id: 's1', name: 'Matemática' }]);
  });

  it('subtracts a booking in the middle of the window', () => {
    const [row] = expandAvailability({
      entries: [entry()],
      bookings: [{ teacherId: 't1', date: LUNES, start: '14:00', end: '15:00' }],
      from: LUNES,
      to: LUNES,
    });
    expect(row.ranges).toEqual([{ start: '13:00', end: '14:00' }]);
  });

  it('ignores bookings of a different teacher', () => {
    const [row] = expandAvailability({
      entries: [entry()],
      bookings: [{ teacherId: 'otro', date: LUNES, start: '13:00', end: '14:00' }],
      from: LUNES,
      to: LUNES,
    });
    expect(row.ranges).toEqual([{ start: '13:00', end: '15:30' }]);
  });

  it('drops a row whose remaining gap is under an hour', () => {
    // Queda 13:00-13:30: no entra una clase, así que la fila desaparece.
    const rows = expandAvailability({
      entries: [entry({ schedule: { lunes: [{ start: '13:00', end: '14:30' }] } })],
      bookings: [{ teacherId: 't1', date: LUNES, start: '13:30', end: '14:30' }],
      from: LUNES,
      to: LUNES,
    });
    expect(rows).toEqual([]);
  });

  it('drops days that already passed', () => {
    const rows = expandAvailability({
      entries: [entry()],
      bookings: [],
      from: LUNES,
      to: LUNES,
      nowIso: '2026-09-20',
      nowTime: '10:00',
    });
    expect(rows).toEqual([]);
  });

  it('trims hours already started today', () => {
    const [row] = expandAvailability({
      entries: [entry()],
      bookings: [],
      from: LUNES,
      to: LUNES,
      nowIso: LUNES,
      nowTime: '14:00',
    });
    expect(row.ranges).toEqual([{ start: '14:00', end: '15:30' }]);
  });

  it('drops today entirely once no full hour is left', () => {
    const rows = expandAvailability({
      entries: [entry()],
      bookings: [],
      from: LUNES,
      to: LUNES,
      nowIso: LUNES,
      nowTime: '15:00',
    });
    expect(rows).toEqual([]);
  });
});
