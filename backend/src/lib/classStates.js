// Las reglas del ciclo de vida de una reserva: quién puede hacer qué, desde
// qué estado y cuándo. Viven acá, en funciones puras, y no en la base ni
// repartidas por las rutas: dependen de la hora actual (la regla de 24 h, "ya
// empezó"), y así cada regla se prueba sin Postgres ni reloj de verdad.
//
// Las fechas y horas son las de la app ('YYYY-MM-DD', 'HH:MM', hora
// argentina, sin zona) y `now` es lo que devuelve now() de lib/clock.js.
//
// Las clases (`cls`) que reciben estas funciones son filas de `classes` en la
// forma de la API (camelCase: status, date, startTime, endTime, paidAt,
// priceCents...), como las devuelven findClassById / findTurnClasses de
// db/classes.js.
//
// Lo usan: routes/classes/index.js (checkAction, cancelReasonFor, forViewer,
// CLASS_STATUSES), lib/classMaterials.js (hasEnded) y lib/neuronas.js
// (toEpochMinutes).
// Espejo: frontend/src/utils/classStates.js (allowedActions, hasStarted,
// hasEnded), SOLO para decidir qué botones mostrar: si cambia una regla acá,
// cambiala allá.

/**
 * Con cuánta anticipación puede el alumno cancelar (una ya aceptada o
 * confirmada) o reprogramar: la regla de 24 h de CLAUDE.md ("Cancel" y
 * "Reschedule").
 */
const CANCEL_NOTICE_HOURS = 24;

// Los valores del enum class_status, en español porque se muestran tal cual.
// La ruta los usa para validar el filtro `?status=` de GET /api/classes.
export const CLASS_STATUSES = [
  'pendiente',
  'aceptada',
  'confirmada',
  'realizada',
  'no_presentada',
  'cancelada',
];

/**
 * Minutos desde el "epoch" tratando fecha y hora como hora local sin zona:
 * alcanza para restar dos momentos, que es lo único que se hace con esto.
 *
 * @param {string} iso - 'YYYY-MM-DD'.
 * @param {string} time - 'HH:MM' ('24:00' cae en la medianoche siguiente).
 * @returns {number}
 * Lo usan: este archivo y lib/neuronas.js.
 */
export function toEpochMinutes(iso, time) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) / 60000;
}

/**
 * Cuántos minutos faltan para que empiece la clase (negativo si ya empezó).
 * @param {{date: string, startTime: string}} cls
 * @param {{iso: string, time: string}} now - now() de lib/clock.js.
 */
export function minutesUntilStart(cls, now) {
  return toEpochMinutes(cls.date, cls.startTime) - toEpochMinutes(now.iso, now.time);
}

/** ¿Ya llegó la hora de inicio? (Mismos parámetros que minutesUntilStart.) */
export function hasStarted(cls, now) {
  return minutesUntilStart(cls, now) <= 0;
}

/**
 * Si la clase ya terminó. Un fin "24:00" cae bien: es la medianoche siguiente.
 * @param {{date: string, endTime: string}} cls
 * @param {{iso: string, time: string}} now - now() de lib/clock.js.
 * Lo usa también: lib/classMaterials.js (el material se habilita al terminar).
 */
export function hasEnded(cls, now) {
  return toEpochMinutes(cls.date, cls.endTime) <= toEpochMinutes(now.iso, now.time);
}

function withNotice(cls, now) {
  return minutesUntilStart(cls, now) >= CANCEL_NOTICE_HOURS * 60;
}

const NOTICE_MESSAGE = `Solo podés cancelar o reprogramar hasta ${CANCEL_NOTICE_HOURS} h antes de la clase.`;
const STARTED_MESSAGE = 'La clase ya empezó.';

const deny = (status, message) => ({ status, message });
const conflict = (message) => deny(409, message);

