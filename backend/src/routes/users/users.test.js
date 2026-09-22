import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Misma idea que auth.test.js: la base va mockeada, así los tests corren sin
// Postgres levantado.
vi.mock('../../db/users.js', () => ({
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  emailExists: vi.fn(),
  findSubjectIdsByTeacher: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../db/subjects.js', () => ({
  listSubjects: vi.fn(),
  countExistingSubjectIds: vi.fn(),
}));

const { updateUserProfile, findSubjectIdsByTeacher } = await import('../../db/users.js');
const { findValidSession, deleteExpiredSessions } = await import('../../db/sessions.js');
const { countExistingSubjectIds } = await import('../../db/subjects.js');
const { buildApp } = await import('../../app.js');

const MATE = '47ac9e88-4099-4ab4-b1fe-3898d7b279c4';
const FISICA = 'fe220bd6-9180-448d-8430-4dcccc866303';

/** Deja una sesión válida y devuelve las cabeceras para pegarle al PATCH. */
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

describe('PATCH /api/users/me', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    findSubjectIdsByTeacher.mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.resetAllMocks();
    deleteExpiredSessions.mockResolvedValue(undefined);
    await app.close();
  });

  it('rejects an anonymous request', async () => {
    await app.ready();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { telefono: '+54 11 5555-5555' },
    });
    // Sin sesión no importa el CSRF: 401 o 403, pero nunca se guarda nada.
    expect([401, 403]).toContain(res.statusCode);
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects a request without a CSRF token', async () => {
    findValidSession.mockResolvedValue({
      session_id: 'session-1',
      user_id: 'user-1',
      email: 'a@example.com',
      role: 'teacher',
    });
    await app.ready();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers: { cookie: `sid=${app.signCookie('session-1')}` },
      payload: { telefono: '+54 11 5555-5555' },
    });
    expect(res.statusCode).toBe(403);
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects a malformed telefono', async () => {
    const headers = await authedHeaders(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers,
      payload: { telefono: 'no es un teléfono' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ telefono: 'invalid' });
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects subjectIds that do not exist', async () => {
    countExistingSubjectIds.mockResolvedValueOnce(1);
    const headers = await authedHeaders(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers,
      payload: { telefono: '', subjectIds: [MATE, FISICA] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ subjectIds: 'invalid' });
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('saves telefono and subjects for a teacher', async () => {
    countExistingSubjectIds.mockResolvedValueOnce(2);
    updateUserProfile.mockResolvedValueOnce({
      id: 'user-1',
      email: 'a@example.com',
      role: 'teacher',
      nombre: 'Ada',
      apellido: 'Lovelace',
      telefono: '+54 11 5555-5555',
    });
    findSubjectIdsByTeacher.mockResolvedValue([MATE, FISICA]);

    const headers = await authedHeaders(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers,
      payload: { telefono: '+54 11 5555-5555', subjectIds: [MATE, FISICA] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 'user-1',
      email: 'a@example.com',
      role: 'teacher',
      nombre: 'Ada',
      apellido: 'Lovelace',
      telefono: '+54 11 5555-5555',
      subjectIds: [MATE, FISICA],
    });
    // El id sale de la sesión, no del body.
    expect(updateUserProfile).toHaveBeenCalledWith('user-1', {
      telefono: '+54 11 5555-5555',
      subjectIds: [MATE, FISICA],
    });
  });

  it('ignores subjectIds sent by a student', async () => {
    updateUserProfile.mockResolvedValueOnce({
      id: 'user-1',
      email: 'a@example.com',
      role: 'student',
      nombre: 'Ada',
      apellido: 'Lovelace',
      telefono: null,
    });

    const headers = await authedHeaders(app, 'student');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers,
      payload: { telefono: '', subjectIds: [MATE] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().subjectIds).toEqual([]);
    // Las materias del alumno ni se validan ni se guardan.
    expect(countExistingSubjectIds).not.toHaveBeenCalled();
    expect(updateUserProfile).toHaveBeenCalledWith('user-1', {
      telefono: null,
      subjectIds: undefined,
    });
  });

  it('accepts an empty telefono (the field is optional)', async () => {
    updateUserProfile.mockResolvedValueOnce({
      id: 'user-1',
      email: 'a@example.com',
      role: 'teacher',
      nombre: 'Ada',
      apellido: 'Lovelace',
      telefono: null,
    });

    const headers = await authedHeaders(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers,
      payload: { telefono: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().telefono).toBeNull();
  });
});
