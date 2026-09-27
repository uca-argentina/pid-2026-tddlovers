import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/classes.js', () => ({
  bookClass: vi.fn(),
  expireStartedPending: vi.fn().mockResolvedValue(undefined),
  findClassById: vi.fn(),
  findClassesForUser: vi.fn(),
  hasOverlappingClass: vi.fn(),
  rescheduleClass: vi.fn(),
  transitionClass: vi.fn(),
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

const {
  bookClass,
  expireStartedPending,
  findClassById,
  findClassesForUser,
  hasOverlappingClass,
  rescheduleClass,
  transitionClass,
} = await import('../../db/classes.js');
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

// --- Estados ------------------------------------------------------------------

const CLASE_ID = '0d9c8b7a-6f5e-4d3c-8b2a-190817263544';
const ALUMNO = 'user-1';

// La sesión de los tests es siempre 'user-1': según el caso, es el alumno o
// el docente de la clase.
const clase = (over = {}) => ({
  id: CLASE_ID,
  date: '2099-09-14',
  startTime: '13:00',
  status: 'pendiente',
  paidAt: null,
  teacherId: DOCENTE,
  studentId: ALUMNO,
  subjectId: MATE,
  ...over,
});
const comoDocente = (over = {}) => clase({ teacherId: 'user-1', studentId: 'otro-alumno', ...over });
// Una fecha que ya pasó, para "la clase ya empezó".
const PASADA = '2020-03-02';

