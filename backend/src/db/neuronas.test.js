import { describe, expect, it, vi } from 'vitest';

vi.mock('./pool.js', () => ({ getPool: vi.fn() }));

const { creditCorrection, syncTurnCredits } = await import('./neuronas.js');

const DOCENTE = 'docente-1';

// Una base en memoria que entiende solo las consultas que usa syncTurnCredits:
// alcanza para probar que el resultado sale del estado y no del orden.
function fakeDb(classes) {
  const credits = new Map();
  const client = {
    async query(sql, params = []) {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM classes c')) {
        const [teacherId, monday, sunday, date, startTime] = params;
        const rows = classes
          .filter(
            (c) =>
              c.teacherId === teacherId &&
              c.date >= monday &&
              c.date <= sunday &&
              (c.status === 'realizada' || (c.date === date && c.startTime === startTime))
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
  return { client, credits, classes };
}

const clase = (over) => ({
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
  const cls = db.classes.find((c) => c.id === id);
  Object.assign(cls, change);
  await syncTurnCredits(db.client, { teacherId: DOCENTE, date: cls.date, startTime: cls.startTime });
}

const snapshot = (db) => Object.fromEntries([...db.credits].sort());

const total = (db, userId) =>
  [...db.credits]
    .filter(([key]) => key.startsWith(`${userId}|`))
    .reduce((sum, [, credit]) => sum + credit.amount, 0);

// Lunes y miércoles de la misma semana, 5 h cada uno: entre los dos pasan las 8 h.
const semana = () => [
  clase({ id: 'lunes', date: '2099-09-14' }),
  clase({ id: 'miercoles', date: '2099-09-16' }),
];

describe('syncTurnCredits', () => {
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
    expect(a.credits.get('alumno-1|class:miercoles').amount).toBe(30);
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
    expect(db.credits.get('alumno-1|class:miercoles').amount).toBe(30);

    await apply(db, 'lunes', { status: 'no_presentada' });

    expect(db.credits.has('alumno-1|class:lunes')).toBe(false);
    expect(db.credits.has(`${DOCENTE}|turn:2099-09-14:08:00`)).toBe(false);
    expect(db.credits.get('alumno-1|class:miercoles').amount).toBe(50);
    expect(db.credits.get(`${DOCENTE}|turn:2099-09-16:08:00`).amount).toBe(50);
  });

  it('el tope de 150 por fecha no depende del orden de los turnos del día', async () => {
    // Cuatro alumnos distintos, 4 h cada uno el mismo día: 40 por turno, 160 en total.
    const dia = () =>
      ['08:00', '12:00', '16:00', '20:00'].map((startTime, i) =>
        clase({
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
    expect(a.credits.get(`${DOCENTE}|turn:2099-09-14:20:00`).amount).toBe(30);
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
