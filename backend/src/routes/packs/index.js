import { buyPack, findOfferById, listOffers, listStudentPacks } from '../../db/packs.js';
import { StudentPack, expiryFor } from '../../lib/classPacks.js';
import { TeacherApproval } from '../../lib/teacherApproval.js';
import { todayIso } from '../../lib/clock.js';
import { isUuid } from '../../lib/validators.js';

// Montado en /api/packs (app.js). Las rutas del docente (/api/teachers/me/packs)
// están en routes/teachers.
//   GET  /api/packs[?teacherId]  con sesión (cualquier rol)
//   GET  /api/packs/mine         solo student
//   POST /api/packs/:id/buy      solo student (CSRF)
// Usa: db/packs.js, lib/classPacks.js (StudentPack, expiryFor) y lib/teacherApproval.js.
// Los errores salen como { message } (+ `fields` en validaciones); no hay código `error`.

const NOT_FOUND = 'Ese paquete no existe.';

/**
 * El paquete comprado como viaja por la API: la fila más las cuentas.
 *
 * @param {object} row - fila de listStudentPacks / buyPack.
 * @param {string} today - todayIso().
 * @returns {object} la fila + StudentPack#summary (remaining, available, si venció…).
 */
function withSummary(row, today) {
  return { ...row, ...new StudentPack(row).summary(today) };
}

export default async function packsRoutes(app) {
  /** Comprar y tener paquetes es cosa de alumnos. */
  function onlyStudents(request, reply, done) {
    if (request.user.role !== 'student') {
      reply.code(403).send({ message: 'Solo los alumnos pueden comprar paquetes' });
      return;
    }
    done();
  }

  /**
   * Los paquetes que se pueden comprar (de docentes aprobados), o solo los de
   * `?teacherId=`. Cualquiera con sesión los puede ver.
   *
   * Respuesta: 200 [filas de listOffers]. Errores: 400 teacherId no UUID.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { teacherId } = request.query ?? {};
    if (teacherId !== undefined && !isUuid(teacherId)) {
      return reply.code(400).send({ message: 'Docente inválido' });
    }
    return reply.send(await listOffers({ teacherId }));
  });

  /**
   * Los paquetes que compró el alumno logueado, con cuántas clases le quedan
   * (`remaining`: cada asistencia descuenta una), cuántas puede reservar
   * todavía (`available`) y si venció. Sale de la sesión: nadie ve los
   * paquetes de otro.
   *
   * Respuesta: 200 [withSummary(fila)]. Errores: 403 no alumno.
   */
  app.get(
    '/mine',
    { onRequest: [app.requireAuth], preHandler: onlyStudents },
    async (request, reply) => {
      const today = todayIso();
      const rows = await listStudentPacks({ studentId: request.user.id });
      return reply.send(rows.map((row) => withSummary(row, today)));
    }
  );

  /**
   * Comprar un paquete. Nada se cobra de verdad (igual que pagar una clase):
   * queda registrado, con la fecha de vencimiento contada desde hoy.
   *
   * Respuesta: 201 withSummary(paquete comprado). Errores: 403 no alumno o
   *   docente no aprobado (bookingProblem), 404 no existe, 409 ya no se ofrece.
   */
  app.post(
    '/:id/buy',
    { onRequest: [app.requireAuth, app.csrfProtection], preHandler: onlyStudents },
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) return reply.code(404).send({ message: NOT_FOUND });

      const offer = await findOfferById(id);
      if (!offer) return reply.code(404).send({ message: NOT_FOUND });
      if (!offer.active) {
        return reply.code(409).send({ message: 'El docente ya no ofrece este paquete.' });
      }
      // Mismo criterio que reservar: a un docente sin aprobar no se le compra.
      const problem = new TeacherApproval(offer.teacherApprovalStatus).bookingProblem();
      if (problem) return reply.code(problem.status).send({ message: problem.message });

      const today = todayIso();
      const bought = await buyPack({
        offer,
        studentId: request.user.id,
        expiresOn: expiryFor(today, offer.validityDays),
      });
      return reply.code(201).send(withSummary(bought, today));
    }
  );
}
