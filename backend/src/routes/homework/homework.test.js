import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/classes.js', () => ({
  findClassById: vi.fn(),
  findTurnClasses: vi.fn(),
}));

vi.mock('../../db/homework.js', () => ({
  addMessage: vi.fn(),
  createHomework: vi.fn(),
  findStudentHomework: vi.fn(),
  findSubmission: vi.fn(),
  findTargets: vi.fn(),
  findTeacherHomework: vi.fn(),
  isStudentOf: vi.fn(),
  listMessages: vi.fn(),
  listStudentHomeworks: vi.fn(),
  listTeacherHomeworks: vi.fn(),
  saveFeedback: vi.fn(),
  saveSubmission: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const { findClassById, findTurnClasses } = await import('../../db/classes.js');
const db = await import('../../db/homework.js');
const { findValidSession } = await import('../../db/sessions.js');
const { buildApp } = await import('../../app.js');

const DOCENTE = '5b0e6c1a-2f3d-4a5b-8c7d-9e0f1a2b3c4d';
const ALUMNO = '47ac9e88-4099-4ab4-b1fe-3898d7b279c4';
const OTRO = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
const TAREA = '11111111-2222-4333-8444-555555555555';
const ENTREGA = '66666666-7777-4888-9999-000000000000';
const CLASE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

async function authedHeaders(app, role, userId) {
  findValidSession.mockResolvedValue({
    session_id: 'session-1',
    user_id: userId,
    email: 'a@example.com',
    role,
  });
  await app.ready();
  const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf-token' });
  const csrfCookie = csrfRes.cookies.find((c) => c.name === '_csrf');
  return {
    'x-csrf-token': csrfRes.json().csrfToken,
    cookie: `${csrfCookie.name}=${csrfCookie.value}; sid=${app.signCookie('session-1')}`,
  };
}

const entrega = (over = {}) => ({
  id: ENTREGA,
  studentId: ALUMNO,
  studentName: 'Sofía Ramírez',
  text: '',
  linkUrl: '',
  submittedAt: null,
  isLate: false,
  feedback: '',
  correctedAt: null,
  ...over,
});

const tarea = (over = {}) => ({
  id: TAREA,
  title: 'TP 1',
  description: '',
  dueDate: '2099-09-20',
  dueTime: '23:59',
  classDate: null,
  classStartTime: null,
  subjectName: null,
  teacherName: 'Laura Gómez',
  createdAt: '2099-09-01T12:00:00.000Z',
  submission: entrega(),
  ...over,
});

const acceso = (over = {}) => ({
  id: ENTREGA,
  homeworkId: TAREA,
  studentId: ALUMNO,
  teacherId: DOCENTE,
  submittedAt: '2099-09-14T12:00:00.000Z',
  correctedAt: null,
  ...over,
});

const NUEVA = { title: 'TP 1', description: '', dueDate: '2099-09-20', dueTime: '23:59' };

describe('/api/homework', () => {
  let app;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  const send = (method, url, headers, payload) => app.inject({ method, url, headers, payload });

  describe('GET /', () => {
    it('sin sesión da 401', async () => {
      await app.ready();
      expect((await app.inject({ method: 'GET', url: '/api/homework' })).statusCode).toBe(401);
    });

    it('el docente recibe las suyas', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      db.listTeacherHomeworks.mockResolvedValue([]);
      expect((await send('GET', '/api/homework', headers)).statusCode).toBe(200);
      expect(db.listTeacherHomeworks).toHaveBeenCalledWith(DOCENTE);
      expect(db.listStudentHomeworks).not.toHaveBeenCalled();
    });

    it('el alumno recibe las suyas', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      db.listStudentHomeworks.mockResolvedValue([tarea()]);
      const res = await send('GET', '/api/homework', headers);
      expect(res.json()).toHaveLength(1);
      expect(db.listStudentHomeworks).toHaveBeenCalledWith(ALUMNO);
    });

    it('el admin no tiene tareas', async () => {
      const headers = await authedHeaders(app, 'admin', OTRO);
      expect((await send('GET', '/api/homework', headers)).statusCode).toBe(403);
    });
  });

  describe('GET /targets', () => {
    it('es solo para docentes', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      expect((await send('GET', '/api/homework/targets', headers)).statusCode).toBe(403);
    });

    it('devuelve alumnos y grupales', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      db.findTargets.mockResolvedValue({ students: [], groups: [] });
      const res = await send('GET', '/api/homework/targets', headers);
      expect(res.json()).toEqual({ students: [], groups: [] });
      expect(db.findTargets.mock.calls[0][0]).toBe(DOCENTE);
    });
  });

  describe('POST /', () => {
    it('sin CSRF no pasa', async () => {
      await authedHeaders(app, 'teacher', DOCENTE);
      const res = await app.inject({
        method: 'POST',
        url: '/api/homework',
        headers: { cookie: `sid=${app.signCookie('session-1')}` },
        payload: NUEVA,
      });
      expect(res.statusCode).toBe(403);
      expect(db.createHomework).not.toHaveBeenCalled();
    });

    it('un alumno no asigna', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      const res = await send('POST', '/api/homework', headers, { ...NUEVA, studentId: OTRO });
      expect(res.statusCode).toBe(403);
    });

    it('asigna a un alumno suyo', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      db.isStudentOf.mockResolvedValue(true);
      db.createHomework.mockResolvedValue(TAREA);
      db.findTeacherHomework.mockResolvedValue({ id: TAREA, submissions: [] });

      const res = await send('POST', '/api/homework', headers, { ...NUEVA, studentId: ALUMNO });

      expect(res.statusCode).toBe(201);
      expect(db.isStudentOf).toHaveBeenCalledWith(DOCENTE, ALUMNO);
      expect(db.createHomework).toHaveBeenCalledWith(
        expect.objectContaining({ teacherId: DOCENTE, title: 'TP 1', studentIds: [ALUMNO] })
      );
    });

    it('no asigna a un alumno que no es suyo', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      db.isStudentOf.mockResolvedValue(false);
      const res = await send('POST', '/api/homework', headers, { ...NUEVA, studentId: OTRO });
      expect(res.statusCode).toBe(404);
      expect(db.createHomework).not.toHaveBeenCalled();
    });

    it('a una grupal le llega a los anotados, no a los cancelados', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      findClassById.mockResolvedValue({
        teacherId: DOCENTE,
        maxStudents: 5,
        date: '2099-09-14',
        startTime: '13:00',
        subjectId: 'materia',
      });
      findTurnClasses.mockResolvedValue([
        { studentId: ALUMNO, status: 'confirmada' },
        { studentId: OTRO, status: 'cancelada' },
      ]);
      db.createHomework.mockResolvedValue(TAREA);
      db.findTeacherHomework.mockResolvedValue({ id: TAREA, submissions: [] });

      const res = await send('POST', '/api/homework', headers, { ...NUEVA, classId: CLASE });

      expect(res.statusCode).toBe(201);
      expect(db.createHomework).toHaveBeenCalledWith(
        expect.objectContaining({
          studentIds: [ALUMNO],
          subjectId: 'materia',
          classDate: '2099-09-14',
          startTime: '13:00',
        })
      );
    });

    it('una clase ajena da 404 y una individual, 400', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      findClassById.mockResolvedValueOnce({ teacherId: OTRO, maxStudents: 5 });
      expect((await send('POST', '/api/homework', headers, { ...NUEVA, classId: CLASE })).statusCode).toBe(404);
      findClassById.mockResolvedValueOnce({ teacherId: DOCENTE, maxStudents: 1 });
      expect((await send('POST', '/api/homework', headers, { ...NUEVA, classId: CLASE })).statusCode).toBe(400);
    });

    it('exige exactamente un destino', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      expect((await send('POST', '/api/homework', headers, NUEVA)).statusCode).toBe(400);
      const ambos = { ...NUEVA, studentId: ALUMNO, classId: CLASE };
      expect((await send('POST', '/api/homework', headers, ambos)).statusCode).toBe(400);
    });

    it('no acepta una fecha pasada', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      const res = await send('POST', '/api/homework', headers, {
        ...NUEVA,
        dueDate: '2001-01-01',
        studentId: ALUMNO,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().fields).toEqual({ dueDate: 'invalid' });
    });
  });

  describe('PUT /:id/submission', () => {
    const url = `/api/homework/${TAREA}/submission`;

    it('en término no queda marcada', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      db.findStudentHomework.mockResolvedValue(tarea());
      db.saveSubmission.mockResolvedValue(true);

      const res = await send('PUT', url, headers, { text: 'Listo' });

      expect(res.statusCode).toBe(200);
      expect(db.saveSubmission).toHaveBeenCalledWith(ENTREGA, {
        text: 'Listo',
        linkUrl: '',
        isLate: false,
      });
    });

    it('vencida se acepta y queda marcada fuera de término', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      db.findStudentHomework.mockResolvedValue(tarea({ dueDate: '2001-01-01' }));
      db.saveSubmission.mockResolvedValue(true);

      const res = await send('PUT', url, headers, { linkUrl: 'https://x.com/tp' });

      expect(res.statusCode).toBe(200);
      expect(db.saveSubmission.mock.calls[0][1].isLate).toBe(true);
    });

    it('una tarea ajena da 404', async () => {
      const headers = await authedHeaders(app, 'student', OTRO);
      db.findStudentHomework.mockResolvedValue(null);
      expect((await send('PUT', url, headers, { text: 'x' })).statusCode).toBe(404);
      expect(db.findStudentHomework).toHaveBeenCalledWith(TAREA, OTRO);
    });

    it('el docente no entrega', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      expect((await send('PUT', url, headers, { text: 'x' })).statusCode).toBe(403);
    });

    it('corregida ya no se cambia', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      db.findStudentHomework.mockResolvedValue(
        tarea({ submission: entrega({ correctedAt: '2099-09-15T12:00:00.000Z' }) })
      );
      expect((await send('PUT', url, headers, { text: 'x' })).statusCode).toBe(409);
      expect(db.saveSubmission).not.toHaveBeenCalled();
    });

    it('si la corrigen en el medio avisa con un 409', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      db.findStudentHomework.mockResolvedValue(tarea());
      db.saveSubmission.mockResolvedValue(false);
      expect((await send('PUT', url, headers, { text: 'x' })).statusCode).toBe(409);
    });

    it('vacía da 400', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      db.findStudentHomework.mockResolvedValue(tarea());
      expect((await send('PUT', url, headers, { text: ' ' })).statusCode).toBe(400);
    });
  });

  describe('POST /submissions/:id/feedback', () => {
    const url = `/api/homework/submissions/${ENTREGA}/feedback`;

    it('el docente de la tarea corrige', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      db.findSubmission.mockResolvedValue(acceso());
      db.saveFeedback.mockResolvedValue(true);
      db.findTeacherHomework.mockResolvedValue({ id: TAREA, submissions: [] });

      const res = await send('POST', url, headers, { feedback: ' Muy bien ' });

      expect(res.statusCode).toBe(200);
      expect(db.saveFeedback).toHaveBeenCalledWith(ENTREGA, 'Muy bien');
    });

    it('sin entregar no se corrige', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      db.findSubmission.mockResolvedValue(acceso({ submittedAt: null }));
      expect((await send('POST', url, headers, { feedback: 'x' })).statusCode).toBe(409);
    });

    it('el alumno no se corrige solo', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      db.findSubmission.mockResolvedValue(acceso());
      expect((await send('POST', url, headers, { feedback: 'x' })).statusCode).toBe(403);
    });

    it('otro docente recibe 404', async () => {
      const headers = await authedHeaders(app, 'teacher', OTRO);
      db.findSubmission.mockResolvedValue(acceso());
      expect((await send('POST', url, headers, { feedback: 'x' })).statusCode).toBe(404);
    });

    it('sin texto da 400', async () => {
      const headers = await authedHeaders(app, 'teacher', DOCENTE);
      db.findSubmission.mockResolvedValue(acceso());
      expect((await send('POST', url, headers, { feedback: ' ' })).statusCode).toBe(400);
    });
  });

  describe('mensajes', () => {
    const url = `/api/homework/submissions/${ENTREGA}/messages`;

    it('los dos lados leen y escriben', async () => {
      db.findSubmission.mockResolvedValue(acceso());
      db.listMessages.mockResolvedValue([]);
      db.addMessage.mockResolvedValue({ id: 'm1' });

      let headers = await authedHeaders(app, 'student', ALUMNO);
      expect((await send('GET', url, headers)).statusCode).toBe(200);
      expect((await send('POST', url, headers, { body: ' Hola ' })).statusCode).toBe(201);
      expect(db.addMessage).toHaveBeenLastCalledWith({
        submissionId: ENTREGA,
        senderId: ALUMNO,
        body: 'Hola',
      });

      headers = await authedHeaders(app, 'teacher', DOCENTE);
      expect((await send('POST', url, headers, { body: 'Dale' })).statusCode).toBe(201);
      expect(db.addMessage).toHaveBeenLastCalledWith({
        submissionId: ENTREGA,
        senderId: DOCENTE,
        body: 'Dale',
      });
    });

    it('un tercero recibe 404', async () => {
      const headers = await authedHeaders(app, 'student', OTRO);
      db.findSubmission.mockResolvedValue(acceso());
      expect((await send('GET', url, headers)).statusCode).toBe(404);
      expect((await send('POST', url, headers, { body: 'x' })).statusCode).toBe(404);
    });

    it('antes de entregar no hay chat', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      db.findSubmission.mockResolvedValue(acceso({ submittedAt: null }));
      expect((await send('POST', url, headers, { body: 'x' })).statusCode).toBe(409);
      expect(db.addMessage).not.toHaveBeenCalled();
    });

    it('un id que no es UUID da 404, no un 500', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      const res = await send('GET', '/api/homework/submissions/1/messages', headers);
      expect(res.statusCode).toBe(404);
      expect(db.findSubmission).not.toHaveBeenCalled();
    });

    it('un mensaje vacío da 400', async () => {
      const headers = await authedHeaders(app, 'student', ALUMNO);
      db.findSubmission.mockResolvedValue(acceso());
      expect((await send('POST', url, headers, { body: ' ' })).statusCode).toBe(400);
    });
  });
});
