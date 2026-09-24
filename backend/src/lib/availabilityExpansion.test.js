import { describe, expect, it } from 'vitest';
import {
  datesBetween,
  dayKeyFromIso,
  expandAvailability,
  occursOn,
  openingsForWindow,
} from './availabilityExpansion.js';

// 2026-09-14 es lunes.
const LUNES = '2026-09-14';
const MARTES = '2026-09-15';
const LUNES_SIGUIENTE = '2026-09-21';
const LUNES_ANTERIOR = '2026-09-07';

const ventana = (over = {}) => ({
  id: 'w1',
  teacherId: 't1',
  teacherName: 'Laura Gómez',
  date: LUNES,
  repeatsWeekly: false,
  start: '13:00',
  end: '15:00',
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  locality: null,
  address: null,
  subjects: [
    { id: 's1', name: 'Matemática', hourlyRateCents: 500000 },
    { id: 's2', name: 'Física', hourlyRateCents: 600000 },
  ],
  ...over,
});

const turno = (over = {}) => ({
  teacherId: 't1',
  date: LUNES,
  start: '13:00',
  end: '14:00',
  subjectId: 's1',
  subjectName: 'Matemática',
  enrolled: 1,
  ...over,
});

const abiertos = (window, taken = [], cutoff = null) =>
  openingsForWindow(window, taken, cutoff);

describe('dayKeyFromIso', () => {
  it('maps a date to its weekday, week starting on Monday', () => {
    expect(dayKeyFromIso('2026-09-14')).toBe('lunes');
    expect(dayKeyFromIso('2026-09-20')).toBe('domingo');
  });
});

describe('datesBetween', () => {
  it('includes both ends and crosses months', () => {
    expect(datesBetween('2026-09-30', '2026-10-01')).toEqual(['2026-09-30', '2026-10-01']);
  });
});

describe('occursOn', () => {
  it('a one-off window only happens on its date', () => {
    expect(occursOn(ventana(), LUNES)).toBe(true);
    expect(occursOn(ventana(), LUNES_SIGUIENTE)).toBe(false);
  });

  it('a weekly window repeats on the same weekday from its date on', () => {
    const semanal = ventana({ repeatsWeekly: true });
    expect(occursOn(semanal, LUNES_SIGUIENTE)).toBe(true);
    expect(occursOn(semanal, MARTES)).toBe(false);
  });

  it('a weekly window does not go back in time', () => {
    expect(occursOn(ventana({ repeatsWeekly: true }), LUNES_ANTERIOR)).toBe(false);
  });
});

describe('openingsForWindow', () => {
  it('a window with nothing booked is one free stretch', () => {
    expect(abiertos(ventana())).toEqual({ free: [{ start: '13:00', end: '15:00' }], groups: [] });
  });

  it('a class of the teacher splits the window in two', () => {
    const { free } = abiertos(ventana({ end: '17:00' }), [turno({ start: '14:00', end: '15:00' })]);
    expect(free).toEqual([
      { start: '13:00', end: '14:00' },
      { start: '15:00', end: '17:00' },
    ]);
  });

  it('after a class ending off the half hour, the next start is the next :00/:30', () => {
    // 13:00–13:45: el tramo libre arranca 13:45, pero una clase arranca 14:00.
    const { free } = abiertos(ventana(), [turno({ end: '13:45' })]);
    expect(free).toEqual([{ start: '14:00', end: '15:00' }]);
  });

  it('a stretch too short for a 30 minute class is not offered', () => {
    const { free } = abiertos(ventana(), [turno({ end: '14:45' })]);
    expect(free).toEqual([]);
  });

  it('a class from another window of the teacher also blocks', () => {
    const otra = turno({ start: '12:30', end: '13:30', subjectId: 's2' });
    expect(abiertos(ventana(), [otra]).free).toEqual([{ start: '13:30', end: '15:00' }]);
  });

  it('offers joining a group class that still has room, with its subject', () => {
    const { groups, free } = abiertos(ventana({ maxStudents: 3 }), [turno({ enrolled: 2 })]);
    expect(groups).toEqual([
      { start: '13:00', end: '14:00', subjectId: 's1', subjectName: 'Matemática', enrolled: 2 },
    ]);
    expect(free).toEqual([{ start: '14:00', end: '15:00' }]);
  });

  it('a full group class is not offered', () => {
    expect(abiertos(ventana({ maxStudents: 3 }), [turno({ enrolled: 3 })]).groups).toEqual([]);
  });

  it('never offers joining an individual class', () => {
    expect(abiertos(ventana(), [turno()]).groups).toEqual([]);
  });

  it('does not offer joining a group of a subject the teacher no longer rates', () => {
    const grupal = ventana({ maxStudents: 3 });
    expect(abiertos(grupal, [turno({ subjectId: 's9' })]).groups).toEqual([]);
  });

  it('drops what already started', () => {
    // 13:10: ni sumarse a la de 13:00 ni arrancar antes de 13:30.
    const { free, groups } = abiertos(ventana({ maxStudents: 3, end: '16:00' }), [], 13 * 60 + 10);
    expect(groups).toEqual([]);
    expect(free).toEqual([{ start: '13:30', end: '16:00' }]);
  });

  it('a start exactly at the current time already passed', () => {
    expect(abiertos(ventana(), [], 13 * 60).free).toEqual([{ start: '13:30', end: '15:00' }]);
  });

  it('handles a window that ends at midnight', () => {
    expect(abiertos(ventana({ start: '23:00', end: '24:00' })).free).toEqual([
      { start: '23:00', end: '24:00' },
    ]);
  });
});

