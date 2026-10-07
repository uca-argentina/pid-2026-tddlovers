import { buyPack, findOfferById, listOffers, listStudentPacks } from '../../db/packs.js';
import { StudentPack, expiryFor } from '../../lib/classPacks.js';
import { TeacherApproval } from '../../lib/teacherApproval.js';
import { todayIso } from '../../lib/clock.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 'Ese paquete no existe.';

/** El paquete comprado como viaja por la API: la fila más las cuentas. */
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
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    const { teacherId } = request.query ?? {};
    if (teacherId !== undefined && !UUID_RE.test(teacherId)) {
      return reply.code(400).send({ message: 'Docente inválido' });
    }
    return reply.send(await listOffers({ teacherId }));
  });

  /**
   * Los paquetes que compró el alumno logueado, con cuántas clases le quedan
   * (`remaining`: cada asistencia descuenta una), cuántas puede reservar
   * todavía (`available`) y si venció. Sale de la sesión: nadie ve los
   * paquetes de otro.
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
   */
  app.post(
    '/:id/buy',
    { onRequest: [app.requireAuth, app.csrfProtection], preHandler: onlyStudents },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(404).send({ message: NOT_FOUND });

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
