import { describe, expect, it } from 'vitest';
import {
  MAX_RANGE_DAYS,
  dateRangeProblem,
  datesBetween,
  bookableRows,
  dayKeyFromIso,
  occursOn,
  openingsForWindow,
  withoutBooking,
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

// Como lo devuelve findActiveClasses: una clase en pie, con su cupo y modalidad.
const claseEnPie = (over = {}) => ({
  classId: 'k1',
  teacherId: 't1',
  date: LUNES,
  start: '13:00',
  end: '14:00',
  subjectId: 's1',
  subjectName: 'Matemática',
  enrolled: 1,
  maxStudents: 1,
  modality: 'virtual',
  ...over,
});

// Una reserva propia del alumno como la devuelve findBookingsForUser (lo que importa acá).
const propia = (over = {}) => ({
  id: 'c-propia',
  date: LUNES,
  startTime: '14:00',
  endTime: '15:00',
  teacherId: 'otro',
  subjectId: 's1',
  status: 'confirmada',
  ...over,
});

const abiertos = (window, activeClasses = [], options = {}) => openingsForWindow(window, activeClasses, options);
const inicios = (starts) => starts.map((option) => `${option.start}/${option.maxMinutes}`);

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
  it('a window with nothing booked offers every :00/:30 start up to its end', () => {
    expect(abiertos(ventana())).toEqual({
      starts: [
        { start: '13:00', maxMinutes: 120 },
        { start: '13:30', maxMinutes: 90 },
        { start: '14:00', maxMinutes: 60 },
        { start: '14:30', maxMinutes: 30 },
      ],
      groups: [],
    });
  });

  it('a class of the teacher splits the window in two', () => {
    const { starts } = abiertos(ventana({ end: '17:00' }), [claseEnPie({ start: '14:00', end: '15:00' })]);
    expect(inicios(starts)).toEqual(['13:00/60', '13:30/30', '15:00/120', '15:30/90', '16:00/60', '16:30/30']);
  });

  it('after a class ending off the half hour, the next start is the next :00/:30', () => {
    const { starts } = abiertos(ventana(), [claseEnPie({ end: '13:45' })]);
    expect(inicios(starts)).toEqual(['14:00/60', '14:30/30']);
  });

  it('a stretch too short for a 30 minute class is not offered', () => {
    expect(abiertos(ventana(), [claseEnPie({ end: '14:45' })]).starts).toEqual([]);
  });

  it('a class from another window of the teacher also blocks', () => {
    const otra = claseEnPie({ start: '12:30', end: '13:30', subjectId: 's2' });
    expect(inicios(abiertos(ventana(), [otra]).starts)).toEqual(['13:30/90', '14:00/60', '14:30/30']);
  });

  describe('the student\'s own classes', () => {
    const own = (from, to) => [{ from, to }];

    it('cut the max duration at the next own class, with any teacher', () => {
      const { starts } = abiertos(ventana(), [], { own: own(14 * 60, 15 * 60) });
      // 14:00 y 14:30 caen dentro de la clase propia; 13:30 entra justo (30 min).
      expect(inicios(starts)).toEqual(['13:00/60', '13:30/30']);
    });

    it('drop a start that leaves less than the minimum before the next own class', () => {
      // Propia de 13:20 a 14:15: 13:00 deja 20 min, 13:30 y 14:00 caen adentro.
      const { starts } = abiertos(ventana(), [], { own: own(13 * 60 + 20, 14 * 60 + 15) });
      expect(inicios(starts)).toEqual(['14:30/30']);
    });

    it('round the max duration down to steps of 5', () => {
      const { starts } = abiertos(ventana(), [], { own: own(14 * 60 + 43, 15 * 60) });
      expect(inicios(starts)).toEqual(['13:00/100', '13:30/70', '14:00/40']);
    });

    it('hide a group class that overlaps one of them (or the one already joined)', () => {
      const grupal = ventana({ maxStudents: 3 });
      const activeClasses = [claseEnPie({ maxStudents: 3, enrolled: 2 })];
      expect(abiertos(grupal, activeClasses, { own: own(13 * 60, 14 * 60) }).groups).toEqual([]);
    });
  });

  it('offers joining a group class that still has room, with its subject and capacity', () => {
    const { groups, starts } = abiertos(ventana({ maxStudents: 3 }), [
      claseEnPie({ enrolled: 2, maxStudents: 3 }),
    ]);
    expect(groups).toEqual([
      {
        start: '13:00',
        end: '14:00',
        subjectId: 's1',
        subjectName: 'Matemática',
        enrolled: 2,
        maxStudents: 3,
      },
    ]);
    expect(inicios(starts)).toEqual(['14:00/60', '14:30/30']);
  });

  it('a full group class is not offered', () => {
    const activeClasses = [claseEnPie({ enrolled: 3, maxStudents: 3 })];
    expect(abiertos(ventana({ maxStudents: 3 }), activeClasses).groups).toEqual([]);
  });

  it('measures the room against the class, not the window that was raised to 5 (B1)', () => {
    // Grupal de 3 con 3 anotados; el docente subió la ventana a 5: la clase sigue llena.
    const activeClasses = [claseEnPie({ enrolled: 3, maxStudents: 3 })];
    expect(abiertos(ventana({ maxStudents: 5 }), activeClasses).groups).toEqual([]);
  });

  it('never offers joining an individual class, even if the window is now a group (B1)', () => {
    expect(abiertos(ventana({ maxStudents: 3 }), [claseEnPie()]).groups).toEqual([]);
  });

  it('offers a group class with room even if the window became individual', () => {
    const activeClasses = [claseEnPie({ enrolled: 1, maxStudents: 3 })];
    expect(abiertos(ventana({ maxStudents: 1 }), activeClasses).groups).toHaveLength(1);
  });

  it('does not offer a group class of another modality than the window (B2)', () => {
    const activeClasses = [claseEnPie({ enrolled: 1, maxStudents: 3, modality: 'in_person' })];
    expect(abiertos(ventana({ maxStudents: 3 }), activeClasses).groups).toEqual([]);
  });

  it('does not offer joining a group of a subject the teacher no longer rates', () => {
    const activeClasses = [claseEnPie({ subjectId: 's9', maxStudents: 3 })];
    expect(abiertos(ventana({ maxStudents: 3 }), activeClasses).groups).toEqual([]);
  });

  it('does not offer joining a group that ends after the window (it was shrunk)', () => {
    const achicada = ventana({ maxStudents: 3, end: '14:30' });
    const activeClasses = [claseEnPie({ start: '14:00', end: '15:00', maxStudents: 3 })];
    expect(abiertos(achicada, activeClasses).groups).toEqual([]);
  });

  it('does not offer joining a group that started before the window', () => {
    const grupal = ventana({ maxStudents: 3, start: '14:00', end: '16:00' });
    const activeClasses = [claseEnPie({ start: '13:30', end: '14:30', maxStudents: 3 })];
    expect(abiertos(grupal, activeClasses).groups).toEqual([]);
  });

  it('offers a group that ends exactly when the window does', () => {
    const activeClasses = [claseEnPie({ start: '14:00', end: '15:00', maxStudents: 3 })];
    expect(abiertos(ventana({ maxStudents: 3 }), activeClasses).groups).toHaveLength(1);
  });

  it('drops what already started', () => {
    // 13:10: ni sumarse a la de 13:00 ni arrancar antes de 13:30.
    const activeClasses = [claseEnPie({ maxStudents: 3 })];
    const { starts, groups } = abiertos(ventana({ maxStudents: 3, end: '16:00' }), activeClasses, {
      cutoff: 13 * 60 + 10,
    });
    expect(groups).toEqual([]);
    expect(starts[0]).toEqual({ start: '14:00', maxMinutes: 120 });
  });

  it('a start exactly at the current time already passed', () => {
    expect(abiertos(ventana(), [], { cutoff: 13 * 60 }).starts[0].start).toBe('13:30');
  });

  it('handles a window that ends at midnight', () => {
    expect(abiertos(ventana({ start: '23:00', end: '24:00' })).starts).toEqual([
      { start: '23:00', maxMinutes: 60 },
      { start: '23:30', maxMinutes: 30 },
    ]);
  });
});

