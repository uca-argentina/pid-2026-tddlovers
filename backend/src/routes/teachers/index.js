import {
  createWindow,
  deleteWindow,
  findTeacherWindows,
  updateWindow,
} from '../../db/availability.js';
import { teacherHasRateFor } from '../../db/rates.js';
import { createOffer, deactivateOffer, listTeacherOffers } from '../../db/packs.js';
import { validatePackOffer } from '../../lib/classPacks.js';
import {
  countClassesToCancel,
  createVacation,
  deleteVacation,
  listTeacherVacations,
} from '../../db/vacations.js';
import { VacationRange } from '../../lib/vacations.js';
import { listTeachers } from '../../db/users.js';
import { validateWindow } from '../../lib/availabilityWindow.js';
import { now, todayIso } from '../../lib/clock.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function teachersRoutes(app) {
  /**
   * Los docentes que ofrecen alguna materia, para las sugerencias del
   * buscador. Se pide una vez y el front filtra mientras se tipea: son pocos
   * y así no hay un pedido por tecla. Es la única ruta de acá que no es del
   * docente logueado: la usa cualquiera con sesión.
   */
  app.get('/', { onRequest: app.requireAuth }, async (request, reply) => {
    return reply.send(await listTeachers());
  });

  /**
   * Las rutas de disponibilidad son del docente logueado (`me`): sale de la
   * sesión, así que nadie puede leer ni tocar la de otro. Lo que ve el
   * alumno es /api/availability, ya expandido y sin los links.
   */
  function onlyTeachers(request, reply, done) {
    if (request.user.role !== 'teacher') {
      reply.code(403).send({ message: 'Solo los docentes tienen disponibilidad' });
      return;
    }
    done();
  }

  const read = { onRequest: [app.requireAuth], preHandler: onlyTeachers };
  const write = { onRequest: [app.requireAuth, app.csrfProtection], preHandler: onlyTeachers };

  /**
   * Las ventanas que caen en el rango, SIN expandir: la pantalla necesita la
   * ventana entera (id, fecha original, si se repite) para editarla, y ella
   * misma la ubica en cada día de la semana que muestra.
   */
  app.get('/me/availability', read, async (request, reply) => {
    const { from, to } = request.query ?? {};
    if (!ISO_DATE_RE.test(from ?? '') || !ISO_DATE_RE.test(to ?? '') || from > to) {
      return reply.code(400).send({ message: 'Rango de fechas inválido' });
    }
    return reply.send(await findTeacherWindows({ teacherId: request.user.id, from, to }));
  });

  // Cómo se nombra cada modalidad en "no tenés tarifas para clases ...".
  const MODALITY_PLURAL = { virtual: 'virtuales', in_person: 'presenciales', hybrid: 'híbridas' };

  /**
   * Chequeos compartidos por crear y editar. null si todo bien.
   *
   * La ventana no dice materia: el alumno elige entre las que el docente
   * tiene tarifadas en esa modalidad. Sin ninguna, la ventana no le serviría
   * a nadie — mejor decirlo ahora que dejar al docente esperando reservas.
   */
  async function problemWith(request, value) {
    const tieneTarifa = await teacherHasRateFor(request.user.id, value.modality);
    if (!tieneTarifa) {
      return {
        message: `No tenés tarifas para clases ${MODALITY_PLURAL[value.modality]}. Cargalas desde Mi perfil.`,
        fields: { modality: 'invalid' },
      };
    }
    return null;
  }

  app.post('/me/availability', write, async (request, reply) => {
    const checked = validateWindow(request.body, { today: todayIso() });
    if (!checked.value) return reply.code(400).send(checked);

    const problem = await problemWith(request, checked.value);
    if (problem) return reply.code(400).send(problem);

    const saved = await createWindow(request.user.id, checked.value);
    if (saved.conflict) return reply.code(409).send({ message: saved.conflict });
    return reply.code(201).send(saved.window);
  });

  app.put('/me/availability/:id', write, async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(404).send({ message: 'Esa clase no existe.' });

    const checked = validateWindow(request.body, { today: todayIso(), allowPastDate: true });
    if (!checked.value) return reply.code(400).send(checked);

    const problem = await problemWith(request, checked.value);
    if (problem) return reply.code(400).send(problem);

    const saved = await updateWindow(request.user.id, id, checked.value);
    if (!saved) return reply.code(404).send({ message: 'Esa clase no existe.' });
    if (saved.conflict) return reply.code(409).send({ message: saved.conflict });
    return reply.send(saved.window);
  });

  app.delete('/me/availability/:id', write, async (request, reply) => {
    const { id } = request.params;
    const deleted = UUID_RE.test(id) && (await deleteWindow(request.user.id, id));
    if (!deleted) return reply.code(404).send({ message: 'Esa clase no existe.' });
    return reply.code(204).send();
  });

  /**
   * Los paquetes que ofrece el docente logueado. Un docente sin aprobar
   * también los puede armar (igual que su disponibilidad): no los ve nadie
   * hasta que lo aprueban.
   */
  app.get('/me/packs', read, async (request, reply) => {
    return reply.send(await listTeacherOffers(request.user.id));
  });

  app.post('/me/packs', write, async (request, reply) => {
    const checked = validatePackOffer(request.body);
    if (!checked.value) return reply.code(400).send(checked);
    return reply.code(201).send(await createOffer(request.user.id, checked.value));
  });

  /**
   * Deja de ofrecerlo. No borra nada: los alumnos que ya lo compraron lo
   * siguen usando hasta que se les termine o se les venza.
   */
  app.delete('/me/packs/:id', write, async (request, reply) => {
    const { id } = request.params;
    const done = UUID_RE.test(id) && (await deactivateOffer(request.user.id, id));
    if (!done) return reply.code(404).send({ message: 'Ese paquete no existe.' });
    return reply.code(204).send();
  });

  // --- Vacaciones ----------------------------------------------------------

  /** Las vacaciones del docente que todavía no terminaron. */
  app.get('/me/vacations', read, async (request, reply) => {
    return reply.send(await listTeacherVacations(request.user.id, { today: todayIso() }));
  });

  /**
   * Cuántas reservas se cancelarían si se va de vacaciones esos días, para
   * avisarle ANTES de guardar. Mismo `?startDate&endDate` que el POST.
   */
  app.get('/me/vacations/impact', read, async (request, reply) => {
    const checked = VacationRange.validate(request.query, { today: todayIso() });
    if (!checked.value) return reply.code(400).send(checked);
    const cancelledClasses = await countClassesToCancel(request.user.id, checked.value, now());
    return reply.send({ cancelledClasses });
  });

  /**
   * Cargar vacaciones. Las reservas de esos días que todavía no empezaron se
   * cancelan en la misma transacción; la respuesta dice cuántas.
   */
  app.post('/me/vacations', write, async (request, reply) => {
    const checked = VacationRange.validate(request.body, { today: todayIso() });
    if (!checked.value) return reply.code(400).send(checked);

    const saved = await createVacation(request.user.id, checked.value, now());
    if (saved.conflict) {
      return reply.code(409).send({
        message: `Se pisa con tus vacaciones ${new VacationRange(saved.conflict).describe()}.`,
        fields: { startDate: 'invalid' },
      });
    }
    return reply.code(201).send({ ...saved.vacation, cancelledClasses: saved.cancelled });
  });

  /** Borrar un rango cargado por error. Las reservas canceladas no vuelven. */
  app.delete('/me/vacations/:id', write, async (request, reply) => {
    const { id } = request.params;
    const deleted = UUID_RE.test(id) && (await deleteVacation(request.user.id, id));
    if (!deleted) return reply.code(404).send({ message: 'Esas vacaciones no existen.' });
    return reply.code(204).send();
  });
}
