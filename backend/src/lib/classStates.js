// Las reglas del ciclo de vida de una reserva: quién puede hacer qué, desde
// qué estado y cuándo. Viven acá, en funciones puras, y no en la base ni
// repartidas por las rutas: dependen de la hora actual (la regla de 24 h, "ya
// empezó"), y así cada regla se prueba sin Postgres ni reloj de verdad.
//
// Las fechas y horas son las de la app ('YYYY-MM-DD', 'HH:MM', hora
// argentina, sin zona) y `now` es lo que devuelve now() de lib/clock.js.

/** Con cuánta anticipación puede el alumno cancelar o reprogramar. */
export const CANCEL_NOTICE_HOURS = 24;

export const CLASS_STATUSES = [
  'pendiente',
  'aceptada',
  'confirmada',
  'realizada',
  'no_presentada',
  'cancelada',
];

// Minutos desde el "epoch" tratando fecha y hora como hora local sin zona:
// alcanza para restar dos momentos, que es lo único que se hace con esto.
function toEpochMinutes(iso, time) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) / 60000;
}

/** Cuántos minutos faltan para que empiece la clase (negativo si ya empezó). */
export function minutesUntilStart(cls, now) {
  return toEpochMinutes(cls.date, cls.startTime) - toEpochMinutes(now.iso, now.time);
}

export function hasStarted(cls, now) {
  return minutesUntilStart(cls, now) <= 0;
}

function withNotice(cls, now) {
  return minutesUntilStart(cls, now) >= CANCEL_NOTICE_HOURS * 60;
}

const NOTICE_MESSAGE = `Solo podés cancelar o reprogramar hasta ${CANCEL_NOTICE_HOURS} h antes de la clase.`;
const STARTED_MESSAGE = 'La clase ya empezó.';

const deny = (status, message) => ({ status, message });
const conflict = (message) => deny(409, message);

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

export const ACTIONS = Object.keys(RULES);

/**
 * null si `role` puede hacer `action` sobre la clase ahora, o { status,
 * message } con el código HTTP y el motivo para mostrar. No chequea que el
 * usuario sea parte de la clase: eso lo hace la ruta antes (un 404, para no
 * contar que la clase existe).
 */
export function checkAction(action, cls, ctx) {
  const rule = RULES[action];
  if (!rule) return deny(400, 'Acción inválida');
  return rule(cls, ctx);
}

/** Las acciones que ese rol puede hacer ahora sobre la clase. */
export function allowedActions(cls, ctx) {
  return ACTIONS.filter((action) => checkAction(action, cls, ctx) === null);
}

/**
 * Por qué queda cancelada: que el docente diga que no a una pendiente es un
 * rechazo, no una cancelación de algo que ya estaba acordado.
 */
export function cancelReasonFor(cls, role) {
  return role === 'teacher' && cls.status === 'pendiente' ? 'rechazada' : 'cancelada';
}
