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

vi.mock('../../db/rates.js', () => ({
  findRatesByTeacher: vi.fn(),
}));

vi.mock('../../db/subjects.js', () => ({
  listSubjects: vi.fn(),
  countExistingSubjectIds: vi.fn(),
}));

const { updateUserProfile, findSubjectIdsByTeacher } = await import('../../db/users.js');
const { findValidSession, deleteExpiredSessions } = await import('../../db/sessions.js');
const { countExistingSubjectIds } = await import('../../db/subjects.js');
const { findRatesByTeacher } = await import('../../db/rates.js');
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
    findRatesByTeacher.mockResolvedValue([]);
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
      rates: [],
    });
    // El id sale de la sesión, no del body.
    expect(updateUserProfile).toHaveBeenCalledWith('user-1', {
      telefono: '+54 11 5555-5555',
      subjectIds: [MATE, FISICA],
      rates: undefined,
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
      payload: {
        telefono: '',
        subjectIds: [MATE],
        rates: [{ subjectId: MATE, modality: 'virtual', hourlyRateCents: 500000 }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().subjectIds).toEqual([]);
    expect(res.json().rates).toEqual([]);
    // Las materias del alumno ni se validan ni se guardan.
    expect(countExistingSubjectIds).not.toHaveBeenCalled();
    expect(updateUserProfile).toHaveBeenCalledWith('user-1', {
      telefono: null,
      subjectIds: undefined,
      rates: undefined,
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

  describe('rates', () => {
    const TEACHER = {
      id: 'user-1',
      email: 'a@example.com',
      role: 'teacher',
      nombre: 'Ada',
      apellido: 'Lovelace',
      telefono: null,
    };
    const tarifa = (over = {}) => ({
      subjectId: MATE,
      modality: 'virtual',
      hourlyRateCents: 500000,
      ...over,
    });

    it('saves the rates together with the subjects and returns them', async () => {
      countExistingSubjectIds.mockResolvedValueOnce(2);
      updateUserProfile.mockResolvedValueOnce(TEACHER);
      const rates = [tarifa(), tarifa({ subjectId: FISICA, modality: 'in_person', hourlyRateCents: 650050 })];
      findRatesByTeacher.mockResolvedValue(rates);

      const headers = await authedHeaders(app);
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/users/me',
        headers,
        payload: { telefono: '', subjectIds: [MATE, FISICA], rates },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().rates).toEqual(rates);
      expect(updateUserProfile).toHaveBeenCalledWith('user-1', {
        telefono: null,
        subjectIds: [MATE, FISICA],
        rates,
      });
    });

    it('rejects a rate for a subject being removed in the same request', async () => {
      countExistingSubjectIds.mockResolvedValueOnce(1);
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/users/me',
        headers,
        payload: { telefono: '', subjectIds: [FISICA], rates: [tarifa()] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().fields).toEqual({ rates: 'invalid' });
      expect(updateUserProfile).not.toHaveBeenCalled();
    });

    it('without subjectIds, checks the rates against the subjects already saved', async () => {
      findSubjectIdsByTeacher.mockResolvedValue([FISICA]);
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/users/me',
        headers,
        payload: { telefono: '', rates: [tarifa()] },
      });

      expect(res.statusCode).toBe(400);
      expect(findSubjectIdsByTeacher).toHaveBeenCalledWith('user-1');
      expect(updateUserProfile).not.toHaveBeenCalled();
    });

    it('rejects an amount with fractions of a cent', async () => {
      countExistingSubjectIds.mockResolvedValueOnce(1);
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/users/me',
        headers,
        payload: { telefono: '', subjectIds: [MATE], rates: [tarifa({ hourlyRateCents: 10.5 })] },
      });

      expect(res.statusCode).toBe(400);
      expect(updateUserProfile).not.toHaveBeenCalled();
    });
  });
});