describe('bookableRows', () => {
  const filas = (over = {}) =>
    bookableRows({ windows: [ventana()], activeClasses: [], from: LUNES, to: MARTES, ...over });

  it('builds one row per window occurrence, with the documented shape', () => {
    const rows = filas();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: `w1|${LUNES}`,
      windowId: 'w1',
      date: LUNES,
      dayKey: 'lunes',
      modality: 'virtual',
      maxStudents: 1,
      groups: [],
      onVacation: false,
      teacherFeatured: false,
    });
    expect(rows[0].starts[0]).toEqual({ start: '13:00', maxMinutes: 120 });
    expect(rows[0]).not.toHaveProperty('free');
    expect(rows[0].subjects.map((subject) => subject.name)).toEqual(['Matemática', 'Física']);
  });

  it('a window during the teacher\'s vacation stays, greyed and not featured', () => {
    const vacations = [{ teacherId: 't1', startDate: LUNES, endDate: LUNES }];
    const rows = filas({
      windows: [ventana({ repeatsWeekly: true, teacherFeatured: true })],
      vacations,
      to: LUNES_SIGUIENTE,
    });
    expect(rows.find((row) => row.date === LUNES)).toMatchObject({
      onVacation: true,
      starts: [],
      groups: [],
      teacherFeatured: false,
    });
    expect(rows.find((row) => row.date === LUNES_SIGUIENTE)).toMatchObject({
      onVacation: false,
      teacherFeatured: true,
    });
  });

  it('a vacation row of today whose window already ended is not sent (B5)', () => {
    const vacations = [{ teacherId: 't1', startDate: LUNES, endDate: LUNES }];
    expect(filas({ vacations, now: { iso: LUNES, time: '14:40' } })).toEqual([]);
    // Si todavía le queda un inicio, sale en gris.
    expect(filas({ vacations, now: { iso: LUNES, time: '14:10' } })).toHaveLength(1);
  });

  it('another teacher\'s vacation does not touch the window', () => {
    const rows = filas({ vacations: [{ teacherId: 't2', startDate: LUNES, endDate: MARTES }] });
    expect(rows[0].onVacation).toBe(false);
    expect(rows[0].starts.length).toBeGreaterThan(0);
  });

  it('never exposes the meeting link', () => {
    expect(filas()[0]).not.toHaveProperty('meetingUrl');
  });

  it('shows the locality of an in-person class but never its exact address', () => {
    const presencial = ventana({
      modality: 'in_person',
      meetingUrl: null,
      locality: 'Palermo, CABA',
      address: 'Honduras 4800, 2° B',
    });
    const [row] = filas({ windows: [presencial] });
    expect(row.locality).toBe('Palermo, CABA');
    expect(row).not.toHaveProperty('address');
    expect(JSON.stringify(row)).not.toContain('Honduras');
  });

  it('repeats a weekly window on every matching date of the range', () => {
    const rows = filas({ windows: [ventana({ repeatsWeekly: true })], to: LUNES_SIGUIENTE });
    expect(rows.map((row) => row.date)).toEqual([LUNES, LUNES_SIGUIENTE]);
  });

  it('only subtracts classes of that teacher on that date', () => {
    const rows = filas({ activeClasses: [claseEnPie({ teacherId: 'otro' }), claseEnPie({ date: MARTES })] });
    expect(rows[0].starts[0]).toEqual({ start: '13:00', maxMinutes: 120 });
  });

  it('a full occurrence does not appear', () => {
    expect(filas({ windows: [ventana({ end: '14:00' })], activeClasses: [claseEnPie()] })).toEqual([]);
  });

  it('an occurrence where the student is busy the whole time does not appear', () => {
    const rows = filas({ studentBookings: [propia({ startTime: '13:00', endTime: '15:00' })] });
    expect(rows).toEqual([]);
  });

  it('a cancelled own class does not take the student\'s time', () => {
    const rows = filas({
      studentBookings: [propia({ startTime: '13:00', endTime: '15:00', status: 'cancelada' })],
    });
    expect(rows).toHaveLength(1);
  });

  it('own classes on another date do not count', () => {
    const rows = filas({ studentBookings: [propia({ date: MARTES, startTime: '13:00' })] });
    expect(rows[0].starts).toHaveLength(4);
  });

  it('never offers the viewer their own windows', () => {
    expect(filas({ viewerId: 't1' })).toEqual([]);
    expect(filas({ viewerId: 'alguien' })).toHaveLength(1);
  });

  it('drops days that already passed', () => {
    expect(filas({ now: { iso: MARTES, time: '08:00' } })).toEqual([]);
  });

  it('trims hours already started today', () => {
    const rows = filas({ now: { iso: LUNES, time: '13:15' } });
    expect(rows[0].starts[0]).toEqual({ start: '13:30', maxMinutes: 90 });
  });

  describe('rescheduling', () => {
    // La clase confirmada que se reprograma: Matemática de 13 a 14 con t1.
    const vieja = propia({
      id: 'vieja',
      classId: 'k1',
      teacherId: 't1',
      subjectId: 's1',
      startTime: '13:00',
      endTime: '14:00',
    });

    it('frees the old slot and does not count it as an own class', () => {
      const rows = filas({ activeClasses: [claseEnPie()], studentBookings: [vieja], rescheduling: vieja });
      expect(rows[0].starts[0]).toEqual({ start: '13:00', maxMinutes: 120 });
    });

    it('only keeps that teacher, with the subject and groups trimmed to its subject (B4)', () => {
      const otroDocente = ventana({ id: 'w2', teacherId: 't2', start: '16:00', end: '18:00' });
      const grupal = ventana({ maxStudents: 3, end: '17:00' });
      const activeClasses = [
        claseEnPie({
          classId: 'k2',
          start: '15:00',
          end: '16:00',
          subjectId: 's2',
          subjectName: 'Física',
          maxStudents: 3,
        }),
        claseEnPie({ classId: 'k3', start: '16:00', end: '17:00', maxStudents: 3 }),
      ];
      const rows = filas({ windows: [grupal, otroDocente], activeClasses, rescheduling: vieja });
      expect(rows).toHaveLength(1);
      expect(rows[0].teacherId).toBe('t1');
      expect(rows[0].subjects.map((subject) => subject.id)).toEqual(['s1']);
      expect(rows[0].groups.map((group) => group.subjectId)).toEqual(['s1']);
    });

    it('drops a window where the teacher no longer rates that subject', () => {
      const soloFisica = ventana({ subjects: [{ id: 's2', name: 'Física', hourlyRateCents: 1 }] });
      expect(filas({ windows: [soloFisica], rescheduling: vieja })).toEqual([]);
    });
  });
});

