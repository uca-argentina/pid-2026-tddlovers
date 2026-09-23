import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/classes.js', () => ({
  bookClass: vi.fn(),
  findClassById: vi.fn(),
  findClassesForUser: vi.fn(),
  hasOverlappingClass: vi.fn(),
}));

vi.mock('../../db/availability.js', () => ({
  findWindowById: vi.fn(),
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

const { bookClass, findClassById, hasOverlappingClass } = await import('../../db/classes.js');
const { findWindowById } = await import('../../db/availability.js');
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
const VENTANA_ID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';

// 2099-09-14 es lunes y no pasa nunca, para no depender del reloj.
const ventana = (over = {}) => ({
  id: VENTANA_ID,
  teacherId: DOCENTE,
  date: '2099-09-14',
  repeatsWeekly: false,
  start: '13:00',
  end: '15:00',
  subjectId: MATE,
  durationMinutes: 90,
  price: 15000,
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  address: null,
  ...over,
});

const reserva = (over = {}) => ({
  windowId: VENTANA_ID,
  date: '2099-09-14',
  startTime: '13:00',
  ...over,
});

describe('POST /api/classes', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    findWindowById.mockResolvedValue(ventana());
    hasOverlappingClass.mockResolvedValue(false);
    teacherTeachesSubject.mockResolvedValue(true);
    bookClass.mockResolvedValue({ id: 'c1' });
    findClassById.mockResolvedValue({ id: 'c1' });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('books a slot of the window: subject and duration come from it', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(201);
    expect(findWindowById).toHaveBeenCalledWith(VENTANA_ID);
    expect(teacherTeachesSubject).toHaveBeenCalledWith(DOCENTE, MATE);
    // La duración de la ventana, no 1 h fija.
    expect(hasOverlappingClass).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: '13:00', endTime: '14:30' })
    );
    expect(bookClass).toHaveBeenCalledWith({
      window: ventana(),
      studentId: 'user-1',
      date: '2099-09-14',
      startTime: '13:00',
    });
  });

  it('a subject in the body is ignored', async () => {
    const headers = await authedHeaders(app);
    const otra = '11111111-2222-4333-8444-555555555555';

    await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ subjectId: otra }),
    });

    expect(bookClass.mock.calls[0][0].window.subjectId).toBe(MATE);
  });

  it('asks for the window when it is missing', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ windowId: undefined }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ windowId: 'required' });
  });

  it('rejects a non-UUID window before touching the database', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ windowId: 'abc' }),
    });

    expect(res.statusCode).toBe(400);
    expect(findWindowById).not.toHaveBeenCalled();
  });

  it('a deleted window is no longer offered', async () => {
    findWindowById.mockResolvedValueOnce(null);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(bookClass).not.toHaveBeenCalled();
  });

  it('rejects a date the window does not fall on', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ date: '2099-09-21' }),
    });

    expect(res.statusCode).toBe(409);
    expect(bookClass).not.toHaveBeenCalled();
  });

  it('a weekly window can be booked on a later week', async () => {
    findWindowById.mockResolvedValueOnce(ventana({ repeatsWeekly: true }));
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ date: '2099-09-21' }),
    });

    expect(res.statusCode).toBe(201);
  });

  it('rejects a start outside the window', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ startTime: '15:00' }),
    });

    expect(res.statusCode).toBe(409);
    expect(bookClass).not.toHaveBeenCalled();
  });

  it('a window whose subject the teacher dropped is no longer offered', async () => {
    teacherTeachesSubject.mockResolvedValueOnce(false);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(bookClass).not.toHaveBeenCalled();
  });

  it('reports a clash with a class of the student first', async () => {
    hasOverlappingClass.mockResolvedValueOnce(true);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Ya tenés una clase reservada en ese horario.');
  });

  it('passes on the conflict when the group is already full', async () => {
    bookClass.mockResolvedValueOnce({ conflict: 'La clase grupal ya se llenó.' });
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('La clase grupal ya se llenó.');
  });

  it('only students can book', async () => {
    const headers = await authedHeaders(app, 'teacher');

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(403);
  });
});
