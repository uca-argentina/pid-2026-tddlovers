import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/packs.js', () => ({
  buyPack: vi.fn(),
  findOfferById: vi.fn(),
  listOffers: vi.fn(),
  listStudentPacks: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

// "Hoy" fijo: el vencimiento se cuenta desde la compra.
vi.mock('../../lib/clock.js', () => ({
  now: () => ({ iso: '2099-09-10', time: '10:00' }),
  todayIso: () => '2099-09-10',
}));

const { buyPack, findOfferById, listOffers, listStudentPacks } = await import(
  '../../db/packs.js'
);
const { findValidSession } = await import('../../db/sessions.js');
const { buildApp } = await import('../../app.js');

const DOCENTE = '5b0e6c1a-2f3d-4a5b-8c7d-9e0f1a2b3c4d';
const OFERTA = '7c6b5a49-3827-4615-8a9b-0c1d2e3f4a5b';

async function authedHeaders(app, role = 'student') {
  findValidSession.mockResolvedValue({
    session_id: 'session-1',
    user_id: 'user-1',
    email: 'a@example.com',
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

// Un paquete ofrecido como lo devuelve findOfferById (db/packs.js).
const oferta = (over = {}) => ({
  id: OFERTA,
  teacherId: DOCENTE,
  classCount: 4,
  priceCents: 1800000,
  validityDays: 30,
  createdAt: '2099-09-01T12:00:00.000Z',
  active: true,
  teacherName: 'Laura Gómez',
  teacherApprovalStatus: 'approved',
  ...over,
});

// Un paquete comprado como lo devuelven listStudentPacks y buyPack.
const comprado = (over = {}) => ({
  id: 'sp-1',
  packId: OFERTA,
  teacherId: DOCENTE,
  teacherName: 'Laura Gómez',
  classCount: 4,
  priceCents: 1800000,
  purchasedAt: '2099-09-10T13:00:00.000Z',
  expiresOn: '2099-10-09',
  attended: 0,
  reserved: 0,
  ...over,
});

describe('packs routes', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  describe('GET /api/packs', () => {
    it('lists the packs on offer, optionally of one teacher', async () => {
      listOffers.mockResolvedValue([oferta()]);
      const headers = await authedHeaders(app);

      const res = await app.inject({ method: 'GET', url: `/api/packs?teacherId=${DOCENTE}`, headers });

      expect(res.statusCode).toBe(200);
      expect(listOffers).toHaveBeenCalledWith({ teacherId: DOCENTE });
    });

    it('rejects a malformed teacherId', async () => {
      const headers = await authedHeaders(app);
      const res = await app.inject({ method: 'GET', url: '/api/packs?teacherId=abc', headers });
      expect(res.statusCode).toBe(400);
    });

    it('needs a session', async () => {
      await app.ready();
      const res = await app.inject({ method: 'GET', url: '/api/packs' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/packs/mine', () => {
    it('returns the student packs with what is left', async () => {
      listStudentPacks.mockResolvedValue([
        comprado({ attended: 1, reserved: 1 }),
        comprado({ id: 'sp-2', expiresOn: '2099-09-01' }),
      ]);
      const headers = await authedHeaders(app);

      const res = await app.inject({ method: 'GET', url: '/api/packs/mine', headers });

      expect(res.statusCode).toBe(200);
      expect(listStudentPacks).toHaveBeenCalledWith({ studentId: 'user-1' });
      const [activo, vencido] = res.json();
      // Una asistencia descontó una; la reservada todavía no.
      expect(activo).toMatchObject({ remaining: 3, available: 2, expired: false });
      expect(vencido.expired).toBe(true);
    });

    it('is only for students', async () => {
      const headers = await authedHeaders(app, 'teacher');
      const res = await app.inject({ method: 'GET', url: '/api/packs/mine', headers });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/packs/:id/buy', () => {
    const comprar = async (role = 'student', id = OFERTA, withCsrf = true) => {
      const headers = await authedHeaders(app, role);
      return app.inject({
        method: 'POST',
        url: `/api/packs/${id}/buy`,
        headers: withCsrf ? headers : { cookie: headers.cookie },
      });
    };

    it('buys the pack, expiring counted from today', async () => {
      findOfferById.mockResolvedValue(oferta());
      buyPack.mockResolvedValue(comprado());

      const res = await comprar();

      expect(res.statusCode).toBe(201);
      expect(buyPack).toHaveBeenCalledWith({
        offer: oferta(),
        studentId: 'user-1',
        // 30 días contando hoy (10/9): vale hasta el 9/10 inclusive.
        expiresOn: '2099-10-09',
      });
      expect(res.json()).toMatchObject({ remaining: 4, available: 4, expired: false });
    });

    it('a pack no longer on offer cannot be bought', async () => {
      findOfferById.mockResolvedValue(oferta({ active: false }));
      const res = await comprar();
      expect(res.statusCode).toBe(409);
      expect(buyPack).not.toHaveBeenCalled();
    });

    it('a pack of a teacher not approved cannot be bought', async () => {
      findOfferById.mockResolvedValue(oferta({ teacherApprovalStatus: 'pending' }));
      const res = await comprar();
      expect(res.statusCode).toBe(409);
      expect(buyPack).not.toHaveBeenCalled();
    });

    it('404 for an unknown or malformed id', async () => {
      findOfferById.mockResolvedValue(null);
      expect((await comprar()).statusCode).toBe(404);
      expect((await comprar('student', 'abc')).statusCode).toBe(404);
    });

    it('only students buy', async () => {
      const res = await comprar('teacher');
      expect(res.statusCode).toBe(403);
      expect(buyPack).not.toHaveBeenCalled();
    });

    it('needs a CSRF token', async () => {
      const res = await comprar('student', OFERTA, false);
      expect(res.statusCode).toBe(403);
      expect(buyPack).not.toHaveBeenCalled();
    });
  });
});
