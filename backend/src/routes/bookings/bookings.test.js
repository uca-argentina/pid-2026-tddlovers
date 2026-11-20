import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/bookings.js', () => ({
  createBooking: vi.fn(),
  expireStartedPending: vi.fn().mockResolvedValue(undefined),
  findBookingById: vi.fn(),
  findBookingsForUser: vi.fn(),
  findClassBookings: vi.fn(),
  findStudentBooking: vi.fn(),
  rescheduleBooking: vi.fn(),
  studentHasOverlappingBooking: vi.fn(),
  transitionBooking: vi.fn(),
  transitionBookings: vi.fn(),
}));

vi.mock('../../db/classes.js', () => ({
  findActiveClasses: vi.fn(),
  findClass: vi.fn(),
}));

vi.mock('../../db/availability.js', () => ({
  findWindowById: vi.fn(),
}));

vi.mock('../../db/rates.js', () => ({
  findRate: vi.fn(),
}));

vi.mock('../../db/packs.js', () => ({
  listStudentPacks: vi.fn(),
}));

vi.mock('../../db/neuronas.js', () => ({
  findBalance: vi.fn(),
  settleHomeworkCredits: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../db/vacations.js', () => ({
  isTeacherOnVacation: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const {
  createBooking,
  expireStartedPending,
  findBookingById,
  findBookingsForUser,
  rescheduleBooking,
  studentHasOverlappingBooking,
  transitionBooking,
} = await import('../../db/bookings.js');
const { findWindowById } = await import('../../db/availability.js');
const { findRate } = await import('../../db/rates.js');
const { listStudentPacks } = await import('../../db/packs.js');
const { isTeacherOnVacation } = await import('../../db/vacations.js');
const { findBalance } = await import('../../db/neuronas.js');
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
  locality: null,
  address: null,
  teacherName: 'Laura Gómez',
  teacherApprovalStatus: 'approved',
  teacherAcceptsRewards: false,
  ...over,
});

// RESERVA_ID es el id de la RESERVA (el de /api/bookings/:id); CLASE_ID
// es el de su clase (classes.id, el de /api/classes/:classId), compartido en
// una grupal.
const RESERVA_ID = '0d9c8b7a-6f5e-4d3c-8b2a-190817263544';
const CLASE_ID = 'c1a55e00-0000-4000-8000-000000000001';
const ALUMNO = 'user-1';

// Una reserva tal como la devuelve findBookingById (BOOKING_COLUMNS en
// db/bookings.js). La sesión de los tests es siempre 'user-1': según el caso,
// es el alumno o el docente de la clase.
const unaReserva = (over = {}) => ({
  id: RESERVA_ID,
  classId: CLASE_ID,
  date: '2099-09-14',
  startTime: '13:00',
  endTime: '14:30',
  subjectId: MATE,
  subjectName: 'Matemática',
  teacherId: DOCENTE,
  teacherName: 'Laura Gómez',
  studentId: ALUMNO,
  studentName: 'Sofía Ramírez',
  status: 'pendiente',
  availabilityId: VENTANA_ID,
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  address: null,
  locality: null,
  priceCents: 750000,
  paidAt: null,
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

const reserva = (over = {}) => ({
  windowId: VENTANA_ID,
  date: '2099-09-14',
  startTime: '13:00',
  subjectId: MATE,
  durationMinutes: 90,
  ...over,
});

describe('POST /api/bookings', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    findWindowById.mockResolvedValue(ventana());
    studentHasOverlappingBooking.mockResolvedValue(false);
    // $ 5.000 la hora.
    findRate.mockResolvedValue(500000);
    createBooking.mockResolvedValue({ id: RESERVA_ID });
    findBookingById.mockResolvedValue(unaReserva());
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('books the subject and duration the student chose, priced from the hourly rate', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(201);
    expect(findWindowById).toHaveBeenCalledWith(VENTANA_ID);
    // La tarifa de esa materia en la modalidad de la ventana.
    expect(findRate).toHaveBeenCalledWith({ teacherId: DOCENTE, subjectId: MATE, modality: 'virtual' });
    expect(studentHasOverlappingBooking).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: '13:00', endTime: '14:30' })
    );
    expect(createBooking).toHaveBeenCalledWith({
      window: ventana(),
      studentId: 'user-1',
      date: '2099-09-14',
      startTime: '13:00',
      endTime: '14:30',
      subjectId: MATE,
      // 1 h 30 min a $ 5.000/h.
      priceCents: 750000,
      studentPackId: null,
      packTokens: 0,
      rewardType: null,
      rewardNeuronas: 0,
    });
  });

  it('expires started pending bookings before checking, so a stale one does not block the slot', async () => {
    const headers = await authedHeaders(app);

    await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(expireStartedPending).toHaveBeenCalledTimes(1);
    expect(expireStartedPending.mock.invocationCallOrder[0]).toBeLessThan(
      studentHasOverlappingBooking.mock.invocationCallOrder[0]
    );
  });

  it('a date that does not exist is a 400, not a 500 from Postgres', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers,
      payload: reserva({ date: '2099-02-30' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ date: 'invalid' });
    expect(findWindowById).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('a free duration is priced to the cent', async () => {
    const headers = await authedHeaders(app);

    await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers,
      payload: reserva({ durationMinutes: 50 }),
    });

    expect(createBooking.mock.calls[0][0]).toMatchObject({ endTime: '13:50', priceCents: 416667 });
  });

  it('a price in the body is ignored', async () => {
    const headers = await authedHeaders(app);

    await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers,
      payload: reserva({ priceCents: 1, price: 1 }),
    });

    expect(createBooking.mock.calls[0][0].priceCents).toBe(750000);
  });

  it('asks for the subject', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
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
        url: '/api/bookings',
        headers,
        payload: reserva({ durationMinutes }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().fields).toEqual({ durationMinutes: 'invalid' });
    }
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('rejects a class that runs past the end of the window', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers,
      payload: reserva({ startTime: '14:00', durationMinutes: 65 }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual({ durationMinutes: 'invalid' });
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('a class can end exactly when the window does', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers,
      payload: reserva({ startTime: '14:00', durationMinutes: 60 }),
    });

    expect(res.statusCode).toBe(201);
  });

  it('asks for the window when it is missing', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
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
      url: '/api/bookings',
      headers,
      payload: reserva({ windowId: 'abc' }),
    });

    expect(res.statusCode).toBe(400);
    expect(findWindowById).not.toHaveBeenCalled();
  });

  it('a deleted window is no longer offered', async () => {
    findWindowById.mockResolvedValueOnce(null);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('a teacher pending approval cannot receive bookings', async () => {
    findWindowById.mockResolvedValueOnce(ventana({ teacherApprovalStatus: 'pending' }));
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/no puede recibir reservas/);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('a rejected teacher cannot receive bookings either', async () => {
    findWindowById.mockResolvedValueOnce(ventana({ teacherApprovalStatus: 'rejected' }));
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('a teacher on vacation that day cannot be booked', async () => {
    isTeacherOnVacation.mockResolvedValueOnce(true);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/licencia/);
    expect(isTeacherOnVacation).toHaveBeenCalledWith(DOCENTE, '2099-09-14');
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('passes on the conflict when the vacation was loaded meanwhile', async () => {
    createBooking.mockResolvedValueOnce({ conflict: 'El docente está de licencia ese día.' });
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
  });

  it('rejects a date the window does not fall on', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers,
      payload: reserva({ date: '2099-09-21' }),
    });

    expect(res.statusCode).toBe(409);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('a weekly window can be booked on a later week', async () => {
    findWindowById.mockResolvedValueOnce(ventana({ repeatsWeekly: true }));
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers,
      payload: reserva({ date: '2099-09-21' }),
    });

    expect(res.statusCode).toBe(201);
  });

  it('rejects a start outside the window', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers,
      payload: reserva({ startTime: '15:00' }),
    });

    expect(res.statusCode).toBe(409);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('a subject without a rate in that modality is not offered', async () => {
    findRate.mockResolvedValueOnce(null);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('El docente ya no da esa materia en esta modalidad.');
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('reports a clash with a class of the student first', async () => {
    studentHasOverlappingBooking.mockResolvedValueOnce(true);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Ya tenés una clase reservada en ese horario.');
  });

  it('passes on the conflict when joining a group with another subject or duration', async () => {
    const mensaje =
      'A esa hora ya hay una clase grupal de otra materia o duración. Sumate a esa o elegí otro horario.';
    createBooking.mockResolvedValueOnce({ conflict: mensaje });
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe(mensaje);
  });

  it('passes on the conflict when the group is already full', async () => {
    createBooking.mockResolvedValueOnce({ conflict: 'La clase grupal ya se llenó.' });
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('La clase grupal ya se llenó.');
  });

  it('only students can book', async () => {
    const headers = await authedHeaders(app, 'teacher');

    const res = await app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva() });

    expect(res.statusCode).toBe(403);
  });
});