// Una regla por acción: (cls, { role, now }) → null si se puede, o
// { status, message }. Las acciones son las de POST /api/classes/:id/<acción>
// (attend = /attendance) y las de /turn/{accept,cancel}.
const RULES = {
  accept(cls, { role, now }) {
    if (role !== 'teacher') return deny(403, 'Solo el docente puede aceptar la clase.');
    if (cls.status !== 'pendiente') return conflict('Esta reserva ya no está esperando respuesta.');
    if (hasStarted(cls, now)) return conflict(STARTED_MESSAGE);
    return null;
  },

  cancel(cls, { role, now }) {
    if (!['pendiente', 'aceptada', 'confirmada'].includes(cls.status)) {
      return conflict('Esta clase ya no se puede cancelar.');
    }
    if (hasStarted(cls, now)) return conflict(STARTED_MESSAGE);
    // El docente puede cancelar hasta que empiece. El alumno también, pero
    // solo mientras el docente no aceptó: después aplica la regla de 24 h.
    if (role === 'student' && cls.status !== 'pendiente' && !withNotice(cls, now)) {
      return conflict(NOTICE_MESSAGE);
    }
    return null;
  },

  pay(cls, { role }) {
    if (role !== 'student') return deny(403, 'Solo el alumno puede pagar la clase.');
    if (cls.status === 'pendiente') return conflict('Vas a poder pagar cuando el docente acepte la clase.');
    if (cls.paidAt) return conflict('Esta clase ya está paga.');
    // Se puede pagar incluso después de la clase: por eso también desde
    // realizada o no presentada, que no cambian de estado (solo el pago).
    if (!['aceptada', 'realizada', 'no_presentada'].includes(cls.status)) {
      return conflict('Esta clase ya no se puede pagar.');
    }
    return null;
  },

  attend(cls, { role, now }) {
    if (role !== 'teacher') return deny(403, 'Solo el docente puede tomar lista.');
    // Aceptada también: el pago puede llegar después, y sin esto a quien no
    // viene y nunca paga no se lo podría marcar como ausente. Realizada y no
    // presentada, para poder corregir la marca.
    if (!['aceptada', 'confirmada', 'realizada', 'no_presentada'].includes(cls.status)) {
      return conflict('Solo se toma lista en clases aceptadas.');
    }
    if (!hasStarted(cls, now)) return conflict('Vas a poder tomar lista cuando empiece la clase.');
    return null;
  },

  reschedule(cls, { role, now }) {
    if (role !== 'student') return deny(403, 'Solo el alumno puede reprogramar la clase.');
    if (cls.status !== 'confirmada') return conflict('Solo se puede reprogramar una clase confirmada.');
    if (!withNotice(cls, now)) return conflict(NOTICE_MESSAGE);
    return null;
  },
};

/**
 * ¿Puede `role` hacer `action` sobre la clase ahora? Es la regla AUTORITATIVA
 * del ciclo de vida de una reserva. No chequea que el usuario sea parte de la
 * clase: eso lo hace la ruta antes (un 404, para no contar que la clase existe).
 *
 * @param {'accept'|'cancel'|'pay'|'attend'|'reschedule'} action - sale de la URL
 *   (POST /api/classes/:id/<acción> o /:id/turn/<acción>).
 * @param {object} cls - la clase como la devuelve db/classes.js (status, date,
 *   startTime, endTime, paidAt...).
 * @param {{role: 'teacher'|'student', now: {iso, time}}} ctx - `role` es el papel
 *   del usuario de la sesión EN ESA CLASE (lo decide loadOwnClass en la ruta) y
 *   `now` sale de now() de lib/clock.js.
 * @returns {null|{status: number, message: string}} null si se puede; si no, el
 *   código HTTP (400/403/409) y el motivo en español para mostrar.
 * Lo usa: routes/classes/index.js (acciones de una reserva y de un turno entero).
 * Espejo: frontend/src/utils/classStates.js (allowedActions).
 */
export function checkAction(action, cls, ctx) {
  const rule = RULES[action];
  if (!rule) return deny(400, 'Acción inválida');
  return rule(cls, ctx);
}

/**
 * Por qué queda cancelada: que el docente diga que no a una pendiente es un
 * rechazo, no una cancelación de algo que ya estaba acordado.
 *
 * @param {{status: string}} cls - la clase ANTES de cancelarla.
 * @param {'teacher'|'student'} role - quién cancela.
 * @returns {'rechazada'|'cancelada'} el valor para classes.cancel_reason.
 * Lo usa: routes/classes/index.js (applyCancel).
 */
export function cancelReasonFor(cls, role) {
  return role === 'teacher' && cls.status === 'pendiente' ? 'rechazada' : 'cancelada';
}

/**
 * Si quien mira puede ver la dirección exacta de la clase. El docente,
 * siempre. El alumno, recién cuando la clase está paga (o no hay nada que
 * pagar: gratis, o cubierta entera por un paquete, que ya queda paga al
 * aceptarse); antes ve solo la localidad. Una pendiente o cancelada, nunca.
 *
 * @param {{status: string, paidAt: string|null, priceCents: number}} cls
 * @param {'teacher'|'student'} role
 * @returns {boolean}
 * Lo usa: forViewer (este archivo).
 */
export function canSeeExactAddress(cls, role) {
  if (role === 'teacher') return true;
  if (cls.status === 'pendiente' || cls.status === 'cancelada') return false;
  return Boolean(cls.paidAt) || cls.priceCents === 0;
}

/**
 * La clase como la tiene que recibir `role`: sin la dirección exacta
 * (`address: null`) si no le corresponde. Se aplica a toda clase que sale por
 * la API hacia un alumno.
 *
 * @param {object|null} cls - la clase de findClassById / findClassesForUser (db/classes.js).
 * @param {'teacher'|'student'} role - el rol de la sesión (request.user.role) o el
 *   papel en esa clase.
 * @returns {object|null} la misma clase, o una copia con address null.
 * Lo usa: routes/classes/index.js.
 */
export function forViewer(cls, role) {
  if (!cls || canSeeExactAddress(cls, role)) return cls;
  return { ...cls, address: null };
}
