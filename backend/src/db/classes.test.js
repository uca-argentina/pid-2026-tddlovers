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
  syncTurnCredits: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/clock.js', () => ({ now: () => ({ iso: '2099-09-01', time: '10:00' }) }));

const { bookClass, findClassesForUser, rescheduleClass, transitionClass, transitionClasses } =
  await import('./classes.js');
const { syncTurnCredits } = await import('./neuronas.js');

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

const sqls = () => calls.map((c) => c.sql.replace(/\s+/g, ' ').trim());
const indexOf = (re) => sqls().findIndex((sql) => re.test(sql));

afterEach(() => {
  calls.length = 0;
  handlers = [];
  vi.clearAllMocks();
});

describe('bookClass y la licencia', () => {
  it('takes the shared vacations lock first, with the same hash as createVacation', async () => {
    handlers = [[/INSERT INTO classes/, () => ({ rows: [{ id: 'nueva' }], rowCount: 1 })]];

    expect(await bookClass(reserva())).toEqual({ id: 'nueva' });

    const lock = indexOf(/pg_advisory_xact_lock_shared/);
    expect(lock).toBe(1); // justo después del BEGIN
    expect(calls[lock].sql).toContain(`hashtext('vacations:' || $1)`);
    expect(calls[lock].params).toEqual([DOCENTE]);
  });

  it('re-checks the vacation inside the transaction and answers with the shared message', async () => {
    handlers = [[/FROM teacher_vacations/, () => ({ rows: [{}], rowCount: 1 })]];

    const result = await bookClass(reserva());

    expect(result).toEqual({ conflict: 'El docente está de licencia ese día.' });
    expect(indexOf(/INSERT INTO classes/)).toBe(-1);
    expect(sqls()).toContain('ROLLBACK');
  });

  it('rescheduling takes the vacations lock before cancelling the old class', async () => {
    handlers = [
      [/SET status = 'cancelada', cancel_reason = 'reprogramada'/, () => ({ rows: [], rowCount: 1 })],
      [/INSERT INTO classes/, () => ({ rows: [{ id: 'nueva' }], rowCount: 1 })],
    ];

    await rescheduleClass(VIEJA, reserva());

    expect(indexOf(/pg_advisory_xact_lock_shared/)).toBe(1);
    expect(indexOf(/pg_advisory_xact_lock_shared/)).toBeLessThan(indexOf(/reprogramada/));
  });
});

describe('bookClass sumándose a una grupal', () => {
  // La ventana se editó después de que el primero reservó: ahora dice cupo 6,
  // híbrida y otro link. El turno ya tiene un alumno con la copia vieja.
  const editada = { ...ventana, maxStudents: 6, modality: 'hybrid', meetingUrl: 'link-nuevo' };
  const turno = (over = {}) => ({
    end: '14:30',
    subjectId: 'mate',
    enrolled: 1,
    modality: 'virtual',
    maxStudents: 2,
    meetingUrl: 'link-viejo',
    address: null,
    locality: null,
    ...over,
  });
  const insertParams = () => calls.find((c) => /INSERT INTO classes/.test(c.sql)).params;

  it('copies what the turn already has, not the edited window', async () => {
    handlers = [
      [/FROM classes\s+WHERE teacher_id = \$1 AND class_date/, () => ({ rows: [turno()] })],
      [/INSERT INTO classes/, () => ({ rows: [{ id: 'nueva' }], rowCount: 1 })],
    ];

    expect(await bookClass(reserva({ window: editada }))).toEqual({ id: 'nueva' });

    // $8..$12: modality, max_students, meeting_url, address, locality.
    expect(insertParams().slice(7, 12)).toEqual(['virtual', 2, 'link-viejo', null, null]);
  });

  it('measures the room against the turn capacity, not the edited window', async () => {
    handlers = [
      [/FROM classes\s+WHERE teacher_id = \$1 AND class_date/, () => ({ rows: [turno({ enrolled: 2 })] })],
    ];

    expect(await bookClass(reserva({ window: editada }))).toEqual({
      conflict: 'La clase grupal ya se llenó.',
    });
    expect(indexOf(/INSERT INTO classes/)).toBe(-1);
  });

  it('an individual turn already taken is taken, even if the window is now a group', async () => {
    handlers = [
      [/FROM classes\s+WHERE teacher_id = \$1 AND class_date/, () => ({ rows: [turno({ maxStudents: 1 })] })],
    ];

    const result = await bookClass(reserva({ window: editada }));

    expect(result.conflict).toBeTruthy();
    expect(indexOf(/INSERT INTO classes/)).toBe(-1);
  });
});

