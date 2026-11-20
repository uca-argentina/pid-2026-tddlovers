import {
  createWindow,
  deleteWindow,
  findTeacherWindows,
  updateWindow,
} from '../../db/availability.js';
import {
  createAddress,
  deleteAddress,
  listSavedAddresses,
  setDefaultAddress,
  updateAddress,
} from '../../db/addresses.js';
import { validateAddress } from '../../lib/addresses.js';
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
import { listTeachers, setAcceptsRewards } from '../../db/users.js';
import { validateWindow } from '../../lib/availabilityWindow.js';
import { dateRangeProblem } from '../../lib/availabilityExpansion.js';
import { now, todayIso } from '../../lib/clock.js';
import { isUuid } from '../../lib/validators.js';

// Montado en /api/teachers (app.js). Todo /me/* es del docente logueado
// (role 'teacher', 403 si no); las escrituras piden CSRF.
//   GET    /api/teachers                         con sesión (cualquier rol): buscador
//   GET    /api/teachers/me/availability?from&to  ventanas crudas
//   POST   /api/teachers/me/availability
//   PUT    /api/teachers/me/availability/:id
//   DELETE /api/teachers/me/availability/:id
//   PUT    /api/teachers/me/accepts-rewards
//   GET    /api/teachers/me/packs
//   POST   /api/teachers/me/packs
//   DELETE /api/teachers/me/packs/:id            (desactiva)
//   GET    /api/teachers/me/vacations
//   GET    /api/teachers/me/vacations/impact?startDate&endDate
//   POST   /api/teachers/me/vacations
//   DELETE /api/teachers/me/vacations/:id
//   GET    /api/teachers/me/addresses
//   POST   /api/teachers/me/addresses
//   PUT    /api/teachers/me/addresses/:id
//   POST   /api/teachers/me/addresses/:id/default
//   DELETE /api/teachers/me/addresses/:id
// Usa: db/availability.js, db/addresses.js, db/rates.js, db/packs.js,
// db/vacations.js, db/users.js; lib/availabilityWindow.js, lib/addresses.js,
// lib/classPacks.js, lib/vacations.js, lib/availabilityExpansion.js, lib/clock.js.
// Los errores salen como { message } (+ `fields` en validaciones); no hay código `error`.

