import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/availability.js', () => ({
  findPublishedWindows: vi.fn(),
}));

vi.mock('../../db/classes.js', () => ({
  expireStartedPending: vi.fn(),
  findClassById: vi.fn(),
  findTakenSlots: vi.fn(),
}));

vi.mock('../../db/vacations.js', () => ({
  listVacationsInRange: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

// Un lunes lejano para que nada quede "en el pasado" según el reloj real.
vi.mock('../../lib/clock.js', () => ({
  now: () => ({ iso: '2099-09-07', time: '10:00' }),
  todayIso: () => '2099-09-07',
}));

const { findPublishedWindows } = await import('../../db/availability.js');
const { expireStartedPending, findClassById, findTakenSlots } = await import(
  '../../db/classes.js'
);
const { listVacationsInRange } = await import('../../db/vacations.js');
const { findValidSession } = await import('../../db/sessions.js');
const { buildApp } = await import('../../app.js');

const ALUMNO_ID = '3b2f6c1e-1d5a-4c7e-9f0a-1b2c3d4e5f60';
const DOCENTE_ID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
const MATE = 'a1b2c3d4-0000-4000-8000-000000000001';
const CLASE_ID = 'c0ffee00-1111-4222-8333-444455556666';
const LUNES = '2099-09-14';

async function authedHeaders(app, userId = ALUMNO_ID) {
  findValidSession.mockResolvedValue({
    session_id: 'session-1',
    user_id: userId,
    email: 'a@example.com',
    role: 'student',
  });
  await app.ready();
  return { cookie: `sid=${app.signCookie('session-1')}` };
}

// Como la devuelve findPublishedWindows.
const ventana = {
  id: 'f0f0f0f0-0000-4000-8000-000000000001',
  teacherId: DOCENTE_ID,
  date: LUNES,
  repeatsWeekly: false,
  start: '14:00',
  end: '17:00',
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  locality: null,
  address: null,
  teacherName: 'Laura Gómez',
  subjects: [{ id: MATE, name: 'Matemática', hourlyRateCents: 500000 }],
  teacherAcceptsRewards: false,
  teacherFeatured: false,
};

// Como la devuelve findTakenSlots: un turno.
const turno = {
  teacherId: DOCENTE_ID,
  date: LUNES,
  start: '14:00',
  end: '15:00',
  subjectId: MATE,
  subjectName: 'Matemática',
  enrolled: 1,
};

// Como la devuelve findClassById (CLASS_COLUMNS), con lo que importa acá.
const clase = (over = {}) => ({
  id: CLASE_ID,
  date: LUNES,
  startTime: '14:00',
  endTime: '15:00',
  subjectId: MATE,
  subjectName: 'Matemática',
  teacherId: DOCENTE_ID,
  teacherName: 'Laura Gómez',
  studentId: ALUMNO_ID,
  studentName: 'Ana Pérez',
  status: 'confirmada',
  availabilityId: ventana.id,
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  address: null,
  locality: null,
  priceCents: 500000,
  paidAt: '2099-09-01T12:00:00.000Z',
  cancelledBy: null,
  cancelReason: null,
  rescheduledFrom: null,
  studentPackId: null,
  packTokens: 0,
  rewardType: null,
  rewardNeuronas: 0,
  enrolled: 1,
  hasMaterial: false,
  ...over,
});

const URL = `/api/availability?from=${LUNES}&to=${LUNES}`;

describe('GET /api/availability', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    findPublishedWindows.mockResolvedValue([ventana]);
    findTakenSlots.mockResolvedValue([turno]);
    listVacationsInRange.mockResolvedValue([]);
    expireStartedPending.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('subtracts what is taken with that teacher', async () => {
    const headers = await authedHeaders(app);
    const res = await app.inject({ method: 'GET', url: URL, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].free).toEqual([{ start: '15:00', end: '17:00' }]);
    expect(findClassById).not.toHaveBeenCalled();
  });

  it('expires started pendings before reading what is taken', async () => {
    const headers = await authedHeaders(app);
    await app.inject({ method: 'GET', url: URL, headers });
    expect(expireStartedPending).toHaveBeenCalledWith({ iso: '2099-09-07', time: '10:00' });
    expect(expireStartedPending.mock.invocationCallOrder[0]).toBeLessThan(
      findTakenSlots.mock.invocationCallOrder[0]
    );
  });

  describe('excludeClassId', () => {
    it('frees the slot of the class being rescheduled', async () => {
      findClassById.mockResolvedValueOnce(clase());
      const headers = await authedHeaders(app);
      const res = await app.inject({
        method: 'GET',
        url: `${URL}&excludeClassId=${CLASE_ID}`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      // 14:00-15:00 → 14:30-15:30 tiene que poder elegirse.
      expect(res.json()[0].free).toEqual([{ start: '14:00', end: '17:00' }]);
      expect(findClassById).toHaveBeenCalledWith(CLASE_ID);
    });

    it('is ignored for a class of someone else', async () => {
      findClassById.mockResolvedValueOnce(clase({ studentId: DOCENTE_ID }));
      const headers = await authedHeaders(app);
      const res = await app.inject({
        method: 'GET',
        url: `${URL}&excludeClassId=${CLASE_ID}`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0].free).toEqual([{ start: '15:00', end: '17:00' }]);
    });

    it('is ignored for a class that is not confirmed', async () => {
      for (const status of ['pendiente', 'aceptada', 'cancelada']) {
        findClassById.mockResolvedValueOnce(clase({ status }));
        const headers = await authedHeaders(app);
        const res = await app.inject({
          method: 'GET',
          url: `${URL}&excludeClassId=${CLASE_ID}`,
          headers,
        });
        expect(res.json()[0].free).toEqual([{ start: '15:00', end: '17:00' }]);
      }
    });

    it('is ignored for a class that does not exist', async () => {
      findClassById.mockResolvedValueOnce(null);
      const headers = await authedHeaders(app);
      const res = await app.inject({
        method: 'GET',
        url: `${URL}&excludeClassId=${CLASE_ID}`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0].free).toEqual([{ start: '15:00', end: '17:00' }]);
    });

    it('is a 400 when it is not a UUID', async () => {
      const headers = await authedHeaders(app);
      const res = await app.inject({ method: 'GET', url: `${URL}&excludeClassId=abc`, headers });
      expect(res.statusCode).toBe(400);
      expect(findClassById).not.toHaveBeenCalled();
    });
  });

  describe('date range', () => {
    it.each([
      ['a date that does not exist', 'from=2099-02-30&to=2099-03-05'],
      ['a reversed range', 'from=2099-03-05&to=2099-03-01'],
      ['a huge range', 'from=2099-01-01&to=9999-12-31'],
      ['a missing date', 'from=2099-01-01'],
    ])('rejects %s without touching the database', async (_, query) => {
      const headers = await authedHeaders(app);
      const res = await app.inject({ method: 'GET', url: `/api/availability?${query}`, headers });
      expect(res.statusCode).toBe(400);
      expect(typeof res.json().message).toBe('string');
      expect(findPublishedWindows).not.toHaveBeenCalled();
      expect(expireStartedPending).not.toHaveBeenCalled();
    });

    it('accepts the six weeks of a month grid', async () => {
      const headers = await authedHeaders(app);
      const res = await app.inject({
        method: 'GET',
        url: '/api/availability?from=2099-08-31&to=2099-10-11',
        headers,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