describe('expandAvailability', () => {
  const expandir = (over = {}) =>
    expandAvailability({ windows: [ventana()], taken: [], from: LUNES, to: MARTES, ...over });

  it('builds one row per window occurrence, with the documented id', () => {
    const rows = expandir();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: `w1|${LUNES}`,
      windowId: 'w1',
      date: LUNES,
      dayKey: 'lunes',
      modality: 'virtual',
      maxStudents: 1,
      free: [{ start: '13:00', end: '15:00' }],
      groups: [],
    });
    expect(rows[0].subjects.map((subject) => subject.name)).toEqual(['Matemática', 'Física']);
  });

  it('a window with no rated subject is not offered', () => {
    expect(expandir({ windows: [ventana({ subjects: [] })] })).toEqual([]);
  });

  it('never exposes the meeting link', () => {
    expect(expandir()[0]).not.toHaveProperty('meetingUrl');
  });

  it('shows the locality of an in-person class but never its exact address', () => {
    const presencial = ventana({
      modality: 'in_person',
      meetingUrl: null,
      locality: 'Palermo, CABA',
      address: 'Honduras 4800, 2° B',
    });
    const [row] = expandir({ windows: [presencial] });
    expect(row.locality).toBe('Palermo, CABA');
    expect(row).not.toHaveProperty('address');
    expect(JSON.stringify(row)).not.toContain('Honduras');
  });

  it('repeats a weekly window on every matching date of the range', () => {
    const rows = expandir({
      windows: [ventana({ repeatsWeekly: true })],
      to: LUNES_SIGUIENTE,
    });
    expect(rows.map((row) => row.date)).toEqual([LUNES, LUNES_SIGUIENTE]);
  });

  it('only subtracts classes of that teacher on that date', () => {
    const rows = expandir({
      taken: [turno({ teacherId: 'otro' }), turno({ date: MARTES })],
    });
    expect(rows[0].free).toEqual([{ start: '13:00', end: '15:00' }]);
  });

  it('drops an occurrence with nothing left to book', () => {
    const rows = expandir({
      windows: [ventana({ end: '14:00' })],
      taken: [turno()],
    });
    expect(rows).toEqual([]);
  });

  it('drops days that already passed', () => {
    expect(expandir({ nowIso: MARTES, nowTime: '08:00' })).toEqual([]);
  });

  it('trims hours already started today', () => {
    const rows = expandir({ nowIso: LUNES, nowTime: '13:15' });
    expect(rows[0].free).toEqual([{ start: '13:30', end: '15:00' }]);
  });
});
