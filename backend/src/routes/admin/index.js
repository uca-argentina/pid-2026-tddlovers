import {
  findTeacherForReview,
  listTeachersForReview,
  setTeacherApproval,
} from '../../db/approvals.js';
import { APPROVAL_STATUSES, TeacherApproval } from '../../lib/teacherApproval.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 'Ese docente no existe.';
const CHANGED_MEANWHILE = 'Otro administrador ya revisó a este docente. Recargá la página.';

export default async function adminRoutes(app) {
  /**
   * Todo lo de acá es solo para administradores. Un 403 y no un 404: que
   * exista un panel de admin no es un secreto, lo que se protege son los
   * datos de los docentes.
   */
  function onlyAdmins(request, reply, done) {
    if (request.user.role !== 'admin') {
      reply.code(403).send({ message: 'Solo los administradores pueden revisar docentes' });
      return;
    }
    done();
  }

  const read = { onRequest: [app.requireAuth], preHandler: onlyAdmins };
  const write = { onRequest: [app.requireAuth, app.csrfProtection], preHandler: onlyAdmins };

  /**
   * Los docentes a revisar. `?status=pending` es lo que pide la pantalla al
   * abrir; sin status vienen todos.
   */
  app.get('/teachers', read, async (request, reply) => {
    const { status } = request.query ?? {};
    if (status !== undefined && !APPROVAL_STATUSES.includes(status)) {
      return reply.code(400).send({ message: 'Estado inválido' });
    }
    return reply.send(await listTeachersForReview({ status }));
  });

  /**
   * Arma la ruta de una decisión sobre un docente. Si se puede lo decide
   * TeacherApproval; si en el medio otro admin lo cambió, setTeacherApproval
   * no pisa nada y se avisa con un 409. Devuelve el docente actualizado.
   */
  function decision(name, apply) {
    app.post(`/teachers/:id/${name}`, write, async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(404).send({ message: NOT_FOUND });

      const teacher = await findTeacherForReview(id);
      if (!teacher) return reply.code(404).send({ message: NOT_FOUND });

      const current = new TeacherApproval(teacher.approvalStatus);
      const denied = current.check(name);
      if (denied) return reply.code(denied.status).send({ message: denied.message });

      const next = apply(current);
      const done = await setTeacherApproval(id, {
        from: current.status,
        to: next.status,
        reviewedBy: request.user.id,
      });
      if (!done) return reply.code(409).send({ message: CHANGED_MEANWHILE });

      return reply.send(await findTeacherForReview(id));
    });
  }

  decision('approve', (approval) => approval.approve());
  decision('reject', (approval) => approval.reject());
}