describe('withoutBooking', () => {
  // La reserva que se reprograma: lo que importa es su clase.
  const clase = { id: 'vieja', classId: 'k1' };

  it('drops an individual class, so its slot is offered again', () => {
    const otro = claseEnPie({ classId: 'k2', start: '14:00', end: '15:00' });
    expect(withoutBooking([claseEnPie(), otro], clase)).toEqual([otro]);
  });

  it('in a group only frees that seat', () => {
    expect(withoutBooking([claseEnPie({ enrolled: 3 })], clase)).toEqual([claseEnPie({ enrolled: 2 })]);
  });

  it('leaves other classes alone, even at the same time', () => {
    const ajenos = [claseEnPie({ classId: 'k2', teacherId: 't2' }), claseEnPie({ classId: 'k3', date: MARTES })];
    expect(withoutBooking(ajenos, clase)).toEqual(ajenos);
  });
});

describe('dateRangeProblem', () => {
  it('accepts a month grid', () => {
    expect(dateRangeProblem('2026-08-31', '2026-10-11')).toBeNull();
  });

  it('rejects dates that do not exist instead of letting Postgres fail', () => {
    expect(dateRangeProblem('2026-02-30', '2026-03-05')).toMatch(/inválido/);
    expect(dateRangeProblem(undefined, '2026-03-05')).toMatch(/inválido/);
  });

  it('rejects a reversed range', () => {
    expect(dateRangeProblem('2026-03-05', '2026-03-01')).toMatch(/al revés/);
  });

  it(`caps the range at ${MAX_RANGE_DAYS} days`, () => {
    expect(dateRangeProblem('2026-01-01', '2026-04-03')).toBeNull(); // 93 días
    expect(dateRangeProblem('2026-01-01', '2026-04-04')).toMatch(/hasta 93 días/);
    expect(dateRangeProblem('2026-01-01', '9999-12-31')).toMatch(/hasta/);
  });
});
