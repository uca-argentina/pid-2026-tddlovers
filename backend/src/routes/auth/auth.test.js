import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La capa de base está mockeada para que estos tests corran sin una conexión
// real a Postgres. Los tests de integración contra Postgres de verdad van en
// una suite aparte, enganchada a docker-compose.dev.yml.
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

// Las tarifas del docente también viajan en cada usuario (lib/publicUser).
vi.mock('../../db/rates.js', () => ({
  findRatesByTeacher: vi.fn(),
}));

vi.mock('../../db/subjects.js', () => ({
  listSubjects: vi.fn(),
  countExistingSubjectIds: vi.fn(),
}));

const { createUser, findUserByEmail, findUserById, emailExists, findSubjectIdsByTeacher } =
  await import('../../db/users.js');
const { createSession, findValidSession, deleteExpiredSessions } = await import(
  '../../db/sessions.js'
);
const { countExistingSubjectIds } = await import('../../db/subjects.js');
const { findRatesByTeacher } = await import('../../db/rates.js');
const { hashPassword } = await import('../../lib/password.js');
const { buildApp } = await import('../../app.js');

const STRONG_PASSWORD = 'Str0ngPassw0rd!';
const BASE_PAYLOAD = {
  email: 'a@example.com',
  password: STRONG_PASSWORD,
  role: 'student',
  nombre: 'Ada',
  apellido: 'Lovelace',
};

async function getCsrf(app) {
  const res = await app.inject({ method: 'GET', url: '/api/auth/csrf-token' });
  const cookie = res.cookies.find((c) => c.name === '_csrf');
  return { token: res.json().csrfToken, cookieHeader: `${cookie.name}=${cookie.value}` };
}