describe('bookClass con paquete', () => {
  const conPaquete = (over = {}) => reserva({ studentPackId: PAQUETE, packTokens: 1, ...over });

  it('lets StudentPack decide: with room it books', async () => {
    handlers = [
      [/FROM student_packs sp/, () => ({ rows: [paquete({ attended: 2, reserved: 1 })], rowCount: 1 })],
      [/INSERT INTO classes/, () => ({ rows: [{ id: 'nueva' }], rowCount: 1 })],
    ];

    expect(await bookClass(conPaquete())).toEqual({ id: 'nueva' });
  });

  it('without room it says so (attended + reserved count)', async () => {
    handlers = [[/FROM student_packs sp/, () => ({ rows: [paquete({ attended: 2, reserved: 2 })] })]];

    const result = await bookClass(conPaquete());

    expect(result.conflict).toMatch(/reservadas todas las clases/);
    expect(indexOf(/INSERT INTO classes/)).toBe(-1);
  });

  it('a class past the expiry date is refused', async () => {
    handlers = [[/FROM student_packs sp/, () => ({ rows: [paquete({ expiresOn: '2099-09-10' })] })]];

    expect((await bookClass(conPaquete())).conflict).toMatch(/vence/);
  });

  it('rescheduling leaves the old class out of the count', async () => {
    handlers = [
      [/reprogramada/, () => ({ rows: [], rowCount: 1 })],
      [/FROM student_packs sp/, () => ({ rows: [paquete()] })],
      [/INSERT INTO classes/, () => ({ rows: [{ id: 'nueva' }], rowCount: 1 })],
    ];

    await rescheduleClass(VIEJA, conPaquete());

    const pack = calls[indexOf(/FROM student_packs sp/)];
    expect(pack.params).toEqual([PAQUETE, VIEJA]);
  });
});

describe('transitions', () => {
  const turno = { teacherId: DOCENTE, date: '2099-09-14', startTime: '13:00' };
  const ok = () => ({ rows: [turno], rowCount: 1 });

  it('a single one is the one-element case, and attendance syncs the neuronas', async () => {
    handlers = [[/UPDATE classes/, ok]];

    expect(await transitionClass('c1', { from: 'confirmada', to: 'realizada' })).toBe(true);

    expect(syncTurnCredits).toHaveBeenCalledWith(client, turno);
    expect(sqls().at(-1)).toBe('COMMIT');
  });

  it('cancelling does not touch the neuronas', async () => {
    handlers = [[/UPDATE classes/, ok]];

    await transitionClass('c1', { from: 'pendiente', to: 'cancelada', cancelledBy: 'teacher' });

    expect(syncTurnCredits).not.toHaveBeenCalled();
  });

  it('a whole turn accepted as paid (pack) syncs the turn once', async () => {
    handlers = [[/UPDATE classes/, ok]];

    const done = await transitionClasses([
      { id: 'c1', from: 'pendiente', to: 'confirmada', paid: true },
      { id: 'c2', from: 'pendiente', to: 'confirmada', paid: true },
    ]);

    expect(done).toBe(true);
    expect(syncTurnCredits).toHaveBeenCalledTimes(1);
  });

  it('all or nothing: if one changed meanwhile, nothing is applied', async () => {
    let n = 0;
    handlers = [[/UPDATE classes/, () => (++n === 1 ? ok() : { rows: [], rowCount: 0 })]];

    const done = await transitionClasses([
      { id: 'c1', from: 'pendiente', to: 'realizada' },
      { id: 'c2', from: 'pendiente', to: 'realizada' },
    ]);

    expect(done).toBe(false);
    expect(sqls().at(-1)).toBe('ROLLBACK');
    expect(syncTurnCredits).not.toHaveBeenCalled();
  });
});

describe('hasMaterial', () => {
  it('only counts for bookings that could have been given, not cancelled ones', async () => {
    await findClassesForUser({ userId: 'u', role: 'student', from: '2099-01-01', to: '2099-12-31' });

    expect(sqls()[0]).toMatch(
      /c\.status IN \('aceptada', 'confirmada', 'realizada', 'no_presentada'\) AND EXISTS \( SELECT 1 FROM class_materials/
    );
  });
});
