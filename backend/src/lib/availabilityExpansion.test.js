import { describe, expect, it } from 'vitest';
import {
  datesBetween,
  dayKeyFromIso,
  expandAvailability,
  occursOn,
  slotsForWindow,
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
  subjectId: 's1',
  subjectName: 'Matemática',
  durationMinutes: 60,
  price: 15000,
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  locality: null,
  address: null,
  ...over,
});

const turno = (over = {}) => ({
  teacherId: 't1',
  date: LUNES,
  start: '13:00',
  end: '14:00',
  subjectId: 's1',
  enrolled: 1,
  ...over,
});

const starts = (slots) => slots.map((slot) => slot.start);

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

describe('slotsForWindow', () => {
  it('offers every half hour where the whole class fits', () => {
    expect(starts(slotsForWindow(ventana(), []))).toEqual(['13:00', '13:30', '14:00']);
  });

  it('uses the duration the teacher chose', () => {
    const slots = slotsForWindow(ventana({ durationMinutes: 90 }), []);
    expect(slots).toEqual([
      { start: '13:00', end: '14:30', enrolled: 0 },
      { start: '13:30', end: '15:00', enrolled: 0 },
    ]);
  });

  it('a free duration ends wherever it falls, starts stay on :00/:30', () => {
    const slots = slotsForWindow(ventana({ end: '14:30', durationMinutes: 45 }), []);
    expect(slots).toEqual([
      { start: '13:00', end: '13:45', enrolled: 0 },
      { start: '13:30', end: '14:15', enrolled: 0 },
    ]);
  });

  it('a class ending off the half hour still blocks what it overlaps', () => {
    const turno45 = turno({ start: '13:00', end: '13:45' });
    expect(starts(slotsForWindow(ventana(), [turno45]))).toEqual(['14:00']);
  });

  it('a window exactly as long as the class is a single slot', () => {
    expect(starts(slotsForWindow(ventana({ end: '14:00' }), []))).toEqual(['13:00']);
  });

  it('removes starts that would overlap a class the teacher already has', () => {
    expect(starts(slotsForWindow(ventana(), [turno()]))).toEqual(['14:00']);
  });

  it('a class from another window of the teacher also blocks', () => {
    const otra = turno({ start: '12:30', end: '13:30', subjectId: 's2' });
    expect(starts(slotsForWindow(ventana(), [otra]))).toEqual(['13:30', '14:00']);
  });

  it('offers joining a group class that still has room', () => {
    const grupal = ventana({ maxStudents: 3 });
    const slots = slotsForWindow(grupal, [turno({ enrolled: 2 })]);
    expect(slots[0]).toEqual({ start: '13:00', end: '14:00', enrolled: 2 });
    expect(starts(slots)).toEqual(['13:00', '14:00']);
  });

  it('a full group class is not offered', () => {
    const slots = slotsForWindow(ventana({ maxStudents: 3 }), [turno({ enrolled: 3 })]);
    expect(starts(slots)).toEqual(['14:00']);
  });

  it('never offers joining an individual class', () => {
    expect(slotsForWindow(ventana(), [turno()]).some((s) => s.enrolled > 0)).toBe(false);
  });

  it('does not offer joining a group of another subject', () => {
    const slots = slotsForWindow(ventana({ maxStudents: 3 }), [turno({ subjectId: 's2' })]);
    expect(slots.some((s) => s.enrolled > 0)).toBe(false);
  });

  it('drops what already started', () => {
    // 13:10: ni la de 13:00 ni sumarse a ella.
    const slots = slotsForWindow(ventana({ maxStudents: 3 }), [turno()], 13 * 60 + 10);
    expect(starts(slots)).toEqual(['14:00']);
  });

  it('handles a window that ends at midnight', () => {
    const slots = slotsForWindow(ventana({ start: '23:00', end: '24:00', durationMinutes: 30 }), []);
    expect(slots).toEqual([
      { start: '23:00', end: '23:30', enrolled: 0 },
      { start: '23:30', end: '24:00', enrolled: 0 },
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
      subject: { id: 's1', name: 'Matemática' },
      durationMinutes: 60,
      price: 15000,
      modality: 'virtual',
      maxStudents: 1,
    });
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
    expect(starts(rows[0].slots)).toEqual(['13:00', '13:30', '14:00']);
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
    expect(starts(rows[0].slots)).toEqual(['13:30', '14:00']);
  });
});