describe('auth routes', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    // Toda respuesta con un usuario adentro pasa por acá (ver lib/publicUser).
    // Por defecto sin materias; el test que las necesita lo pisa.
    findSubjectIdsByTeacher.mockResolvedValue([]);
    findRatesByTeacher.mockResolvedValue([]);
  });

  afterEach(async () => {
    // resetAllMocks (y no clearAllMocks) para que un mockResolvedValueOnce que
    // quedó sin consumir —porque el test cortó antes de llegar a usarlo— no se
    // filtre a las llamadas del test siguiente.
    vi.resetAllMocks();
    deleteExpiredSessions.mockResolvedValue(undefined);
    await app.close();
  });

  describe('GET /api/auth/check-email', () => {
    it('rejects an invalid email', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/check-email?email=nope' });
      expect(res.statusCode).toBe(400);
    });

    it('reports availability for a free email', async () => {
      emailExists.mockResolvedValueOnce(false);
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/check-email?email=free@example.com',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ available: true });
    });

    it('reports unavailability for a taken email', async () => {
      emailExists.mockResolvedValueOnce(true);
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/check-email?email=taken@example.com',
      });
      expect(res.json()).toEqual({ available: false });
    });
  });

  describe('POST /api/auth/register', () => {
    it('rejects a weak password', async () => {
      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: { ...BASE_PAYLOAD, password: 'weak' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a password with no special character', async () => {
      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: { ...BASE_PAYLOAD, password: 'Str0ngPassw0rd' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/carácter especial/);
    });

    it('rejects an invalid role', async () => {
      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: { ...BASE_PAYLOAD, role: 'admin' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a missing nombre/apellido', async () => {
      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: { ...BASE_PAYLOAD, nombre: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects registration without a CSRF token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: BASE_PAYLOAD,
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects a duplicate email', async () => {
      findUserByEmail.mockResolvedValueOnce({ id: '1', email: 'a@example.com' });
      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: BASE_PAYLOAD,
      });
      expect(res.statusCode).toBe(409);
    });

    it('rejects a teacher with unknown subjectIds', async () => {
      countExistingSubjectIds.mockResolvedValueOnce(1);
      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: {
          ...BASE_PAYLOAD,
          role: 'teacher',
          subjectIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('creates a student and sets a session cookie on success', async () => {
      findUserByEmail.mockResolvedValueOnce(null);
      createUser.mockResolvedValueOnce({
        id: 'user-1',
        email: 'a@example.com',
        role: 'student',
        nombre: 'Ada',
        apellido: 'Lovelace',
        telefono: null,
        subjectIds: [],
      });
      createSession.mockResolvedValueOnce({
        id: 'session-1',
        expires_at: new Date(Date.now() + 1000 * 60),
      });

      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: BASE_PAYLOAD,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        id: 'user-1',
        email: 'a@example.com',
        role: 'student',
        nombre: 'Ada',
        apellido: 'Lovelace',
        telefono: null,
        subjectIds: [],
        rates: [],
      });
      expect(res.cookies.some((c) => c.name === 'sid')).toBe(true);
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@example.com', role: 'student', subjectIds: [] })
      );
    });

    it('creates a teacher with valid subjectIds', async () => {
      findUserByEmail.mockResolvedValueOnce(null);
      countExistingSubjectIds.mockResolvedValueOnce(1);
      createUser.mockResolvedValueOnce({
        id: 'user-2',
        email: 'a@example.com',
        role: 'teacher',
        nombre: 'Ada',
        apellido: 'Lovelace',
        telefono: null,
        subjectIds: [],
      });
      createSession.mockResolvedValueOnce({
        id: 'session-1',
        expires_at: new Date(Date.now() + 1000 * 60),
      });

      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: {
          ...BASE_PAYLOAD,
          role: 'teacher',
          subjectIds: ['11111111-1111-1111-1111-111111111111'],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'teacher',
          subjectIds: ['11111111-1111-1111-1111-111111111111'],
        })
      );
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns 401 for an unknown email without revealing that', async () => {
      findUserByEmail.mockResolvedValueOnce(null);
      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: { email: 'nobody@example.com', password: STRONG_PASSWORD },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 for a wrong password', async () => {
      const passwordHash = await hashPassword(STRONG_PASSWORD);
      findUserByEmail.mockResolvedValueOnce({
        id: 'user-1',
        email: 'a@example.com',
        password_hash: passwordHash,
        role: 'student',
      });
      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: { email: 'a@example.com', password: 'WrongPassw0rd!' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('logs in and sets a session cookie on success', async () => {
      const passwordHash = await hashPassword(STRONG_PASSWORD);
      findUserByEmail.mockResolvedValueOnce({
        id: 'user-1',
        email: 'a@example.com',
        password_hash: passwordHash,
        role: 'teacher',
        nombre: 'Ada',
        apellido: 'Lovelace',
        telefono: null,
        subjectIds: [],
      });
      createSession.mockResolvedValueOnce({
        id: 'session-1',
        expires_at: new Date(Date.now() + 1000 * 60),
      });

      const { token, cookieHeader } = await getCsrf(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-csrf-token': token, cookie: cookieHeader },
        payload: { email: 'a@example.com', password: STRONG_PASSWORD },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: 'user-1',
        email: 'a@example.com',
        role: 'teacher',
        nombre: 'Ada',
        apellido: 'Lovelace',
        telefono: null,
        subjectIds: [],
        rates: [],
      });
      expect(res.cookies.some((c) => c.name === 'sid')).toBe(true);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 when there is no session cookie', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects an unsigned/tampered session id', async () => {
      findValidSession.mockResolvedValueOnce({
        session_id: 'session-1',
        user_id: 'user-1',
        email: 'a@example.com',
        role: 'student',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: 'sid=session-1' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns the current user when a valid signed session cookie is present', async () => {
      findValidSession.mockResolvedValueOnce({
        session_id: 'session-1',
        user_id: 'user-1',
        email: 'a@example.com',
        role: 'student',
      });
      // /me relee el usuario de la base: la sesión sola no trae nombre,
      // apellido ni teléfono, y el front los necesita para el perfil.
      findUserById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'a@example.com',
        role: 'student',
        nombre: 'Ada',
        apellido: 'Lovelace',
        telefono: null,
      });

      await app.ready();
      const signedSid = app.signCookie('session-1');
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: `sid=${signedSid}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: 'user-1',
        email: 'a@example.com',
        role: 'student',
        nombre: 'Ada',
        apellido: 'Lovelace',
        telefono: null,
        subjectIds: [],
        rates: [],
      });
    });
  });
});