// --- Estados ------------------------------------------------------------------

const comoDocente = (over = {}) => unaReserva({ teacherId: 'user-1', studentId: 'otro-alumno', ...over });
// Una fecha que ya pasó, para "la clase ya empezó".
const PASADA = '2020-03-02';

// Un paquete comprado tal como lo devuelve listStudentPacks (db/packs.js): 4
// clases de 1 h.
const PACK_ID = '3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d';
const paqueteComprado = (over = {}) => ({
  id: PACK_ID,
  packId: 'oferta-1',
  teacherId: DOCENTE,
  teacherName: 'Laura Gómez',
  classCount: 4,
  classMinutes: 60,
  priceCents: 1800000,
  purchasedAt: '2099-09-01T12:00:00.000Z',
  expiresOn: '2099-09-30',
  attended: 0,
  reserved: 0,
  ...over,
});

describe('POST /api/bookings with a pack', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    findWindowById.mockResolvedValue(ventana());
    studentHasOverlappingBooking.mockResolvedValue(false);
    // $ 5.000 la hora.
    findRate.mockResolvedValue(500000);
    createBooking.mockResolvedValue({ id: RESERVA_ID });
    findBookingById.mockResolvedValue(unaReserva());
    listStudentPacks.mockResolvedValue([paqueteComprado()]);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  const reservar = async (payload) => {
    const headers = await authedHeaders(app);
    return app.inject({ method: 'POST', url: '/api/bookings', headers, payload });
  };

  it('a class as long as the tokens used costs nothing more', async () => {
    const res = await reservar(
      reserva({ durationMinutes: 60, packId: PACK_ID, packTokens: 1 })
    );

    expect(res.statusCode).toBe(201);
    expect(listStudentPacks).toHaveBeenCalledWith({
      studentId: 'user-1',
      teacherId: DOCENTE,
      excludeBookingId: null,
    });
    // Materia, modalidad y duración las sigue eligiendo el alumno.
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: MATE,
        endTime: '14:00',
        priceCents: 0,
        studentPackId: PACK_ID,
        packTokens: 1,
      })
    );
  });

  it('1 h 30 with one token of 1 h pays the extra 30 min', async () => {
    const res = await reservar(reserva({ packId: PACK_ID, packTokens: 1 }));

    expect(res.statusCode).toBe(201);
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ endTime: '14:30', priceCents: 250000, packTokens: 1 })
    );
  });

  it('can use more than one token in a longer class', async () => {
    findWindowById.mockResolvedValue(ventana({ end: '16:00' }));

    const res = await reservar(
      reserva({ durationMinutes: 150, packId: PACK_ID, packTokens: 2 })
    );

    expect(res.statusCode).toBe(201);
    // 2 h cubiertas + 30 min a $ 5.000/h.
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ priceCents: 250000, packTokens: 2 })
    );
  });

  it('the tokens cannot cover more than the class lasts', async () => {
    const res = await reservar(reserva({ packId: PACK_ID, packTokens: 2 }));

    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ packTokens: 'invalid' });
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('without a pack the pack is not touched and the whole class is paid', async () => {
    await reservar(reserva());

    expect(listStudentPacks).not.toHaveBeenCalled();
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ studentPackId: null, packTokens: 0, priceCents: 750000 })
    );
  });

  it('tokens without a pack, or a malformed pack id, are rejected', async () => {
    expect((await reservar(reserva({ packTokens: 1 }))).statusCode).toBe(400);
    expect((await reservar(reserva({ packId: 'abc', packTokens: 1 }))).statusCode).toBe(400);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('asking for more tokens than are available is a conflict', async () => {
    listStudentPacks.mockResolvedValueOnce([paqueteComprado({ attended: 3, reserved: 1 })]);

    const res = await reservar(reserva({ packId: PACK_ID, packTokens: 1 }));

    expect(res.statusCode).toBe(409);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('cannot book a class after the pack expires', async () => {
    listStudentPacks.mockResolvedValueOnce([paqueteComprado({ expiresOn: '2099-09-13' })]);

    const res = await reservar(reserva({ packId: PACK_ID, packTokens: 1 }));

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/vence/);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('someone else\'s pack, or one with another teacher, is not found', async () => {
    listStudentPacks.mockResolvedValueOnce([]);

    const res = await reservar(reserva({ packId: PACK_ID, packTokens: 1 }));

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/No tenés ese paquete/);
  });

  it('passes on the conflict when the pack filled up meanwhile', async () => {
    createBooking.mockResolvedValueOnce({ conflict: 'Ya no te quedan clases disponibles en el paquete.' });

    const res = await reservar(reserva({ packId: PACK_ID, packTokens: 1 }));

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/paquete/);
  });
});

describe('booking states', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    transitionBooking.mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  async function post(path, { role = 'student', payload } = {}) {
    const headers = await authedHeaders(app, role);
    return app.inject({ method: 'POST', url: `/api/bookings/${RESERVA_ID}/${path}`, headers, payload });
  }

  it('listing expires pending classes that already started first', async () => {
    findBookingsForUser.mockResolvedValueOnce([]);
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/bookings?from=2099-09-01&to=2099-09-30',
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(expireStartedPending).toHaveBeenCalled();
  });

  it('accepts the new statuses as a filter and rejects the old one', async () => {
    findBookingsForUser.mockResolvedValue([]);
    const headers = await authedHeaders(app);
    const url = (status) => `/api/bookings?from=2099-09-01&to=2099-09-30&status=${status}`;

    expect((await app.inject({ method: 'GET', url: url('confirmada'), headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: url('reservada'), headers })).statusCode).toBe(400);
  });

  it('someone else\'s class is a 404', async () => {
    findBookingById.mockResolvedValue(unaReserva({ teacherId: DOCENTE, studentId: 'otro' }));

    const res = await post('cancel');

    expect(res.statusCode).toBe(404);
    expect(transitionBooking).not.toHaveBeenCalled();
  });

  it('the teacher accepts a pending class', async () => {
    findBookingById.mockResolvedValue(comoDocente());

    const res = await post('accept', { role: 'teacher' });

    expect(res.statusCode).toBe(200);
    expect(transitionBooking).toHaveBeenCalledWith(RESERVA_ID, { from: 'pendiente', to: 'aceptada' });
  });

  it('accepting a class the pack covers entirely confirms it, already paid', async () => {
    findBookingById.mockResolvedValue(comoDocente({ studentPackId: PACK_ID, packTokens: 1, priceCents: 0 }));

    const res = await post('accept', { role: 'teacher' });

    expect(res.statusCode).toBe(200);
    expect(transitionBooking).toHaveBeenCalledWith(RESERVA_ID, {
      from: 'pendiente',
      to: 'confirmada',
      paid: true,
    });
  });

  it('a pack class with an extra to pay is accepted and still has to be paid', async () => {
    findBookingById.mockResolvedValue(
      comoDocente({ studentPackId: PACK_ID, packTokens: 1, priceCents: 250000 })
    );

    const res = await post('accept', { role: 'teacher' });

    expect(res.statusCode).toBe(200);
    expect(transitionBooking).toHaveBeenCalledWith(RESERVA_ID, { from: 'pendiente', to: 'aceptada' });
  });

  it('the student cannot accept their own booking', async () => {
    findBookingById.mockResolvedValue(unaReserva());

    const res = await post('accept');

    expect(res.statusCode).toBe(403);
    expect(transitionBooking).not.toHaveBeenCalled();
  });

  it('a teacher saying no to a pending class rejects it', async () => {
    findBookingById.mockResolvedValue(comoDocente());

    await post('cancel', { role: 'teacher' });

    expect(transitionBooking).toHaveBeenCalledWith(RESERVA_ID, {
      from: 'pendiente',
      to: 'cancelada',
      cancelledBy: 'teacher',
      cancelReason: 'rechazada',
    });
  });

  it('the student cancels a confirmed class well in advance', async () => {
    findBookingById.mockResolvedValue(unaReserva({ status: 'confirmada' }));

    const res = await post('cancel');

    expect(res.statusCode).toBe(200);
    expect(transitionBooking).toHaveBeenCalledWith(RESERVA_ID, {
      from: 'confirmada',
      to: 'cancelada',
      cancelledBy: 'student',
      cancelReason: 'cancelada',
    });
  });

  it('a class that already started cannot be cancelled', async () => {
    findBookingById.mockResolvedValue(unaReserva({ status: 'confirmada', date: PASADA }));

    const res = await post('cancel');

    expect(res.statusCode).toBe(409);
    expect(transitionBooking).not.toHaveBeenCalled();
  });

  it('paying an accepted class confirms it', async () => {
    findBookingById.mockResolvedValue(unaReserva({ status: 'aceptada' }));

    const res = await post('pay');

    expect(res.statusCode).toBe(200);
    expect(transitionBooking).toHaveBeenCalledWith(RESERVA_ID, {
      from: 'aceptada',
      to: 'confirmada',
      paid: true,
    });
  });

  it('paying a class that was already given keeps its status', async () => {
    findBookingById.mockResolvedValue(unaReserva({ status: 'realizada', date: PASADA }));

    await post('pay');

    expect(transitionBooking).toHaveBeenCalledWith(RESERVA_ID, {
      from: 'realizada',
      to: 'realizada',
      paid: true,
    });
  });

  it('a pending class cannot be paid yet', async () => {
    findBookingById.mockResolvedValue(unaReserva());

    const res = await post('pay');

    expect(res.statusCode).toBe(409);
  });

  it('the student sees the exact address only once the class is paid', async () => {
    const presencial = {
      modality: 'in_person',
      meetingUrl: null,
      address: 'Honduras 4800 · CP 1414 · Palermo, CABA',
      locality: 'Palermo',
    };
    const headers = await authedHeaders(app);
    findBookingsForUser.mockResolvedValue([
      unaReserva({ ...presencial, id: 'a', status: 'pendiente' }),
      unaReserva({ ...presencial, id: 'b', status: 'aceptada' }),
      unaReserva({ ...presencial, id: 'c', status: 'confirmada', paidAt: '2099-09-01T12:00:00Z' }),
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/bookings?from=2099-09-01&to=2099-09-30',
      headers,
    });

    expect(res.json().map((c) => [c.id, c.address, c.locality])).toEqual([
      ['a', null, 'Palermo'],
      ['b', null, 'Palermo'],
      ['c', presencial.address, 'Palermo'],
    ]);
  });

  it('paying returns the class with the exact address', async () => {
    const presencial = { modality: 'in_person', address: 'Honduras 4800', locality: 'Palermo' };
    findBookingById
      .mockResolvedValueOnce(unaReserva({ ...presencial, status: 'aceptada' }))
      .mockResolvedValueOnce(
        unaReserva({ ...presencial, status: 'confirmada', paidAt: '2099-09-01T12:00:00Z' })
      );

    const res = await post('pay');

    expect(res.statusCode).toBe(200);
    expect(res.json().address).toBe('Honduras 4800');
  });

  it('the teacher always sees the address', async () => {
    findBookingById.mockResolvedValue(
      comoDocente({ modality: 'in_person', address: 'Honduras 4800', status: 'pendiente' })
    );
    const headers = await authedHeaders(app, 'teacher');

    const res = await app.inject({ method: 'GET', url: `/api/bookings/${RESERVA_ID}`, headers });

    expect(res.json().address).toBe('Honduras 4800');
  });

  it('the teacher takes attendance once the class started', async () => {
    findBookingById.mockResolvedValue(comoDocente({ status: 'aceptada', date: PASADA }));

    const presente = await post('attendance', { role: 'teacher', payload: { attended: true } });
    expect(presente.statusCode).toBe(200);
    expect(transitionBooking).toHaveBeenLastCalledWith(RESERVA_ID, { from: 'aceptada', to: 'realizada' });

    await post('attendance', { role: 'teacher', payload: { attended: false } });
    expect(transitionBooking).toHaveBeenLastCalledWith(RESERVA_ID, {
      from: 'aceptada',
      to: 'no_presentada',
    });
  });

  it('attendance needs to say whether the student came', async () => {
    findBookingById.mockResolvedValue(comoDocente({ status: 'confirmada', date: PASADA }));

    const res = await post('attendance', { role: 'teacher', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(transitionBooking).not.toHaveBeenCalled();
  });

  it('attendance cannot be taken before the class starts', async () => {
    findBookingById.mockResolvedValue(comoDocente({ status: 'confirmada' }));

    const res = await post('attendance', { role: 'teacher', payload: { attended: true } });

    expect(res.statusCode).toBe(409);
  });

  it('if the other side changed the class meanwhile, nothing is overwritten', async () => {
    findBookingById.mockResolvedValue(unaReserva());
    transitionBooking.mockResolvedValue(false);

    const res = await post('cancel');

    expect(res.statusCode).toBe(409);
  });

  describe('reschedule', () => {
    beforeEach(() => {
      findWindowById.mockResolvedValue(ventana({ id: VENTANA_ID }));
      studentHasOverlappingBooking.mockResolvedValue(false);
      findRate.mockResolvedValue(500000);
      rescheduleBooking.mockResolvedValue({ id: 'nueva' });
    });

    const nuevoHorario = { windowId: VENTANA_ID, date: '2099-09-14', startTime: '14:00', durationMinutes: 60 };

    it('cancels the confirmed class and books a new pending one with the same subject', async () => {
      findBookingById.mockResolvedValue(unaReserva({ status: 'confirmada', date: '2099-09-07' }));

      const res = await post('reschedule', { payload: { ...nuevoHorario, subjectId: 'otra-cosa' } });

      expect(res.statusCode).toBe(201);
      expect(rescheduleBooking).toHaveBeenCalledWith(
        RESERVA_ID,
        expect.objectContaining({ subjectId: MATE, startTime: '14:00', endTime: '15:00' })
      );
      // Su propia clase vieja no cuenta como choque.
      expect(studentHasOverlappingBooking).toHaveBeenCalledWith(expect.objectContaining({ excludeBookingId: RESERVA_ID }));
    });

    it('a reschedule can use pack tokens, and the old class does not hold its own', async () => {
      findBookingById.mockResolvedValue(
        unaReserva({ status: 'confirmada', date: '2099-09-07', studentPackId: PACK_ID, packTokens: 1 })
      );
      listStudentPacks.mockResolvedValueOnce([paqueteComprado({ reserved: 0 })]);

      const res = await post('reschedule', {
        payload: { ...nuevoHorario, packId: PACK_ID, packTokens: 1 },
      });

      expect(res.statusCode).toBe(201);
      // La vieja se cancela en la misma transacción: no ocupa lugar.
      expect(listStudentPacks).toHaveBeenCalledWith(
        expect.objectContaining({ excludeBookingId: RESERVA_ID })
      );
      expect(rescheduleBooking).toHaveBeenCalledWith(
        RESERVA_ID,
        expect.objectContaining({ studentPackId: PACK_ID, packTokens: 1, priceCents: 0 })
      );
    });

    it('only with the same teacher', async () => {
      findBookingById.mockResolvedValue(unaReserva({ status: 'confirmada', teacherId: 'otro-docente' }));

      const res = await post('reschedule', { payload: nuevoHorario });

      expect(res.statusCode).toBe(409);
      expect(rescheduleBooking).not.toHaveBeenCalled();
    });

    it('only a confirmed class', async () => {
      findBookingById.mockResolvedValue(unaReserva({ status: 'aceptada' }));

      const res = await post('reschedule', { payload: nuevoHorario });

      expect(res.statusCode).toBe(409);
      expect(rescheduleBooking).not.toHaveBeenCalled();
    });
  });
});

describe('canjear neuronas al reservar', () => {
  let app;
  const canje = { rewardType: 'free_60', durationMinutes: 90 };

  const reservar = async (body) => {
    const headers = await authedHeaders(app);
    return app.inject({ method: 'POST', url: '/api/bookings', headers, payload: reserva(body) });
  };

  beforeEach(() => {
    app = buildApp({ logger: false });
    vi.clearAllMocks();
    findWindowById.mockResolvedValue(ventana({ teacherAcceptsRewards: true }));
    findRate.mockResolvedValue(500000);
    studentHasOverlappingBooking.mockResolvedValue(false);
    isTeacherOnVacation.mockResolvedValue(false);
    findBalance.mockResolvedValue({ balance: 1000, earned: 1000 });
    createBooking.mockResolvedValue({ id: RESERVA_ID });
    findBookingById.mockResolvedValue(unaReserva());
  });

  afterEach(async () => {
    await app.close();
  });

  it('cubre lo canjeado y cobra solo el resto', async () => {
    const res = await reservar(canje);

    expect(res.statusCode).toBe(201);
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        // Quedan 30 min de 1 h 30 a $ 5.000/h.
        priceCents: 250000,
        rewardType: 'free_60',
        rewardNeuronas: 1000,
      })
    );
  });

  it('el descuento se aplica solo sobre los primeros 60 minutos', async () => {
    await reservar({ rewardType: 'discount_20', durationMinutes: 90 });

    // $ 7.500 menos el 20% de $ 5.000.
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 650000 }));
  });

  it('rechaza si no alcanzan las neuronas', async () => {
    findBalance.mockResolvedValue({ balance: 999, earned: 999 });

    const res = await reservar(canje);

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('No te alcanzan las neuronas.');
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('rechaza si el docente no acepta canjes', async () => {
    findWindowById.mockResolvedValue(ventana({ teacherAcceptsRewards: false }));

    expect((await reservar(canje)).statusCode).toBe(409);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('rechaza un canje que cubre más de lo que dura la clase', async () => {
    expect((await reservar({ rewardType: 'free_60', durationMinutes: 30 })).statusCode).toBe(409);
  });

  it('rechaza un tipo de canje que no existe, también los heredados de Object', async () => {
    expect((await reservar({ rewardType: 'free_999', durationMinutes: 60 })).statusCode).toBe(400);
    expect((await reservar({ rewardType: 'toString', durationMinutes: 60 })).statusCode).toBe(400);
  });

  it('no combina canje y paquete', async () => {
    const res = await reservar({ ...canje, packId: RESERVA_ID, packTokens: 1 });

    expect(res.statusCode).toBe(400);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('aceptar una clase cubierta por el canje la confirma paga', async () => {
    findBookingById.mockResolvedValue(
      unaReserva({ teacherId: 'user-1', studentId: ALUMNO + '-otro', priceCents: 0, rewardType: 'free_60', rewardNeuronas: 1000 })
    );
    transitionBooking.mockResolvedValue(true);
    const headers = await authedHeaders(app, 'teacher');

    await app.inject({ method: 'POST', url: `/api/bookings/${RESERVA_ID}/accept`, headers });

    expect(transitionBooking).toHaveBeenCalledWith(
      RESERVA_ID,
      expect.objectContaining({ to: 'confirmada', paid: true })
    );
  });
});
