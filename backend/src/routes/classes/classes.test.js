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

vi.mock('../../db/classMaterials.js', () => ({
  addFiles: vi.fn(),
  deleteFile: vi.fn(),
  findFileMeta: vi.fn(),
  findMaterial: vi.fn(),
  saveSummary: vi.fn(),
}));

// El bucket (B2 en producción, MinIO en local) no se toca en los tests.
vi.mock('../../storage/files.js', () => ({
  deleteFiles: vi.fn(),
  isConfigured: vi.fn(() => true),
  newFileKey: vi.fn((classId, id) => `materials/${classId}/${id}`),
  putFile: vi.fn(),
  signedDownloadUrl: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const { findBookingById, findClassBookings, findStudentBooking, transitionBookings } = await import(
  '../../db/bookings.js'
);
const { findClass } = await import('../../db/classes.js');
const { addFiles, deleteFile, findFileMeta, findMaterial, saveSummary } = await import(
  '../../db/classMaterials.js'
);
const { deleteFiles, isConfigured, putFile, signedDownloadUrl } = await import(
  '../../storage/files.js'
);
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

// Una fecha que ya pasó: la clase terminó.
const PASADA = '2020-03-02';

// Lo que devuelven findClass, findClassBookings y findStudentBooking cuando la
// clase tiene esa reserva: la sesión ('user-1') es su docente o su alumno.
function como(reserva) {
  findClass.mockResolvedValue({
    id: reserva.classId,
    teacherId: reserva.teacherId,
    subjectId: reserva.subjectId,
    date: reserva.date,
    startTime: reserva.startTime,
    endTime: reserva.endTime,
    maxStudents: reserva.maxStudents,
    active: reserva.status !== 'cancelada',
  });
  findClassBookings.mockResolvedValue(reserva.status === 'cancelada' ? [] : [reserva]);
  findStudentBooking.mockResolvedValue(reserva.studentId === 'user-1' ? reserva : null);
}

describe('whole-class actions', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  const post = async (action, role = 'teacher') =>
    app.inject({
      method: 'POST',
      url: `/api/classes/${CLASE_ID}/${action}`,
      headers: await authedHeaders(app, role),
    });

  it('accepts every pending booking of the class', async () => {
    const una = unaReserva({ teacherId: 'user-1', studentId: 'alumno-1' });
    const otra = unaReserva({ id: 'otra-reserva', studentId: 'alumno-2', teacherId: 'user-1' });
    como(una);
    findClassBookings.mockResolvedValue([una, otra]);
    transitionBookings.mockResolvedValue(true);

    const res = await post('accept');

    expect(res.statusCode).toBe(200);
    expect(findClass).toHaveBeenCalledWith(CLASE_ID);
    expect(findClassBookings).toHaveBeenCalledWith(CLASE_ID);
    expect(transitionBookings.mock.calls[0][0]).toEqual([
      { id: RESERVA_ID, from: 'pendiente', to: 'aceptada' },
      { id: 'otra-reserva', from: 'pendiente', to: 'aceptada' },
    ]);
  });

  it('cancelling the class rejects the pending ones as the teacher', async () => {
    como(unaReserva({ teacherId: 'user-1', studentId: 'alumno-1' }));
    transitionBookings.mockResolvedValue(true);

    expect((await post('cancel')).statusCode).toBe(200);
    expect(transitionBookings.mock.calls[0][0][0]).toMatchObject({
      to: 'cancelada',
      cancelledBy: 'teacher',
      cancelReason: 'rechazada',
    });
  });

  it('a student of the class cannot act on all of it, and a stranger gets a 404', async () => {
    como(unaReserva());
    expect((await post('accept', 'student')).statusCode).toBe(403);

    como(unaReserva({ studentId: 'otro' }));
    expect((await post('accept', 'student')).statusCode).toBe(404);
    expect(transitionBookings).not.toHaveBeenCalled();
  });

  it('a class with no bookings left is a 409', async () => {
    como(unaReserva({ teacherId: 'user-1', studentId: 'alumno-1', status: 'cancelada' }));

    const res = await post('accept');

    expect(res.statusCode).toBe(409);
    expect(transitionBookings).not.toHaveBeenCalled();
  });

  it('an unknown action is a 404', async () => {
    como(unaReserva({ teacherId: 'user-1' }));
    expect((await post('pay')).statusCode).toBe(404);
  });
});

describe('class material', () => {
  let app;
  const FILE_ID = '3c2b1a09-8f7e-4d6c-9b5a-4a3b2c1d0e0f';
  const MATERIAL = { summary: 'Vimos límites', updatedAt: '2020-03-02T18:00:00.000Z', files: [] };
  // La sesión es 'user-1': como docente de la clase, o como su alumno.
  const delDocente = (over = {}) =>
    unaReserva({ teacherId: 'user-1', studentId: 'alumno-x', status: 'realizada', date: PASADA, ...over });
  const delAlumno = (over = {}) => unaReserva({ status: 'realizada', date: PASADA, ...over });

  beforeEach(() => {
    app = buildApp({ logger: false });
    findMaterial.mockResolvedValue(MATERIAL);
    addFiles.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  async function call(method, path, { role = 'teacher', payload, headers: extra } = {}) {
    const headers = { ...(await authedHeaders(app, role)), ...extra };
    return app.inject({ method, url: `/api/classes/${CLASE_ID}/${path}`, headers, payload });
  }

  function multipartBody(files) {
    const boundary = 'limite123';
    const parts = files.map(
      ({ name, type, content }) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\n` +
        `Content-Type: ${type}\r\n\r\n${content}\r\n`
    );
    return {
      payload: Buffer.from(`${parts.join('')}--${boundary}--\r\n`),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  it('the teacher and the student see the material of the class once it ended', async () => {
    como(delDocente());
    const comoDocente = await call('GET', 'material');
    expect(comoDocente.statusCode).toBe(200);
    expect(comoDocente.json()).toEqual(MATERIAL);
    expect(findMaterial).toHaveBeenLastCalledWith(CLASE_ID);

    como(delAlumno({ status: 'no_presentada' }));
    const comoAlumno = await call('GET', 'material', { role: 'student' });
    expect(comoAlumno.statusCode).toBe(200);
  });

  it('before the class ends there is no material', async () => {
    como(delAlumno({ status: 'confirmada', date: '2099-09-14' }));

    const res = await call('GET', 'material', { role: 'student' });

    expect(res.statusCode).toBe(409);
    expect(findMaterial).not.toHaveBeenCalled();
  });

  it('a cancelled booking does not see the material, and someone else\'s class is a 404', async () => {
    como(delAlumno({ status: 'cancelada' }));
    expect((await call('GET', 'material', { role: 'student' })).statusCode).toBe(409);

    como(unaReserva({ teacherId: DOCENTE, studentId: 'otro', date: PASADA }));
    expect((await call('GET', 'material', { role: 'student' })).statusCode).toBe(404);
  });

  it('the teacher saves the summary, trimmed', async () => {
    como(delDocente());

    const res = await call('PUT', 'material', { payload: { summary: '  Vimos límites  ' } });

    expect(res.statusCode).toBe(200);
    expect(saveSummary).toHaveBeenCalledWith(CLASE_ID, 'Vimos límites');
  });

  it('the student cannot edit the material', async () => {
    como(delAlumno());

    const res = await call('PUT', 'material', { role: 'student', payload: { summary: 'hola' } });

    expect(res.statusCode).toBe(403);
    expect(saveSummary).not.toHaveBeenCalled();
  });

  it('a summary that is too long is a 400', async () => {
    como(delDocente());

    const res = await call('PUT', 'material', { payload: { summary: 'a'.repeat(5001) } });

    expect(res.statusCode).toBe(400);
    expect(saveSummary).not.toHaveBeenCalled();
  });

  it('the teacher uploads several files at once: to the bucket first, then to the database', async () => {
    como(delDocente());
    const body = multipartBody([
      { name: 'apunte.pdf', type: 'application/pdf', content: '%PDF-1.4 hola' },
      { name: 'ejercicio.py', type: 'text/x-python', content: 'print("hola")' },
    ]);

    const res = await call('POST', 'material/files', body);

    expect(res.statusCode).toBe(201);
    expect(putFile).toHaveBeenCalledTimes(2);
    const [key, data, mime] = putFile.mock.calls[0];
    expect(key).toMatch(new RegExp(`^materials/${CLASE_ID}/`));
    expect([data.toString(), mime]).toEqual(['%PDF-1.4 hola', 'application/pdf']);
    const [claseId, files] = addFiles.mock.calls[0];
    expect(claseId).toBe(CLASE_ID);
    expect(files.map((f) => [f.name, f.mimeType, f.sizeBytes, f.storageKey])).toEqual([
      ['apunte.pdf', 'application/pdf', 13, putFile.mock.calls[0][0]],
      ['ejercicio.py', 'text/x-python', 13, putFile.mock.calls[1][0]],
    ]);
  });

  it('uploading before the class ends is refused', async () => {
    como(delDocente({ status: 'confirmada', date: '2099-09-14' }));
    const body = multipartBody([{ name: 'a.pdf', type: 'application/pdf', content: 'x' }]);

    const res = await call('POST', 'material/files', body);

    expect(res.statusCode).toBe(409);
    expect(putFile).not.toHaveBeenCalled();
    expect(addFiles).not.toHaveBeenCalled();
  });

  it('if the class material is already full nothing goes to the bucket', async () => {
    como(delDocente());
    const lleno = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, sizeBytes: 10 }));
    findMaterial.mockResolvedValue({ ...MATERIAL, files: lleno });
    const body = multipartBody([{ name: 'a.pdf', type: 'application/pdf', content: 'x' }]);

    const res = await call('POST', 'material/files', body);

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/20 archivos/);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('stops reading as soon as the upload no longer fits in the class', async () => {
    como(delDocente());
    // Le faltan 5 bytes para los 25 MB: el primer archivo ya no entra.
    const casi = [{ id: 'f0', sizeBytes: 25 * 1024 * 1024 - 5 }];
    findMaterial.mockResolvedValue({ ...MATERIAL, files: casi });
    const body = multipartBody([
      { name: 'a.pdf', type: 'application/pdf', content: '0123456789' },
      { name: 'b.pdf', type: 'application/pdf', content: '0123456789' },
    ]);

    const res = await call('POST', 'material/files', body);

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/25 MB/);
    // El corte es adentro del bucle (sin leer el resto): la conexión se cierra.
    expect(res.headers.connection).toBe('close');
    expect(putFile).not.toHaveBeenCalled();
  });

  it('if the database refuses (another upload got there first), the uploaded objects are removed', async () => {
    como(delDocente());
    addFiles.mockResolvedValue({ error: 'Una clase puede tener hasta 20 archivos.' });
    const body = multipartBody([{ name: 'a.pdf', type: 'application/pdf', content: 'x' }]);

    const res = await call('POST', 'material/files', body);

    expect(res.statusCode).toBe(400);
    expect(deleteFiles).toHaveBeenCalledWith([putFile.mock.calls[0][0]], expect.anything());
  });

  it('without the bucket configured, files answer 503', async () => {
    como(delDocente());
    isConfigured.mockReturnValueOnce(false);
    const body = multipartBody([{ name: 'a.pdf', type: 'application/pdf', content: 'x' }]);

    const res = await call('POST', 'material/files', body);

    expect(res.statusCode).toBe(503);
    expect(putFile).not.toHaveBeenCalled();
  });

  it('the teacher deletes a file of the class, also from the bucket', async () => {
    como(delDocente());
    deleteFile.mockResolvedValue('materials/user-1/abc');

    const res = await call('DELETE', `material/files/${FILE_ID}`);

    expect(res.statusCode).toBe(200);
    expect(deleteFile).toHaveBeenCalledWith(CLASE_ID, FILE_ID);
    expect(deleteFiles).toHaveBeenCalledWith(['materials/user-1/abc'], expect.anything());
  });

  it('deleting a file that is not there is a 404', async () => {
    como(delDocente());
    deleteFile.mockResolvedValue(null);

    expect((await call('DELETE', `material/files/${FILE_ID}`)).statusCode).toBe(404);
    expect(deleteFiles).not.toHaveBeenCalled();
  });

  it('downloading redirects to a short-lived signed link of the bucket', async () => {
    como(delAlumno());
    findFileMeta.mockResolvedValue({
      name: 'página.html',
      mimeType: 'text/html',
      storageKey: 'materials/x/y',
    });
    signedDownloadUrl.mockResolvedValue('https://bucket.example.com/materials/x/y?firma=1');

    const res = await call('GET', `material/files/${FILE_ID}`, { role: 'student' });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://bucket.example.com/materials/x/y?firma=1');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(signedDownloadUrl).toHaveBeenCalledWith('materials/x/y', {
      filename: 'página.html',
      mimeType: 'text/html',
    });
  });

  it('a student of another class gets no link', async () => {
    como(unaReserva({ teacherId: DOCENTE, studentId: 'otro', date: PASADA }));

    const res = await call('GET', `material/files/${FILE_ID}`, { role: 'student' });

    expect(res.statusCode).toBe(404);
    expect(signedDownloadUrl).not.toHaveBeenCalled();
  });
});

