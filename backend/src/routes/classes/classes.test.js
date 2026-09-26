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

vi.mock('../../db/rates.js', () => ({
  findRate: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const { bookClass, findClassById, hasOverlappingClass } = await import('../../db/classes.js');
const { findWindowById } = await import('../../db/availability.js');
const { findRate } = await import('../../db/rates.js');
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

const VENTANA_ID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';

// 2099-09-14 es lunes y no pasa nunca, para no depender del reloj.
const ventana = (over = {}) => ({
  id: VENTANA_ID,
  teacherId: DOCENTE,
  date: '2099-09-14',
  repeatsWeekly: false,
  start: '13:00',
  end: '15:00',
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
  subjectId: MATE,
  durationMinutes: 90,
  ...over,
});

describe('POST /api/classes', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    findWindowById.mockResolvedValue(ventana());
    hasOverlappingClass.mockResolvedValue(false);
    // $ 5.000 la hora.
    findRate.mockResolvedValue(500000);
    bookClass.mockResolvedValue({ id: 'c1' });
    findClassById.mockResolvedValue({ id: 'c1' });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('books the subject and duration the student chose, priced from the hourly rate', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(201);
    expect(findWindowById).toHaveBeenCalledWith(VENTANA_ID);
    // La tarifa de esa materia en la modalidad de la ventana.
    expect(findRate).toHaveBeenCalledWith({ teacherId: DOCENTE, subjectId: MATE, modality: 'virtual' });
    expect(hasOverlappingClass).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: '13:00', endTime: '14:30' })
    );
    expect(bookClass).toHaveBeenCalledWith({
      window: ventana(),
      studentId: 'user-1',
      date: '2099-09-14',
      startTime: '13:00',
      endTime: '14:30',
      subjectId: MATE,
      // 1 h 30 min a $ 5.000/h.
      priceCents: 750000,
    });
  });

  it('a free duration is priced to the cent', async () => {
    const headers = await authedHeaders(app);

    await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ durationMinutes: 50 }),
    });

    expect(bookClass.mock.calls[0][0]).toMatchObject({ endTime: '13:50', priceCents: 416667 });
  });

  it('a price in the body is ignored', async () => {
    const headers = await authedHeaders(app);

    await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ priceCents: 1, price: 1 }),
    });

    expect(bookClass.mock.calls[0][0].priceCents).toBe(750000);
  });

  it('asks for the subject', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ subjectId: undefined }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ subjectId: 'required' });
  });

  it('rejects durations under 30 minutes or not in steps of 5', async () => {
    const headers = await authedHeaders(app);

    for (const durationMinutes of [25, 47, '60', undefined]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/classes',
        headers,
        payload: reserva({ durationMinutes }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().fields).toEqual({ durationMinutes: 'invalid' });
    }
    expect(bookClass).not.toHaveBeenCalled();
  });

  it('rejects a class that runs past the end of the window', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ startTime: '14:00', durationMinutes: 65 }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual({ durationMinutes: 'invalid' });
    expect(bookClass).not.toHaveBeenCalled();
  });

  it('a class can end exactly when the window does', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers,
      payload: reserva({ startTime: '14:00', durationMinutes: 60 }),
    });

    expect(res.statusCode).toBe(201);
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

  it('a subject without a rate in that modality is not offered', async () => {
    findRate.mockResolvedValueOnce(null);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('El docente ya no da esa materia en esta modalidad.');
    expect(bookClass).not.toHaveBeenCalled();
  });

  it('reports a clash with a class of the student first', async () => {
    hasOverlappingClass.mockResolvedValueOnce(true);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Ya tenés una clase reservada en ese horario.');
  });

  it('passes on the conflict when joining a group with another subject or duration', async () => {
    const mensaje =
      'A esa hora ya hay una clase grupal de otra materia o duración. Sumate a esa o elegí otro horario.';
    bookClass.mockResolvedValueOnce({ conflict: mensaje });
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/classes', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe(mensaje);
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
