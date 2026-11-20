import {
  buyFeatured,
  findBalance,
  findCreditCounts,
  findFeaturedStatus,
  listMovements,
  settleHomeworkCredits,
} from '../../db/neuronas.js';
import { now } from '../../lib/clock.js';
import { FEATURED_COST, FEATURED_DAYS, badgesFor, levelFor } from '../../lib/neuronas.js';

// Montado en /api/neuronas (app.js):
//   GET  /api/neuronas           teacher o student (admin: 403)
//   POST /api/neuronas/featured  solo teacher aprobado (CSRF)
// El toggle de "acepta canjes" está en routes/teachers (/me/accepts-rewards).
// Usa: db/neuronas.js y lib/neuronas.js (nivel, insignias, costos).
// Los errores salen como { message } (+ `fields` en validaciones); no hay código `error`.

export default async function neuronasRoutes(app) {
  /**
   * El saldo, el nivel y el historial del usuario logueado: sale de la sesión.
   * Al alumno antes se le liquidan las tareas sin corregir (settleHomeworkCredits).
   *
   * Respuesta: 200 { balance, earned, level, movements } + `badges` (alumno) o
   *   `featured: { activeUntil, slotsLeft, cost, days }` (docente).
   * Errores: 403 admin.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { id, role } = request.user;
    if (role === 'admin') {
      return reply.code(403).send({ message: 'Las neuronas son para docentes y alumnos.' });
    }

    const current = now();
    if (role === 'student') await settleHomeworkCredits(id, current);

    const [{ balance, earned }, movements] = await Promise.all([
      findBalance(id),
      listMovements(id),
    ]);
    const summary = { balance, earned, level: levelFor(earned), movements };

    if (role === 'student') {
      return reply.send({ ...summary, badges: badgesFor(await findCreditCounts(id)) });
    }
    const status = await findFeaturedStatus(id, current.iso);
    return reply.send({ ...summary, featured: { ...status, cost: FEATURED_COST, days: FEATURED_DAYS } });
  });

  /**
   * Comprar 7 días de Destacado. Sin aprobar no se muestra en el tablero: no tiene sentido.
   *
   * Respuesta: 201 { endDate }. Errores: 403 no docente o no aprobado;
   *   409 ya destacado, sin lugares o sin saldo (buyFeatured).
   */
  app.post(
    '/featured',
    { onRequest: [app.requireAuth, app.csrfProtection] },
    async (request, reply) => {
      const { id, role, approvalStatus } = request.user;
      if (role !== 'teacher') {
        return reply.code(403).send({ message: 'Solo los docentes pueden destacarse.' });
      }
      if (approvalStatus !== 'approved') {
        return reply
          .code(403)
          .send({ message: 'Vas a poder destacarte cuando un administrador te apruebe.' });
      }

      const bought = await buyFeatured(id, now().iso);
      if (bought.conflict) return reply.code(409).send({ message: bought.conflict });
      return reply.code(201).send(bought);
    }
  );
}
