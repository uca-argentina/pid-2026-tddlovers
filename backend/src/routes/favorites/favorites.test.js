import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/favorites.js', () => ({
  addFavoriteTeacher: vi.fn(),
  listFavoriteTeachers: vi.fn(),
  removeFavoriteTeacher: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const { addFavoriteTeacher, listFavoriteTeachers, removeFavoriteTeacher } = await import(
  '../../db/favorites.js'
);
const { findValidSession } = await import('../../db/sessions.js');
const { buildApp } = await import('../../app.js');

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

const DOCENTE_ID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';

// Como la devuelve listFavoriteTeachers: misma forma que listTeachers.
const favorito = {
  id: DOCENTE_ID,
  nombre: 'Laura',
  apellido: 'Gómez',
  subjects: [{ id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Matemática' }],
};

describe('favorite teachers', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    addFavoriteTeacher.mockResolvedValue(true);
    removeFavoriteTeacher.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('GET returns the favorites of the logged-in student', async () => {
    listFavoriteTeachers.mockResolvedValueOnce([favorito]);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'GET', url: '/api/favorites', headers });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([favorito]);
    expect(listFavoriteTeachers).toHaveBeenCalledWith('user-1');
  });

  it('needs a session', async () => {
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/favorites' });
    expect(res.statusCode).toBe(401);
  });

  it('teachers and admins have no favorites', async () => {
    for (const role of ['teacher', 'admin']) {
      const headers = await authedHeaders(app, role);
      const get = await app.inject({ method: 'GET', url: '/api/favorites', headers });
      const put = await app.inject({ method: 'PUT', url: `/api/favorites/${DOCENTE_ID}`, headers });
      expect(get.statusCode).toBe(403);
      expect(put.statusCode).toBe(403);
    }
    expect(addFavoriteTeacher).not.toHaveBeenCalled();
  });

  it('PUT adds the teacher for the logged-in student', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'PUT', url: `/api/favorites/${DOCENTE_ID}`, headers });

    expect(res.statusCode).toBe(204);
    expect(addFavoriteTeacher).toHaveBeenCalledWith('user-1', DOCENTE_ID);
  });

  it('PUT answers 404 for something that is not an approved teacher', async () => {
    addFavoriteTeacher.mockResolvedValueOnce(false);
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'PUT', url: `/api/favorites/${DOCENTE_ID}`, headers });

    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/no está disponible/);
  });

  it('PUT rejects an id that is not a uuid without touching the db', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({ method: 'PUT', url: '/api/favorites/42', headers });

    expect(res.statusCode).toBe(404);
    expect(addFavoriteTeacher).not.toHaveBeenCalled();
  });

  it('PUT needs the csrf token', async () => {
    const { cookie } = await authedHeaders(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/favorites/${DOCENTE_ID}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(403);
    expect(addFavoriteTeacher).not.toHaveBeenCalled();
  });

  it('DELETE removes the teacher for the logged-in student', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/favorites/${DOCENTE_ID}`,
      headers,
    });

    expect(res.statusCode).toBe(204);
    expect(removeFavoriteTeacher).toHaveBeenCalledWith('user-1', DOCENTE_ID);
  });
});
