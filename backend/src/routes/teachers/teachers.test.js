import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Misma idea que users.test.js: la base va mockeada, así los tests corren sin
// Postgres levantado.
vi.mock('../../db/availability.js', () => ({
  findAvailabilityByTeacher: vi.fn(),
  replaceTeacherAvailability: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const { findAvailabilityByTeacher, replaceTeacherAvailability } = await import(
  '../../db/availability.js'
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

const SEMANA = { lunes: [{ start: '13:00', end: '15:30' }] };

describe('teacher availability', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('GET returns a single week, not grouped by subject', async () => {
    findAvailabilityByTeacher.mockResolvedValueOnce(SEMANA);
    const headers = await authedHeaders(app, 'student');

    const res = await app.inject({
      method: 'GET',
      url: '/api/teachers/t1/availability',
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(SEMANA);
    expect(findAvailabilityByTeacher).toHaveBeenCalledWith('t1');
  });

  it('PUT saves the week of the logged-in teacher', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/teachers/me/availability',
      headers,
      payload: { schedule: SEMANA },
    });

    expect(res.statusCode).toBe(200);
    expect(replaceTeacherAvailability).toHaveBeenCalledWith('user-1', SEMANA);
  });

  it('PUT rejects a student', async () => {
    const headers = await authedHeaders(app, 'student');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/teachers/me/availability',
      headers,
      payload: { schedule: SEMANA },
    });

    expect(res.statusCode).toBe(403);
    expect(replaceTeacherAvailability).not.toHaveBeenCalled();
  });

  it('PUT rejects a block shorter than one hour', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/teachers/me/availability',
      headers,
      payload: { schedule: { lunes: [{ start: '13:00', end: '13:30' }] } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ schedule: 'invalid' });
    expect(replaceTeacherAvailability).not.toHaveBeenCalled();
  });

  it('the old per-subject endpoint is gone', async () => {
    const headers = await authedHeaders(app);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/subjects/s1/availability',
      headers,
      payload: { schedule: SEMANA },
    });

    expect(res.statusCode).toBe(404);
  });
});
