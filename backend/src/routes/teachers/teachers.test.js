import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Misma idea que users.test.js: la base va mockeada, así los tests corren sin
// Postgres levantado.
vi.mock('../../db/availability.js', () => ({
  createWindow: vi.fn(),
  deleteWindow: vi.fn(),
  findTeacherWindows: vi.fn(),
  updateWindow: vi.fn(),
}));

vi.mock('../../db/rates.js', () => ({
  teacherHasRateFor: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const { createWindow, deleteWindow, findTeacherWindows, updateWindow } = await import(
  '../../db/availability.js'
);
const { teacherHasRateFor } = await import('../../db/rates.js');
const { findValidSession } = await import('../../db/sessions.js');
const { buildApp } = await import('../../app.js');

async function authedHeaders(app, role = 'teacher') {
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

// Una fecha que no pasa nunca, para no depender del reloj.
const ventana = (over = {}) => ({
  date: '2099-09-14',
  repeatsWeekly: true,
  start: '13:00',
  end: '15:30',
  modality: 'in_person',
  maxStudents: 4,
  meetingUrl: '',
  locality: 'Puerto Madero, CABA',
  address: 'Av. Alicia Moreau de Justo 1300',
  ...over,
});

describe('teacher availability windows', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    teacherHasRateFor.mockResolvedValue(true);
    createWindow.mockImplementation(async (_teacherId, w) => ({ window: { id: VENTANA_ID, ...w } }));
    updateWindow.mockImplementation(async (_teacherId, id, w) => ({ window: { id, ...w } }));
    deleteWindow.mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('GET returns the windows of the logged-in teacher for the range', async () => {
    findTeacherWindows.mockResolvedValueOnce([{ id: VENTANA_ID }]);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/teachers/me/availability?from=2026-09-14&to=2026-09-20',
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: VENTANA_ID }]);
    expect(findTeacherWindows).toHaveBeenCalledWith({
      teacherId: 'user-1',
      from: '2026-09-14',
      to: '2026-09-20',
    });
  });

  it('GET needs a valid range', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'GET', url: '/api/teachers/me/availability', headers });

    expect(res.statusCode).toBe(400);
  });

  it('students have no availability', async () => {
    const headers = await authedHeaders(app, 'student');

    const get = await app.inject({
      method: 'GET',
      url: '/api/teachers/me/availability?from=2026-09-14&to=2026-09-20',
      headers,
    });
    const post = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/availability',
      headers,
      payload: ventana(),
    });

    expect(get.statusCode).toBe(403);
    expect(post.statusCode).toBe(403);
    expect(createWindow).not.toHaveBeenCalled();
  });

  it('POST saves a window for the logged-in teacher', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/availability',
      headers,
      payload: ventana(),
    });

    expect(res.statusCode).toBe(201);
    expect(teacherHasRateFor).toHaveBeenCalledWith('user-1', 'in_person');
    // Presencial: el link que haya quedado escrito no se guarda.
    const guardada = createWindow.mock.calls[0][1];
    expect(guardada).toMatchObject({ modality: 'in_person', meetingUrl: null, maxStudents: 4 });
    // Materia, duración y precio ya no son de la ventana.
    expect(guardada).not.toHaveProperty('subjectId');
    expect(guardada).not.toHaveProperty('price');
  });

  it('POST rejects a modality the teacher has no rates for', async () => {
    teacherHasRateFor.mockResolvedValueOnce(false);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/availability',
      headers,
      payload: ventana(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      message: 'No tenés tarifas para clases presenciales. Cargalas desde Mi perfil.',
      fields: { modality: 'invalid' },
    });
    expect(createWindow).not.toHaveBeenCalled();
  });

  it('PUT also checks the rates of the new modality', async () => {
    teacherHasRateFor.mockResolvedValueOnce(false);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/teachers/me/availability/${VENTANA_ID}`,
      headers,
      payload: ventana({ modality: 'virtual', meetingUrl: 'https://meet.example.com/abc' }),
    });

    expect(res.statusCode).toBe(400);
    expect(teacherHasRateFor).toHaveBeenCalledWith('user-1', 'virtual');
    expect(updateWindow).not.toHaveBeenCalled();
  });

  it('POST reports an overlap with another window as a conflict', async () => {
    createWindow.mockResolvedValueOnce({ conflict: 'Se pisa con otra clase tuya de 14:00 a 16:00.' });
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/availability',
      headers,
      payload: ventana(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Se pisa con otra clase tuya de 14:00 a 16:00.');
  });

  it('PUT updates a window and lets a weekly one keep its past start', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/teachers/me/availability/${VENTANA_ID}`,
      headers,
      payload: ventana({ date: '2020-01-06' }),
    });

    expect(res.statusCode).toBe(200);
    expect(updateWindow).toHaveBeenCalledWith(
      'user-1',
      VENTANA_ID,
      expect.objectContaining({ date: '2020-01-06' })
    );
  });

  it('PUT answers 404 for a window that is not yours', async () => {
    updateWindow.mockResolvedValueOnce(null);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/teachers/me/availability/${VENTANA_ID}`,
      headers,
      payload: ventana(),
    });

    expect(res.statusCode).toBe(404);
  });

  it('DELETE removes the window', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/teachers/me/availability/${VENTANA_ID}`,
      headers,
    });

    expect(res.statusCode).toBe(204);
    expect(deleteWindow).toHaveBeenCalledWith('user-1', VENTANA_ID);
  });

  it('DELETE of a non-UUID id never reaches the database', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/teachers/me/availability/abc',
      headers,
    });

    expect(res.statusCode).toBe(404);
    expect(deleteWindow).not.toHaveBeenCalled();
  });

  it('the old weekly template endpoint is gone', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/teachers/me/availability',
      headers,
      payload: { schedule: { lunes: [{ start: '13:00', end: '15:30' }] } },
    });

    expect(res.statusCode).toBe(404);
  });
});
