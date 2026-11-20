import { describe, expect, it, vi } from 'vitest';

vi.mock('./pool.js', () => ({ getPool: vi.fn() }));

const { buyFeatured, creditCorrection, featuredActiveOn, findFeaturedStatus, syncClassCredits } =
  await import('./neuronas.js');
const { getPool } = await import('./pool.js');

const DOCENTE = 'docente-1';

// Una base en memoria que entiende solo las consultas que usa syncClassCredits:
// alcanza para probar que el resultado sale del estado y no del orden.
function fakeDb(bookings) {
  const credits = new Map();
  const client = {
    async query(sql, params = []) {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM class_bookings b')) {
        const [teacherId, monday, sunday, classId] = params;
        const rows = bookings
          .filter(
            (c) =>
              c.teacherId === teacherId &&
              c.date >= monday &&
              c.date <= sunday &&
              (c.status === 'realizada' || c.classId === classId)
          )
          .map((c) => ({ subjectName: 'Matemática', packPriceCents: 0, ...c }));
        return { rows };
      }
      if (sql.startsWith('DELETE FROM neurona_credits')) {
        credits.delete(`${params[0]}|${params[1]}`);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO neurona_credits')) {
        const [userId, reason, key, amount] = params;
        credits.set(`${userId}|${key}`, { reason, amount });
        return { rows: [] };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  return { client, credits, bookings };
}

// Cada reserva es su propia clase (classId = 'k-' + id).
const reserva = (over) => ({
  classId: `k-${over.id}`,
  teacherId: DOCENTE,
  studentId: 'alumno-1',
  status: 'confirmada',
  startTime: '08:00',
  endTime: '13:00',
  priceCents: 500000,
  paidAt: null,
  rewardType: null,
  rewardNeuronas: 0,
  ...over,
});

async function apply(db, id, change) {
  const cls = db.bookings.find((c) => c.id === id);
  Object.assign(cls, change);
  await syncClassCredits(db.client, {
    classId: cls.classId,
    teacherId: DOCENTE,
    date: cls.date,
    startTime: cls.startTime,
  });
}

const snapshot = (db) => Object.fromEntries([...db.credits].sort());

const total = (db, userId) =>
  [...db.credits]
    .filter(([key]) => key.startsWith(`${userId}|`))
    .reduce((sum, [, credit]) => sum + credit.amount, 0);

// Lunes y miércoles de la misma semana, 5 h cada uno: entre los dos pasan las 8 h.
const semana = () => [
  reserva({ id: 'lunes', date: '2099-09-14' }),
  reserva({ id: 'miercoles', date: '2099-09-16' }),
];

describe('syncClassCredits', () => {
  it('el tope de 8 h no depende del orden en que se marca y se paga', async () => {
    const PAGA = { paidAt: '2099-09-17T12:00:00.000Z' };
    const DADA = { status: 'realizada' };

    // El lunes se marca sin pagar, el miércoles se paga y marca, y recién
    // después se paga el lunes.
    const a = fakeDb(semana());
    await apply(a, 'lunes', DADA);
    await apply(a, 'miercoles', { ...DADA, ...PAGA });
    await apply(a, 'lunes', PAGA);

    // Todo en orden cronológico.
    const b = fakeDb(semana());
    await apply(b, 'lunes', { ...DADA, ...PAGA });
    await apply(b, 'miercoles', { ...DADA, ...PAGA });

    expect(snapshot(a)).toEqual(snapshot(b));
    // 8 h = 80 neuronas para el alumno: 50 del lunes y 30 del miércoles.
    expect(total(a, 'alumno-1')).toBe(80);
    expect(a.credits.get('alumno-1|booking:miercoles').amount).toBe(30);
  });

  it('marcar A y después B da lo mismo que B y después A', async () => {
    const DADA_PAGA = { status: 'realizada', paidAt: '2099-09-17T12:00:00.000Z' };
    const a = fakeDb(semana());
    await apply(a, 'lunes', DADA_PAGA);
    await apply(a, 'miercoles', DADA_PAGA);

    const b = fakeDb(semana());
    await apply(b, 'miercoles', DADA_PAGA);
    await apply(b, 'lunes', DADA_PAGA);

    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('corregir el lunes a ausente le devuelve los minutos al miércoles', async () => {
    const DADA_PAGA = { status: 'realizada', paidAt: '2099-09-17T12:00:00.000Z' };
    const db = fakeDb(semana());
    await apply(db, 'lunes', DADA_PAGA);
    await apply(db, 'miercoles', DADA_PAGA);
    expect(db.credits.get('alumno-1|booking:miercoles').amount).toBe(30);

    await apply(db, 'lunes', { status: 'no_presentada' });

    expect(db.credits.has('alumno-1|booking:lunes')).toBe(false);
    expect(db.credits.has(`${DOCENTE}|taught:k-lunes`)).toBe(false);
    expect(db.credits.get('alumno-1|booking:miercoles').amount).toBe(50);
    expect(db.credits.get(`${DOCENTE}|taught:k-miercoles`).amount).toBe(50);
  });

  it('el tope de 150 por fecha no depende del orden de las clases del día', async () => {
    // Cuatro alumnos distintos, 4 h cada uno el mismo día: 40 por clase, 160 en total.
    const dia = () =>
      ['08:00', '12:00', '16:00', '20:00'].map((startTime, i) =>
        reserva({
          id: `t${i}`,
          studentId: `alumno-${i}`,
          date: '2099-09-14',
          startTime,
          endTime: `${String(Number(startTime.slice(0, 2)) + 4).padStart(2, '0')}:00`,
        })
      );
    const DADA_PAGA = { status: 'realizada', paidAt: '2099-09-15T12:00:00.000Z' };

    const a = fakeDb(dia());
    for (const id of ['t0', 't1', 't2', 't3']) await apply(a, id, DADA_PAGA);
    const b = fakeDb(dia());
    for (const id of ['t3', 't1', 't0', 't2']) await apply(b, id, DADA_PAGA);

    expect(snapshot(a)).toEqual(snapshot(b));
    expect(total(a, DOCENTE)).toBe(150);
    expect(a.credits.get(`${DOCENTE}|taught:k-t3`).amount).toBe(30);
  });
});

describe('creditCorrection', () => {
  it('cuenta el tope semanal de tareas bajo el lock del alumno, después del del docente', async () => {
    const calls = [];
    const client = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        return { rows: [{ total: 0 }] };
      },
    };
    const submission = { id: 'e1', teacherId: DOCENTE, studentId: 'alumno-1', title: 'TP 1' };

    await creditCorrection(client, submission, { teacher: 10, student: 10 }, '2099-09-14');

    const locks = calls
      .map((call, index) => ({ ...call, index }))
      .filter((call) => call.sql.includes('pg_advisory_xact_lock'));
    expect(locks.map((call) => call.params[0])).toEqual([DOCENTE, 'alumno-1']);
    const weeklyCount = calls.findIndex((call) => call.sql.includes('homework_on_time'));
    expect(locks[1].index).toBeLessThan(weeklyCount);
  });
});

describe('Destacados: cupo global', () => {
  const HOY = '2099-09-07';

  it('the status counts only active featured slots of approved teachers', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ activeUntil: null, active: 4 }] });
    getPool.mockReturnValue({ query });

    expect(await findFeaturedStatus(DOCENTE, HOY)).toEqual({ activeUntil: null, slotsLeft: 1 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("u.approval_status = 'approved'");
    expect(sql).toContain(featuredActiveOn('f', '$2'));
    expect(params).toEqual([DOCENTE, HOY]);
  });

  it('buying measures the cap with the same condition (approved, active today)', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('FROM teacher_featured f')) {
          // 5 activos, pero la consulta ya deja afuera a los no aprobados:
          // acá llegan 4 y queda un lugar.
          return { rows: [1, 2, 3, 4].map((n) => ({ teacherId: `otro-${n}` })) };
        }
        if (sql.includes('earned - spent_bookings')) return { rows: [{ earned: 2000, balance: 2000 }] };
        if (sql.includes('INSERT INTO teacher_featured')) return { rows: [{ endDate: '2099-09-13' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    getPool.mockReturnValue({ connect: async () => client });

    expect(await buyFeatured(DOCENTE, HOY)).toEqual({ endDate: '2099-09-13' });

    const [sql, params] = client.query.mock.calls.find(([q]) => q.includes('FROM teacher_featured f'));
    expect(sql).toContain("u.approval_status = 'approved'");
    expect(sql).toContain(featuredActiveOn('f', '$1'));
    expect(params).toEqual([HOY]);
  });

  it('a featured slot is active from its start date to its end date, inclusive', () => {
    expect(featuredActiveOn('f', '$3')).toBe(
      '(f.start_date <= $3::date AND f.end_date >= $3::date)'
    );
  });
});
