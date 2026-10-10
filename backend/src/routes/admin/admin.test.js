import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Misma idea que el resto de las rutas: la base va mockeada, así los tests
// corren sin Postgres levantado.
vi.mock('../../db/approvals.js', () => ({
  findTeacherForReview: vi.fn(),
  listTeachersForReview: vi.fn(),
  setTeacherApproval: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const { findTeacherForReview, listTeachersForReview, setTeacherApproval } = await import(
  '../../db/approvals.js'
);
const { findValidSession } = await import('../../db/sessions.js');
const { buildApp } = await import('../../app.js');

const ADMIN = 'user-1';
const DOCENTE = '5b0e6c1a-2f3d-4a5b-8c7d-9e0f1a2b3c4d';

async function authedHeaders(app, role = 'admin') {
  findValidSession.mockResolvedValue({
    session_id: 'session-1',
    user_id: ADMIN,
    email: 'admin@example.com',
    role,
    approval_status: role === 'teacher' ? 'approved' : null,
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

// Un docente tal como lo devuelve findTeacherForReview (TEACHER_REVIEW_COLUMNS
// en db/approvals.js).
const docente = (over = {}) => ({
  id: DOCENTE,
  email: 'laura@example.com',
  nombre: 'Laura',
  apellido: 'Gómez',
  telefono: null,
  approvalStatus: 'pending',
  reviewedAt: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  subjects: [{ id: '47ac9e88-4099-4ab4-b1fe-3898d7b279c4', name: 'Matemática' }],
  ratesCount: 1,
  ...over,
});

describe('admin routes', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
    setTeacherApproval.mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  describe('GET /api/admin/teachers', () => {
    it('lists the teachers of a status', async () => {
      listTeachersForReview.mockResolvedValueOnce([docente()]);
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/teachers?status=pending',
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([docente()]);
      expect(listTeachersForReview).toHaveBeenCalledWith({ status: 'pending' });
    });

    it('without a status lists all of them', async () => {
      listTeachersForReview.mockResolvedValueOnce([]);
      const headers = await authedHeaders(app);

      await app.inject({ method: 'GET', url: '/api/admin/teachers', headers });

      expect(listTeachersForReview).toHaveBeenCalledWith({ status: undefined });
    });

    it('rejects an unknown status', async () => {
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/teachers?status=pendiente',
        headers,
      });

      expect(res.statusCode).toBe(400);
      expect(listTeachersForReview).not.toHaveBeenCalled();
    });

    it('needs a session', async () => {
      await app.ready();
      const res = await app.inject({ method: 'GET', url: '/api/admin/teachers' });
      expect(res.statusCode).toBe(401);
    });

    it('is only for admins', async () => {
      for (const role of ['teacher', 'student']) {
        const headers = await authedHeaders(app, role);
        const res = await app.inject({ method: 'GET', url: '/api/admin/teachers', headers });
        expect(res.statusCode).toBe(403);
      }
      expect(listTeachersForReview).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/teachers/:id/approve', () => {
    it('approves a pending teacher and returns it updated', async () => {
      findTeacherForReview
        .mockResolvedValueOnce(docente())
        .mockResolvedValueOnce(docente({ approvalStatus: 'approved' }));
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${DOCENTE}/approve`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().approvalStatus).toBe('approved');
      // Quién decidió sale de la sesión.
      expect(setTeacherApproval).toHaveBeenCalledWith(DOCENTE, {
        from: 'pending',
        to: 'approved',
        reviewedBy: ADMIN,
      });
    });

    it('a rejected teacher can be approved later', async () => {
      findTeacherForReview.mockResolvedValue(docente({ approvalStatus: 'rejected' }));
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${DOCENTE}/approve`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(setTeacherApproval).toHaveBeenCalledWith(
        DOCENTE,
        expect.objectContaining({ from: 'rejected', to: 'approved' })
      );
    });

    it('does not approve twice', async () => {
      findTeacherForReview.mockResolvedValueOnce(docente({ approvalStatus: 'approved' }));
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${DOCENTE}/approve`,
        headers,
      });

      expect(res.statusCode).toBe(409);
      expect(setTeacherApproval).not.toHaveBeenCalled();
    });

    it('404 for an id that is not a teacher', async () => {
      findTeacherForReview.mockResolvedValueOnce(null);
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${DOCENTE}/approve`,
        headers,
      });

      expect(res.statusCode).toBe(404);
    });

    it('404 for a malformed id, without reaching the database', async () => {
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/teachers/abc/approve',
        headers,
      });

      expect(res.statusCode).toBe(404);
      expect(findTeacherForReview).not.toHaveBeenCalled();
    });

    it('409 when another admin decided in the meantime', async () => {
      findTeacherForReview.mockResolvedValueOnce(docente());
      setTeacherApproval.mockResolvedValueOnce(false);
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${DOCENTE}/approve`,
        headers,
      });

      expect(res.statusCode).toBe(409);
    });

    it('needs a CSRF token', async () => {
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${DOCENTE}/approve`,
        headers: { cookie: headers.cookie },
      });

      expect(res.statusCode).toBe(403);
      expect(setTeacherApproval).not.toHaveBeenCalled();
    });

    it('a teacher cannot approve anyone (not even themselves)', async () => {
      const headers = await authedHeaders(app, 'teacher');

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${ADMIN}/approve`,
        headers,
      });

      expect(res.statusCode).toBe(403);
      expect(setTeacherApproval).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/teachers/:id/reject', () => {
    it('rejects a pending teacher', async () => {
      findTeacherForReview
        .mockResolvedValueOnce(docente())
        .mockResolvedValueOnce(docente({ approvalStatus: 'rejected' }));
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${DOCENTE}/reject`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().approvalStatus).toBe('rejected');
      expect(setTeacherApproval).toHaveBeenCalledWith(DOCENTE, {
        from: 'pending',
        to: 'rejected',
        reviewedBy: ADMIN,
      });
    });

    it('an approved teacher can be taken down', async () => {
      findTeacherForReview.mockResolvedValue(docente({ approvalStatus: 'approved' }));
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${DOCENTE}/reject`,
        headers,
      });

      expect(res.statusCode).toBe(200);
    });

    it('does not reject twice', async () => {
      findTeacherForReview.mockResolvedValueOnce(docente({ approvalStatus: 'rejected' }));
      const headers = await authedHeaders(app);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/teachers/${DOCENTE}/reject`,
        headers,
      });

      expect(res.statusCode).toBe(409);
      expect(setTeacherApproval).not.toHaveBeenCalled();
    });
  });
});