describe('class states', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    transitionClass.mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  async function post(path, { role = 'student', payload } = {}) {
    const headers = await authedHeaders(app, role);
    return app.inject({ method: 'POST', url: `/api/classes/${CLASE_ID}/${path}`, headers, payload });
  }

  it('listing expires pending classes that already started first', async () => {
    findClassesForUser.mockResolvedValueOnce([]);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/classes?from=2099-09-01&to=2099-09-30',
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(expireStartedPending).toHaveBeenCalled();
  });

  it('accepts the new statuses as a filter and rejects the old one', async () => {
    findClassesForUser.mockResolvedValue([]);
    const headers = await authedHeaders(app);
    const url = (status) => `/api/classes?from=2099-09-01&to=2099-09-30&status=${status}`;

    expect((await app.inject({ method: 'GET', url: url('confirmada'), headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: url('reservada'), headers })).statusCode).toBe(400);
  });

  it('someone else\'s class is a 404', async () => {
    findClassById.mockResolvedValue(clase({ teacherId: DOCENTE, studentId: 'otro' }));

    const res = await post('cancel');

    expect(res.statusCode).toBe(404);
    expect(transitionClass).not.toHaveBeenCalled();
  });

  it('the teacher accepts a pending class', async () => {
    findClassById.mockResolvedValue(comoDocente());

    const res = await post('accept', { role: 'teacher' });

    expect(res.statusCode).toBe(200);
    expect(transitionClass).toHaveBeenCalledWith(CLASE_ID, { from: 'pendiente', to: 'aceptada' });
  });

  it('the student cannot accept their own booking', async () => {
    findClassById.mockResolvedValue(clase());

    const res = await post('accept');

    expect(res.statusCode).toBe(403);
    expect(transitionClass).not.toHaveBeenCalled();
  });

  it('a teacher saying no to a pending class rejects it', async () => {
    findClassById.mockResolvedValue(comoDocente());

    await post('cancel', { role: 'teacher' });

    expect(transitionClass).toHaveBeenCalledWith(CLASE_ID, {
      from: 'pendiente',
      to: 'cancelada',
      cancelledBy: 'teacher',
      cancelReason: 'rechazada',
    });
  });

  it('the student cancels a confirmed class well in advance', async () => {
    findClassById.mockResolvedValue(clase({ status: 'confirmada' }));

    const res = await post('cancel');

    expect(res.statusCode).toBe(200);
    expect(transitionClass).toHaveBeenCalledWith(CLASE_ID, {
      from: 'confirmada',
      to: 'cancelada',
      cancelledBy: 'student',
      cancelReason: 'cancelada',
    });
  });

  it('a class that already started cannot be cancelled', async () => {
    findClassById.mockResolvedValue(clase({ status: 'confirmada', date: PASADA }));

    const res = await post('cancel');

    expect(res.statusCode).toBe(409);
    expect(transitionClass).not.toHaveBeenCalled();
  });

  it('paying an accepted class confirms it', async () => {
    findClassById.mockResolvedValue(clase({ status: 'aceptada' }));

    const res = await post('pay');

    expect(res.statusCode).toBe(200);
    expect(transitionClass).toHaveBeenCalledWith(CLASE_ID, {
      from: 'aceptada',
      to: 'confirmada',
      paid: true,
    });
  });

  it('paying a class that was already given keeps its status', async () => {
    findClassById.mockResolvedValue(clase({ status: 'realizada', date: PASADA }));

    await post('pay');

    expect(transitionClass).toHaveBeenCalledWith(CLASE_ID, {
      from: 'realizada',
      to: 'realizada',
      paid: true,
    });
  });

  it('a pending class cannot be paid yet', async () => {
    findClassById.mockResolvedValue(clase());

    const res = await post('pay');

    expect(res.statusCode).toBe(409);
  });

  it('the teacher takes attendance once the class started', async () => {
    findClassById.mockResolvedValue(comoDocente({ status: 'aceptada', date: PASADA }));

    const presente = await post('attendance', { role: 'teacher', payload: { attended: true } });
    expect(presente.statusCode).toBe(200);
    expect(transitionClass).toHaveBeenLastCalledWith(CLASE_ID, { from: 'aceptada', to: 'realizada' });

    await post('attendance', { role: 'teacher', payload: { attended: false } });
    expect(transitionClass).toHaveBeenLastCalledWith(CLASE_ID, {
      from: 'aceptada',
      to: 'no_presentada',
    });
  });

  it('attendance needs to say whether the student came', async () => {
    findClassById.mockResolvedValue(comoDocente({ status: 'confirmada', date: PASADA }));

    const res = await post('attendance', { role: 'teacher', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(transitionClass).not.toHaveBeenCalled();
  });

  it('attendance cannot be taken before the class starts', async () => {
    findClassById.mockResolvedValue(comoDocente({ status: 'confirmada' }));

    const res = await post('attendance', { role: 'teacher', payload: { attended: true } });

    expect(res.statusCode).toBe(409);
  });

  it('if the other side changed the class meanwhile, nothing is overwritten', async () => {
    findClassById.mockResolvedValue(clase());
    transitionClass.mockResolvedValue(false);

    const res = await post('cancel');

    expect(res.statusCode).toBe(409);
  });

  describe('reschedule', () => {
    beforeEach(() => {
      findWindowById.mockResolvedValue(ventana({ id: VENTANA_ID }));
      hasOverlappingClass.mockResolvedValue(false);
      findRate.mockResolvedValue(500000);
      rescheduleClass.mockResolvedValue({ id: 'nueva' });
    });

    const nuevoHorario = { windowId: VENTANA_ID, date: '2099-09-14', startTime: '14:00', durationMinutes: 60 };

    it('cancels the confirmed class and books a new pending one with the same subject', async () => {
      findClassById.mockResolvedValue(clase({ status: 'confirmada', date: '2099-09-07' }));

      const res = await post('reschedule', { payload: { ...nuevoHorario, subjectId: 'otra-cosa' } });

      expect(res.statusCode).toBe(201);
      expect(rescheduleClass).toHaveBeenCalledWith(
        CLASE_ID,
        expect.objectContaining({ subjectId: MATE, startTime: '14:00', endTime: '15:00' })
      );
      // Su propia clase vieja no cuenta como choque.
      expect(hasOverlappingClass).toHaveBeenCalledWith(expect.objectContaining({ excludeId: CLASE_ID }));
    });

    it('only with the same teacher', async () => {
      findClassById.mockResolvedValue(clase({ status: 'confirmada', teacherId: 'otro-docente' }));

      const res = await post('reschedule', { payload: nuevoHorario });

      expect(res.statusCode).toBe(409);
      expect(rescheduleClass).not.toHaveBeenCalled();
    });

    it('only a confirmed class', async () => {
      findClassById.mockResolvedValue(clase({ status: 'aceptada' }));

      const res = await post('reschedule', { payload: nuevoHorario });

      expect(res.statusCode).toBe(409);
      expect(rescheduleClass).not.toHaveBeenCalled();
    });
  });
});
