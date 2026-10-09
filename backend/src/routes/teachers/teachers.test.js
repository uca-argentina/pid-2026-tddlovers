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

vi.mock('../../db/users.js', () => ({
  listTeachers: vi.fn(),
}));

vi.mock('../../db/vacations.js', () => ({
  countClassesToCancel: vi.fn(),
  createVacation: vi.fn(),
  deleteVacation: vi.fn(),
  listTeacherVacations: vi.fn(),
}));

vi.mock('../../db/packs.js', () => ({
  createOffer: vi.fn(),
  deactivateOffer: vi.fn(),
  listTeacherOffers: vi.fn(),
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
const { listTeachers } = await import('../../db/users.js');
const { createOffer, deactivateOffer, listTeacherOffers } = await import('../../db/packs.js');
const { countClassesToCancel, createVacation, deleteVacation, listTeacherVacations } = await import(
  '../../db/vacations.js'
);
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
    const guardada = { id: VENTANA_ID, teacherId: 'user-1', ...ventana() };
    findTeacherWindows.mockResolvedValueOnce([guardada]);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/teachers/me/availability?from=2026-09-14&to=2026-09-20',
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([guardada]);
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
      // Con campos que no son de la ventana: la ruta tiene que guardar lo
      // validado, no el body tal como llegó.
      payload: ventana({ subjectId: 'x', durationMinutes: 45, price: 100 }),
    });

    expect(res.statusCode).toBe(201);
    expect(teacherHasRateFor).toHaveBeenCalledWith('user-1', 'in_person');
    // Presencial: el link que haya quedado escrito no se guarda.
    const guardada = createWindow.mock.calls[0][1];
    expect(guardada).toMatchObject({ modality: 'in_person', meetingUrl: null, maxStudents: 4 });
    // Materia, duración y precio los elige el alumno al reservar.
    expect(guardada).not.toHaveProperty('subjectId');
    expect(guardada).not.toHaveProperty('durationMinutes');
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
});

describe('teacher list', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('GET requires a session', async () => {
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/teachers' });

    expect(res.statusCode).toBe(401);
    expect(listTeachers).not.toHaveBeenCalled();
  });

  it('GET returns the teachers with their subjects', async () => {
    const docentes = [
      { id: 't1', nombre: 'Laura', apellido: 'Gómez', subjects: [{ id: 's1', name: 'Física' }] },
    ];
    listTeachers.mockResolvedValueOnce(docentes);
    const headers = await authedHeaders(app, 'student');

    const res = await app.inject({ method: 'GET', url: '/api/teachers', headers });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(docentes);
  });
});

describe('teacher packs', () => {
  let app;
  const PAQUETE_ID = '7c6b5a49-3827-4615-8a9b-0c1d2e3f4a5b';
  const paquete = { classCount: 4, classMinutes: 60, priceCents: 1800000, validityDays: 30 };

  beforeEach(() => {
    app = buildApp({ logger: false });
    createOffer.mockImplementation(async (teacherId, value) => ({
      id: PAQUETE_ID,
      teacherId,
      ...value,
      createdAt: '2099-09-01T12:00:00.000Z',
    }));
    deactivateOffer.mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('GET lists the packs of the logged-in teacher', async () => {
    listTeacherOffers.mockResolvedValueOnce([]);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'GET', url: '/api/teachers/me/packs', headers });

    expect(res.statusCode).toBe(200);
    expect(listTeacherOffers).toHaveBeenCalledWith('user-1');
  });

  it('POST creates a pack with quantity, class length, total price and validity', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/packs',
      headers,
      payload: paquete,
    });

    expect(res.statusCode).toBe(201);
    expect(createOffer).toHaveBeenCalledWith('user-1', paquete);
    expect(res.json().id).toBe(PAQUETE_ID);
  });

  it('POST validates the pack', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/packs',
      headers,
      payload: { ...paquete, classCount: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ classCount: 'invalid' });
    expect(createOffer).not.toHaveBeenCalled();
  });

  it('DELETE stops offering it', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/teachers/me/packs/${PAQUETE_ID}`,
      headers,
    });

    expect(res.statusCode).toBe(204);
    expect(deactivateOffer).toHaveBeenCalledWith('user-1', PAQUETE_ID);
  });

  it('DELETE of a pack that is not theirs is a 404', async () => {
    deactivateOffer.mockResolvedValueOnce(false);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/teachers/me/packs/${PAQUETE_ID}`,
      headers,
    });

    expect(res.statusCode).toBe(404);
  });

  it('students do not have packs to offer', async () => {
    const headers = await authedHeaders(app, 'student');

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/packs',
      headers,
      payload: paquete,
    });

    expect(res.statusCode).toBe(403);
    expect(createOffer).not.toHaveBeenCalled();
  });
});

describe('teacher vacations', () => {
  let app;
  const VACACIONES_ID = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
  // Lejos en el futuro, para no depender del reloj.
  const rango = { startDate: '2099-12-20', endDate: '2100-01-05' };
  const guardadas = { id: VACACIONES_ID, teacherId: 'user-1', ...rango };

  beforeEach(() => {
    app = buildApp({ logger: false });
    createVacation.mockResolvedValue({ vacation: guardadas, cancelled: 2 });
    deleteVacation.mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('GET lists the vacations of the logged-in teacher', async () => {
    listTeacherVacations.mockResolvedValueOnce([guardadas]);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'GET', url: '/api/teachers/me/vacations', headers });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([guardadas]);
    expect(listTeacherVacations).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ today: expect.any(String) })
    );
  });

  it('impact says how many bookings would be cancelled', async () => {
    countClassesToCancel.mockResolvedValueOnce(3);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/teachers/me/vacations/impact?startDate=2099-12-20&endDate=2100-01-05',
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelledClasses: 3 });
    expect(countClassesToCancel).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining(rango),
      expect.objectContaining({ iso: expect.any(String), time: expect.any(String) })
    );
  });

  it('POST saves the range and says how many bookings were cancelled', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/vacations',
      headers,
      payload: rango,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ...guardadas, cancelledClasses: 2 });
    expect(createVacation).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining(rango),
      expect.objectContaining({ iso: expect.any(String) })
    );
  });

  it('POST validates the range', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/vacations',
      headers,
      payload: { startDate: '2100-01-05', endDate: '2099-12-20' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ endDate: 'invalid' });
    expect(createVacation).not.toHaveBeenCalled();
  });

  it('POST says which vacation it overlaps with', async () => {
    createVacation.mockResolvedValueOnce({
      conflict: { id: 'otra', startDate: '2099-12-24', endDate: '2099-12-31' },
    });
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/vacations',
      headers,
      payload: rango,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Se pisa con tus vacaciones del 24/12/2099 al 31/12/2099.');
  });

  it('DELETE removes a range loaded by mistake', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/teachers/me/vacations/${VACACIONES_ID}`,
      headers,
    });

    expect(res.statusCode).toBe(204);
    expect(deleteVacation).toHaveBeenCalledWith('user-1', VACACIONES_ID);
  });

  it('DELETE of someone else\'s vacation is a 404', async () => {
    deleteVacation.mockResolvedValueOnce(false);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/teachers/me/vacations/${VACACIONES_ID}`,
      headers,
    });

    expect(res.statusCode).toBe(404);
  });

  it('students have no vacations', async () => {
    const headers = await authedHeaders(app, 'student');

    const res = await app.inject({
      method: 'POST',
      url: '/api/teachers/me/vacations',
      headers,
      payload: rango,
    });

    expect(res.statusCode).toBe(403);
    expect(createVacation).not.toHaveBeenCalled();
  });
});