export default async function teachersRoutes(app) {
  /**
   * Los docentes que ofrecen alguna materia, para las sugerencias del
   * buscador. Se pide una vez y el front filtra mientras se tipea: son pocos
   * y así no hay un pedido por tecla. Es la única ruta de acá que no es del
   * docente logueado: la usa cualquiera con sesión.
   *
   * Respuesta: 200 [{ id, nombre, apellido, subjects }] (listTeachers: solo aprobados
   *   con alguna materia tarifada).
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
   *
   * Respuesta: 200 [ventanas de findTeacherWindows]. Errores: 400 rango inválido, 403.
   */
  app.get('/me/availability', read, async (request, reply) => {
    const { from, to } = request.query ?? {};
    const problem = dateRangeProblem(from, to);
    if (problem) return reply.code(400).send({ message: problem });
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
   *
   * @param {object} request - de él sale request.user.id.
   * @param {object} value - la ventana validada por validateWindow.
   * @returns {Promise<{message, fields}|null>}
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

  /**
   * Crear una ventana. Body: lo que valida validateWindow (date, repeatsWeekly,
   * start, end, modality, maxStudents, meetingUrl, addressId | address + saveAddress).
   * Respuesta: 201 ventana (forma de findTeacherWindows).
   * Errores: 400 validación, sin tarifa en esa modalidad o dirección inexistente;
   *   409 se pisa con otra ventana; 403.
   */
  app.post('/me/availability', write, async (request, reply) => {
    const checked = validateWindow(request.body, { today: todayIso() });
    if (!checked.value) return reply.code(400).send(checked);

    const problem = await problemWith(request, checked.value);
    if (problem) return reply.code(400).send(problem);

    const saved = await createWindow(request.user.id, checked.value);
    if (saved.conflict) return reply.code(409).send({ message: saved.conflict });
    if (saved.invalid) return reply.code(400).send(saved.invalid);
    return reply.code(201).send(saved.window);
  });

  /**
   * Editar una ventana (se permite que su fecha ya haya pasado). Mismo body que el POST.
   * No mueve clases ya reservadas.
   * Respuesta: 200 ventana. Errores: 400, 404 no existe o es de otro, 409 superposición, 403.
   */
  app.put('/me/availability/:id', write, async (request, reply) => {
    const { id } = request.params;
    if (!isUuid(id)) return reply.code(404).send({ message: 'Ese horario no existe.' });

    const checked = validateWindow(request.body, { today: todayIso(), allowPastDate: true });
    if (!checked.value) return reply.code(400).send(checked);

    const problem = await problemWith(request, checked.value);
    if (problem) return reply.code(400).send(problem);

    const saved = await updateWindow(request.user.id, id, checked.value);
    if (!saved) return reply.code(404).send({ message: 'Ese horario no existe.' });
    if (saved.conflict) return reply.code(409).send({ message: saved.conflict });
    if (saved.invalid) return reply.code(400).send(saved.invalid);
    return reply.send(saved.window);
  });

  /** Borrar una ventana (las clases reservadas quedan). Respuesta: 204. Errores: 404, 403. */
  app.delete('/me/availability/:id', write, async (request, reply) => {
    const { id } = request.params;
    const deleted = isUuid(id) && (await deleteWindow(request.user.id, id));
    if (!deleted) return reply.code(404).send({ message: 'Ese horario no existe.' });
    return reply.code(204).send();
  });

  /**
   * Si el docente acepta canjes de neuronas. Body: { accepts: boolean }.
   * Va aparte del perfil a propósito: guardar el perfil le vuelve a pedir
   * aprobación a un docente rechazado, y esto no cambia nada que se revise.
   *
   * Respuesta: 200 { acceptsRewards }. Errores: 400 falta `accepts`, 403.
   */
  app.put('/me/accepts-rewards', write, async (request, reply) => {
    const accepts = request.body?.accepts;
    if (typeof accepts !== 'boolean') {
      return reply
        .code(400)
        .send({ message: 'Falta indicar si aceptás canjes.', fields: { accepts: 'required' } });
    }
    await setAcceptsRewards(request.user.id, accepts);
    return reply.send({ acceptsRewards: accepts });
  });

  /**
   * Los paquetes que ofrece el docente logueado. Un docente sin aprobar
   * también los puede armar (igual que su disponibilidad): no los ve nadie
   * hasta que lo aprueban.
   *
   * Respuesta: 200 [listTeacherOffers]. Errores: 403.
   */
  app.get('/me/packs', read, async (request, reply) => {
    return reply.send(await listTeacherOffers(request.user.id));
  });

  /**
   * Ofrecer un paquete. Body: { classCount, classMinutes, priceCents, validityDays }
   * (validatePackOffer). Respuesta: 201 paquete (findOfferById). Errores: 400, 403.
   */
  app.post('/me/packs', write, async (request, reply) => {
    const checked = validatePackOffer(request.body);
    if (!checked.value) return reply.code(400).send(checked);
    return reply.code(201).send(await createOffer(request.user.id, checked.value));
  });

  /**
   * Deja de ofrecerlo. No borra nada: los alumnos que ya lo compraron lo
   * siguen usando hasta que se les termine o se les venza.
   *
   * Respuesta: 204. Errores: 404 no existe, es de otro o ya estaba inactivo; 403.
   */
  app.delete('/me/packs/:id', write, async (request, reply) => {
    const { id } = request.params;
    const done = isUuid(id) && (await deactivateOffer(request.user.id, id));
    if (!done) return reply.code(404).send({ message: 'Ese paquete no existe.' });
    return reply.code(204).send();
  });

  // --- Vacaciones ----------------------------------------------------------

  /**
   * Las vacaciones del docente que todavía no terminaron.
   * Respuesta: 200 [{ id, teacherId, startDate, endDate }]. Errores: 403.
   */
  app.get('/me/vacations', read, async (request, reply) => {
    return reply.send(await listTeacherVacations(request.user.id, { today: todayIso() }));
  });

  /**
   * Cuántas reservas se cancelarían si se va de vacaciones esos días, para
   * avisarle ANTES de guardar. Mismo `?startDate&endDate` que el POST.
   *
   * Respuesta: 200 { cancelledClasses }. Errores: 400 rango inválido, 403.
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
   *
   * Body: { startDate, endDate } (VacationRange.validate).
   * Respuesta: 201 { id, teacherId, startDate, endDate, cancelledClasses }.
   * Errores: 400 rango inválido, 409 se pisa con otra licencia, 403.
   */
  app.post('/me/vacations', write, async (request, reply) => {
    const checked = VacationRange.validate(request.body, { today: todayIso() });
    if (!checked.value) return reply.code(400).send(checked);

    const saved = await createVacation(request.user.id, checked.value, now());
    if (saved.conflict) {
      return reply.code(409).send({
        message: `Se pisa con tu licencia ${new VacationRange(saved.conflict).describe()}.`,
        fields: { startDate: 'invalid' },
      });
    }
    return reply.code(201).send({ ...saved.vacation, cancelledClasses: saved.cancelled });
  });

  /**
   * Borrar un rango cargado por error. Las reservas canceladas no vuelven.
   * Respuesta: 204. Errores: 404, 403.
   */
  app.delete('/me/vacations/:id', write, async (request, reply) => {
    const { id } = request.params;
    const deleted = isUuid(id) && (await deleteVacation(request.user.id, id));
    if (!deleted) return reply.code(404).send({ message: 'Esa licencia no existe.' });
    return reply.code(204).send();
  });

  // --- Direcciones ----------------------------------------------------------

  const ADDRESS_NOT_FOUND = 'Esa dirección no existe.';

  /**
   * Las direcciones guardadas del docente: la predeterminada primero.
   * Respuesta: 200 [listSavedAddresses]. Errores: 403.
   */
  app.get('/me/addresses', read, async (request, reply) => {
    return reply.send(await listSavedAddresses(request.user.id));
  });

  /**
   * Guardar una dirección. La primera queda predeterminada sola.
   * Body: la dirección (validateAddress con saving) + isDefault?.
   * Respuesta: 201 dirección. Errores: 400, 403.
   */
  app.post('/me/addresses', write, async (request, reply) => {
    const checked = validateAddress(request.body, { saving: true });
    if (!checked.value) return reply.code(400).send(checked);
    const created = await createAddress(request.user.id, checked.value, {
      isDefault: request.body.isDefault === true,
    });
    return reply.code(201).send(created);
  });

  /**
   * Editar una guardada. Las ventanas que la usan cambian con ella; las
   * clases ya reservadas no (tienen su copia).
   *
   * Respuesta: 200 dirección. Errores: 400, 404, 403.
   */
  app.put('/me/addresses/:id', write, async (request, reply) => {
    const { id } = request.params;
    if (!isUuid(id)) return reply.code(404).send({ message: ADDRESS_NOT_FOUND });
    const checked = validateAddress(request.body, { saving: true });
    if (!checked.value) return reply.code(400).send(checked);
    const updated = await updateAddress(request.user.id, id, checked.value, {
      isDefault: request.body.isDefault === true,
    });
    if (!updated) return reply.code(404).send({ message: ADDRESS_NOT_FOUND });
    return reply.send(updated);
  });

  /** Marcarla predeterminada. Respuesta: 200 dirección. Errores: 404, 403. */
  app.post('/me/addresses/:id/default', write, async (request, reply) => {
    const { id } = request.params;
    const updated = isUuid(id) && (await setDefaultAddress(request.user.id, id));
    if (!updated) return reply.code(404).send({ message: ADDRESS_NOT_FOUND });
    return reply.send(updated);
  });

  /**
   * Borrar una guardada. Si la usa alguna ventana, no: hay que cambiarla primero.
   * Respuesta: 204. Errores: 404, 409 en uso (dice cuántos horarios), 403.
   */
  app.delete('/me/addresses/:id', write, async (request, reply) => {
    const { id } = request.params;
    const result = isUuid(id) ? await deleteAddress(request.user.id, id) : null;
    if (!result) return reply.code(404).send({ message: ADDRESS_NOT_FOUND });
    if (result.inUse) {
      const horarios = result.inUse === 1 ? 'La usa 1 horario' : `La usan ${result.inUse} horarios`;
      return reply.code(409).send({
        message: `${horarios} de tu disponibilidad: cambiales la dirección antes de borrarla.`,
      });
    }
    return reply.code(204).send();
  });
}
