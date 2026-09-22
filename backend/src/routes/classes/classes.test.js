import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/classes.js', () => ({
  createClass: vi.fn(),
  findClassById: vi.fn(),
  findClassesForUser: vi.fn(),
  hasOverlappingClass: vi.fn(),
}));

vi.mock('../../db/availability.js', () => ({
  isWithinAvailability: vi.fn(),
}));

vi.mock('../../db/users.js', () => ({
  teacherTeachesSubject: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const { createClass, findClassById, hasOverlappingClass } = await import('../../db/classes.js');
const { isWithinAvailability } = await import('../../db/availability.js');
const { teacherTeachesSubject } = await import('../../db/users.js');
const { findValidSession } = await import('../../db/sessions.js');
const { buildApp } = await import('../../app.js');

const DOCENTE = '5b0e6c1a-2f3d-4a5b-8c7d-9e0f1a2b3c4d';
const MATE = '47ac9e88-4099-4ab4-b1fe-3898d7b279c4';

async function authedHeaders(app, role = 'student') {
  findValidSession.mockResolvedValue({
    session_id: 'session-1',
    user_id: 'user-1',
    email: 'a@example.com',
    role,
  });
  await app.ready();

  const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf-token' });
  const csrfCookie = csrfRes.cookies.find((c) => c.name === '_csrf');
  const signedSid = app.signCookie('session-1');

  return {
    'x-csrf-token': csrfRes.json().csrfToken,
    cookie: `${csrfCookie.name}=${csrfCookie.value}; sid=${signedSid}`,
  };
}

// Una fecha que no pasa nunca, para no depender del reloj.
const reserva = (over = {}) => ({
  date: '2099-09-14',
  teacherId: DOCENTE,
  subjectId: MATE,
  startTime: '13:00',
  ...over,
});

describe('POST /api/classes', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    hasOverlappingClass.mockResolvedValue(false);
    teacherTeachesSubject.mockResolvedValue(true);
    isWithinAvailability.mockResolvedValue(true);
    createClass.mockResolvedValue({ id: 'c1' });
    findClassById.mockResolvedValue({ id: 'c1' });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('books a class for the subject the student picked', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(201);
    expect(teacherTeachesSubject).toHaveBeenCalledWith(DOCENTE, MATE);
    // La disponibilidad ya no es por materia: se consulta sin ella.
    expect(isWithinAvailability).toHaveBeenCalledWith({
      teacherId: DOCENTE,
      dayKey: 'lunes',
      startTime: '13:00',
      endTime: '14:00',
    });
    expect(createClass).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: MATE, studentId: 'user-1', endTime: '14:00' })
    );
  });

  it('asks for the subject when it is missing', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ subjectId: undefined }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      message: 'Elegí la materia de la clase.',
      fields: { subjectId: 'required' },
    });
    expect(createClass).not.toHaveBeenCalled();
  });

  it('rejects a subject the teacher does not teach', async () => {
    teacherTeachesSubject.mockResolvedValueOnce(false);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ subjectId: 'invalid' });
    expect(createClass).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID subject before touching the database', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ subjectId: 'matematica' }),
    });

    expect(res.statusCode).toBe(400);
    expect(teacherTeachesSubject).not.toHaveBeenCalled();
  });

  it('rejects an hour outside the teacher availability', async () => {
    isWithinAvailability.mockResolvedValueOnce(false);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(createClass).not.toHaveBeenCalled();
  });

  it('only students can book', async () => {
    const headers = await authedHeaders(app, 'teacher');

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(403);
  });
});
