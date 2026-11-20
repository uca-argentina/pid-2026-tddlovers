import { afterEach, describe, expect, it, vi } from 'vitest';

// Sin Postgres: un cliente falso que anota cada consulta y contesta según el
// SQL. Alcanza para ver el orden de los locks y qué decide cada función.
const calls = [];
let handlers = [];

function respond(sql, params) {
  calls.push({ sql, params });
  const handler = handlers.find(([match]) => match.test(sql));
  return Promise.resolve(handler ? handler[1](params) : { rows: [], rowCount: 0 });
}

const client = { query: vi.fn(respond), release: vi.fn() };
const pool = { query: vi.fn(respond), connect: vi.fn(async () => client) };

vi.mock('./pool.js', () => ({ getPool: () => pool }));
vi.mock('./neuronas.js', () => ({
  hasBalanceFor: vi.fn().mockResolvedValue(true),
  syncClassCredits: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/clock.js', () => ({ now: () => ({ iso: '2099-09-01', time: '10:00' }) }));

const {
  createBooking,
  findBookingsForUser,
  rescheduleBooking,
  transitionBooking,
  transitionBookings,
} = await import('./bookings.js');
const { findActiveClasses } = await import('./classes.js');
const { syncClassCredits } = await import('./neuronas.js');

const DOCENTE = '5b0e6c1a-2f3d-4a5b-8c7d-9e0f1a2b3c4d';
const PAQUETE = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const VIEJA = '0d9c8b7a-6f5e-4d3c-8b2a-190817263544';

const ventana = { id: 'v1', teacherId: DOCENTE, modality: 'virtual', maxStudents: 1, meetingUrl: 'x' };
const reserva = (over = {}) => ({
  window: ventana,
  studentId: 'alumno-1',
  date: '2099-09-14',
  startTime: '13:00',
  endTime: '14:30',
  subjectId: 'mate',
  priceCents: 0,
  ...over,
});

// Una fila de student_packs como la devuelve studentPackColumns (db/packs.js).
const paquete = (over = {}) => ({
  id: PAQUETE,
  classCount: 4,
  classMinutes: 60,
  expiresOn: '2099-12-31',
  attended: 0,
  reserved: 0,
  ...over,
});

// Lo que contestan los INSERT: la clase nueva (si es la primera reserva del
// horario) y la reserva del alumno.
const ALTAS = [
  [/INSERT INTO classes/, () => ({ rows: [{ id: 'clase-nueva' }], rowCount: 1 })],
  [/INSERT INTO class_bookings/, () => ({ rows: [{ id: 'nueva' }], rowCount: 1 })],
];

const sqls = () => calls.map((c) => c.sql.replace(/\s+/g, ' ').trim());
const indexOf = (re) => sqls().findIndex((sql) => re.test(sql));

afterEach(() => {
  calls.length = 0;
  handlers = [];
  vi.clearAllMocks();
});

describe('createBooking y la licencia', () => {
  it('takes the shared vacations lock first, with the same hash as createVacation', async () => {
    handlers = [...ALTAS];

    expect(await createBooking(reserva())).toEqual({ id: 'nueva' });

    const lock = indexOf(/pg_advisory_xact_lock_shared/);
    expect(lock).toBe(1); // justo después del BEGIN
    expect(calls[lock].sql).toContain(`hashtext('vacations:' || $1)`);
    expect(calls[lock].params).toEqual([DOCENTE]);
  });

  it('re-checks the vacation inside the transaction and answers with the shared message', async () => {
    handlers = [[/FROM teacher_vacations/, () => ({ rows: [{}], rowCount: 1 })]];

    const result = await createBooking(reserva());

    expect(result).toEqual({ conflict: 'El docente está de licencia ese día.' });
    expect(indexOf(/INSERT INTO class/)).toBe(-1);
    expect(sqls()).toContain('ROLLBACK');
  });

  it('rescheduling takes the vacations lock before cancelling the old booking', async () => {
    handlers = [
      [/SET status = 'cancelada', cancel_reason = 'reprogramada'/, () => ({ rows: [], rowCount: 1 })],
      ...ALTAS,
    ];

    await rescheduleBooking(VIEJA, reserva());

    expect(indexOf(/pg_advisory_xact_lock_shared/)).toBe(1);
    expect(indexOf(/pg_advisory_xact_lock_shared/)).toBeLessThan(indexOf(/reprogramada/));
  });
});

describe('createBooking: la clase y la reserva', () => {
  const CLASE = 'c0ffee00-0000-4000-8000-000000000001';
  // La ventana se editó después de que el primero reservó: ahora dice cupo 6
  // y otro link. La clase ya tiene un alumno y guarda lo de antes.
  const editada = { ...ventana, maxStudents: 6, meetingUrl: 'link-nuevo' };
  const clase = (over = {}) => ({
    id: CLASE,
    end: '14:30',
    subjectId: 'mate',
    enrolled: 1,
    modality: 'virtual',
    maxStudents: 2,
    ...over,
  });
  // La consulta de "¿ya hay una clase en pie a esa hora?" de insertBooking.
  const EN_PIE = /FROM classes c\s+WHERE c\.teacher_id = \$1 AND c\.class_date = \$2::date\s+AND c\.start_time = \$3::time\s+AND c\.active/;
  const paramsOf = (re) => calls.find((c) => re.test(c.sql)).params;

  it('the first booking of a time creates the class with the window data', async () => {
    handlers = [...ALTAS];

    expect(await createBooking(reserva())).toEqual({ id: 'nueva' });

    // $7..$9: modality, max_students, meeting_url de la ventana.
    expect(paramsOf(/INSERT INTO classes/).slice(6, 9)).toEqual(['virtual', 1, 'x']);
    // La reserva apunta a la clase recién creada.
    expect(paramsOf(/INSERT INTO class_bookings/)[0]).toBe('clase-nueva');
  });

  it('joining a group adds only the booking, to the existing class', async () => {
    handlers = [[EN_PIE, () => ({ rows: [clase()] })], ...ALTAS];

    expect(await createBooking(reserva({ window: editada }))).toEqual({ id: 'nueva' });

    expect(indexOf(/INSERT INTO classes/)).toBe(-1);
    expect(paramsOf(/INSERT INTO class_bookings/)[0]).toBe(CLASE);
  });

  it('measures the room against the class capacity, not the edited window', async () => {
    handlers = [[EN_PIE, () => ({ rows: [clase({ enrolled: 2 })] })], ...ALTAS];

    expect(await createBooking(reserva({ window: editada }))).toEqual({
      conflict: 'La clase grupal ya se llenó.',
    });
    expect(indexOf(/INSERT INTO class/)).toBe(-1);
  });

  it('rejects joining a group whose modality is not the window one (the price was for the window)', async () => {
    handlers = [[EN_PIE, () => ({ rows: [clase()] })], ...ALTAS];

    const result = await createBooking(reserva({ window: { ...editada, modality: 'hybrid' } }));

    expect(result.conflict).toMatch(/otra modalidad/);
    expect(indexOf(/INSERT INTO class/)).toBe(-1);
    expect(sqls()).toContain('ROLLBACK');
  });

  it('an individual class already taken is taken, even if the window is now a group', async () => {
    handlers = [[EN_PIE, () => ({ rows: [clase({ maxStudents: 1 })] })], ...ALTAS];

    const result = await createBooking(reserva({ window: editada }));

    expect(result.conflict).toBe('Ese horario ya fue reservado por otra persona.');
    expect(indexOf(/INSERT INTO class/)).toBe(-1);
  });

  it('a clash of the student with themselves is explained as theirs', async () => {
    const choque = Object.assign(new Error('exclusion'), {
      code: '23P01',
      constraint: 'class_bookings_student_no_overlap',
    });
    handlers = [
      ALTAS[0],
      [/INSERT INTO class_bookings/, () => Promise.reject(choque)],
    ];

    expect(await createBooking(reserva())).toEqual({
      conflict: 'Ya tenés una clase reservada en ese horario.',
    });
    expect(sqls().at(-1)).toBe('ROLLBACK');
  });

  it('a clash with another class of the teacher is "taken by someone else"', async () => {
    const choque = Object.assign(new Error('exclusion'), {
      code: '23P01',
      constraint: 'classes_teacher_no_overlap',
    });
    handlers = [[/INSERT INTO classes/, () => Promise.reject(choque)]];

    expect(await createBooking(reserva())).toEqual({
      conflict: 'Ese horario ya fue reservado por otra persona.',
    });
  });
});

describe('createBooking con paquete', () => {
  const conPaquete = (over = {}) => reserva({ studentPackId: PAQUETE, packTokens: 1, ...over });

  it('lets StudentPack decide: with room it books', async () => {
    handlers = [
      [/FROM student_packs sp/, () => ({ rows: [paquete({ attended: 2, reserved: 1 })], rowCount: 1 })],
      ...ALTAS,
    ];

    expect(await createBooking(conPaquete())).toEqual({ id: 'nueva' });
  });

  it('without room it says so (attended + reserved count)', async () => {
    handlers = [[/FROM student_packs sp/, () => ({ rows: [paquete({ attended: 2, reserved: 2 })] })]];

    const result = await createBooking(conPaquete());

    expect(result.conflict).toMatch(/reservadas todas las clases/);
    expect(indexOf(/INSERT INTO class/)).toBe(-1);
  });

  it('a class past the expiry date is refused', async () => {
    handlers = [[/FROM student_packs sp/, () => ({ rows: [paquete({ expiresOn: '2099-09-10' })] })]];

    expect((await createBooking(conPaquete())).conflict).toMatch(/vence/);
  });

  it('rescheduling leaves the old booking out of the count', async () => {
    handlers = [
      [/reprogramada/, () => ({ rows: [], rowCount: 1 })],
      [/FROM student_packs sp/, () => ({ rows: [paquete()] })],
      ...ALTAS,
    ];

    await rescheduleBooking(VIEJA, conPaquete());

    const pack = calls[indexOf(/FROM student_packs sp/)];
    expect(pack.params).toEqual([PAQUETE, VIEJA]);
  });
});

describe('transitions', () => {
  // Lo que devuelve TRANSITION_SQL: la clase de la reserva.
  const claseTocada = { classId: 'clase-1', teacherId: DOCENTE, date: '2099-09-14', startTime: '13:00' };
  const ok = () => ({ rows: [claseTocada], rowCount: 1 });

  it('a single one is the one-element case, and attendance syncs the neuronas', async () => {
    handlers = [[/UPDATE class_bookings/, ok]];

    expect(await transitionBooking('c1', { from: 'confirmada', to: 'realizada' })).toBe(true);

    expect(syncClassCredits).toHaveBeenCalledWith(client, claseTocada);
    expect(sqls().at(-1)).toBe('COMMIT');
  });

  it('cancelling does not touch the neuronas', async () => {
    handlers = [[/UPDATE class_bookings/, ok]];

    await transitionBooking('c1', { from: 'pendiente', to: 'cancelada', cancelledBy: 'teacher' });

    expect(syncClassCredits).not.toHaveBeenCalled();
  });

  it('a whole class accepted as paid (pack) syncs the class once', async () => {
    handlers = [[/UPDATE class_bookings/, ok]];

    const done = await transitionBookings([
      { id: 'c1', from: 'pendiente', to: 'confirmada', paid: true },
      { id: 'c2', from: 'pendiente', to: 'confirmada', paid: true },
    ]);

    expect(done).toBe(true);
    expect(syncClassCredits).toHaveBeenCalledTimes(1);
  });

  it('all or nothing: if one changed meanwhile, nothing is applied', async () => {
    let n = 0;
    handlers = [[/UPDATE class_bookings/, () => (++n === 1 ? ok() : { rows: [], rowCount: 0 })]];

    const done = await transitionBookings([
      { id: 'c1', from: 'pendiente', to: 'realizada' },
      { id: 'c2', from: 'pendiente', to: 'realizada' },
    ]);

    expect(done).toBe(false);
    expect(sqls().at(-1)).toBe('ROLLBACK');
    expect(syncClassCredits).not.toHaveBeenCalled();
  });
});

describe('hasMaterial', () => {
  it('only counts for bookings that could have been given, not cancelled ones', async () => {
    await findBookingsForUser({ userId: 'u', role: 'student', from: '2099-01-01', to: '2099-12-31' });

    expect(sqls()[0]).toMatch(
      /b\.status IN \('aceptada', 'confirmada', 'realizada', 'no_presentada'\) AND EXISTS \( SELECT 1 FROM class_materials/
    );
  });
});

describe('findActiveClasses', () => {
  it('brings the capacity and modality of the class, not the window', async () => {
    const fila = {
      teacherId: DOCENTE,
      date: '2099-09-14',
      start: '13:00',
      end: '14:00',
      subjectId: 'mate',
      subjectName: 'Matemática',
      enrolled: 3,
      maxStudents: 3,
      modality: 'virtual',
    };
    handlers = [[/FROM classes c/, () => ({ rows: [fila] })]];

    expect(await findActiveClasses({ from: '2099-09-14', to: '2099-09-20' })).toEqual([fila]);

    const sql = sqls()[0];
    expect(sql).toContain('c.max_students AS "maxStudents"');
    expect(sql).toContain('c.modality');
    // Solo las clases en pie, contando sus reservas no canceladas.
    expect(sql).toContain('WHERE c.active');
    expect(sql).toContain("b.class_id = c.id AND b.status <> 'cancelada'");
  });
});
