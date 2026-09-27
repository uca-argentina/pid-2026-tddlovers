import {
  createWindow,
  deleteWindow,
  findTeacherWindows,
  updateWindow,
} from '../../db/availability.js';
import { teacherHasRateFor } from '../../db/rates.js';
import { listTeachers } from '../../db/users.js';
import { validateWindow } from '../../lib/availabilityWindow.js';
import { todayIso } from '../../lib/clock.js';

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
}
