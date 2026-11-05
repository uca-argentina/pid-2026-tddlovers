import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/neuronas.js', () => ({
  buyFeatured: vi.fn(),
  findBalance: vi.fn(),
  findCreditCounts: vi.fn(),
  findFeaturedStatus: vi.fn(),
  listMovements: vi.fn(),
  settleHomeworkCredits: vi.fn(),
}));

vi.mock('../../db/sessions.js', () => ({
  createSession: vi.fn(),
  findValidSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
}));

const neuronas = await import('../../db/neuronas.js');
const { findValidSession } = await import('../../db/sessions.js');
const { buildApp } = await import('../../app.js');

async function authedHeaders(app, role, approvalStatus = null) {
  findValidSession.mockResolvedValue({
    session_id: 'session-1',
    user_id: 'user-1',
    email: 'a@example.com',
    role,
    approval_status: approvalStatus,
  });
  await app.ready();

  const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf-token' });
  const csrfCookie = csrfRes.cookies.find((c) => c.name === '_csrf');
  return {
    'x-csrf-token': csrfRes.json().csrfToken,
    cookie: `${csrfCookie.name}=${csrfCookie.value}; sid=${app.signCookie('session-1')}`,
  };
}

describe('/api/neuronas', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp({ logger: false });
    neuronas.findBalance.mockResolvedValue({ balance: 150, earned: 250 });
    neuronas.listMovements.mockResolvedValue([]);
    neuronas.findCreditCounts.mockResolvedValue({ classesAttended: 1, homeworksOnTime: 0 });
    neuronas.findFeaturedStatus.mockResolvedValue({ activeUntil: null, slotsLeft: 5 });
  });

  afterEach(async () => {
    await app.close();
  });

  it('necesita sesión', async () => {
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/neuronas' });
    expect(res.statusCode).toBe(401);
  });

  it('el alumno ve saldo, nivel e insignias, y liquida antes de leer', async () => {
    const headers = await authedHeaders(app, 'student');
    const res = await app.inject({ method: 'GET', url: '/api/neuronas', headers });

    expect(res.statusCode).toBe(200);
    expect(neuronas.settleHomeworkCredits).toHaveBeenCalledWith('user-1', expect.anything());
    const body = res.json();
    expect(body.balance).toBe(150);
    // El nivel sale de lo acreditado, no del saldo.
    expect(body.level.name).toBe('Sinapsis');
    expect(body.badges.find((b) => b.key === 'first_class').earned).toBe(true);
    expect(body.featured).toBeUndefined();
  });

  it('el docente ve el estado de Destacado', async () => {
    const headers = await authedHeaders(app, 'teacher', 'approved');
    const res = await app.inject({ method: 'GET', url: '/api/neuronas', headers });

    expect(res.json().featured).toEqual({ activeUntil: null, slotsLeft: 5, cost: 1000, days: 7 });
    expect(res.json().badges).toBeUndefined();
  });

  it('el admin no tiene neuronas', async () => {
    const headers = await authedHeaders(app, 'admin');
    const res = await app.inject({ method: 'GET', url: '/api/neuronas', headers });
    expect(res.statusCode).toBe(403);
  });

  describe('POST /featured', () => {
    const comprar = (headers) =>
      app.inject({ method: 'POST', url: '/api/neuronas/featured', headers });

    it('un docente aprobado compra', async () => {
      neuronas.buyFeatured.mockResolvedValue({ endDate: '2099-09-20' });
      const res = await comprar(await authedHeaders(app, 'teacher', 'approved'));

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ endDate: '2099-09-20' });
    });

    it('avisa el motivo si no se puede', async () => {
      neuronas.buyFeatured.mockResolvedValue({ conflict: 'No te alcanzan las neuronas.' });
      const res = await comprar(await authedHeaders(app, 'teacher', 'approved'));

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe('No te alcanzan las neuronas.');
    });

    it('un docente sin aprobar no puede', async () => {
      const res = await comprar(await authedHeaders(app, 'teacher', 'pending'));

      expect(res.statusCode).toBe(403);
      expect(neuronas.buyFeatured).not.toHaveBeenCalled();
    });

    it('un alumno no puede', async () => {
      const res = await comprar(await authedHeaders(app, 'student'));
      expect(res.statusCode).toBe(403);
    });
  });
});
