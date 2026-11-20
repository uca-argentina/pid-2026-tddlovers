// Las reglas de las tareas: qué es una consigna válida, qué es una entrega,
// cuándo es fuera de término y quién puede hacer qué. Funciones puras como
// las de bookingStates.js: dependen de la hora, y así se prueban sin reloj ni
// base. Espejadas en frontend/src/utils/homework.js solo para decidir qué
// mostrar.
//
// Tablas: homeworks, homework_submissions y homework_messages (migración 020).
// Lo usa: routes/homework/index.js (todo lo exportado).

import { isRealDate } from './validators.js';

const MAX_TITLE_LENGTH = 120;
const MAX_TEXT_LENGTH = 5000;
const MAX_LINK_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 2000;
// Las grupales a las que se puede asignar: las que vienen y las de hace poco
// (CLAUDE.md, "Homework": grupales de los últimos 60 días en adelante).
const RECENT_GROUP_DAYS = 60;

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const invalid = (message, field) => ({ error: { message, fields: { [field]: 'invalid' } } });

/**
 * Desde qué fecha una grupal todavía admite tareas.
 * @param {string} today - now().iso de lib/clock.js.
 * @returns {string} 'YYYY-MM-DD', 60 días antes de hoy.
 * Lo usa: routes/homework/index.js (GET /targets → findTargets de db/homework.js).
 */
export function recentGroupSince(today) {
  // FILTRO: desde cuándo una grupal se puede elegir como destino (hoy menos
  // RECENT_GROUP_DAYS); lo usan findTargets y la validación del POST.
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - RECENT_GROUP_DAYS)).toISOString().slice(0, 10);
}

/**
 * Si a la grupal de esa fecha todavía se le puede asignar una tarea. La misma
 * regla filtra la lista de /targets y valida el POST: si solo filtrara la
 * lista, mandando el id a mano se podía asignar a una clase de hace un año.
 *
 * @param {string} date - fecha de la clase elegida en el body de POST /api/homework.
 * @param {string} today - now().iso de lib/clock.js.
 * @returns {boolean}
 * Lo usa: routes/homework/index.js.
 */
export function isRecentGroupDate(date, today) {
  return date >= recentGroupSince(today);
}

/**
 * ¿Ya pasó el vencimiento? Se compara texto: 'YYYY-MM-DDTHH:MM' ordena igual que la fecha.
 *
 * @param {{dueDate: string, dueTime: string}} homework - la consigna (body o fila de homeworks).
 * @param {{iso: string, time: string}} now - now() de lib/clock.js.
 * @returns {boolean}
 * Lo usan: validateHomework (este archivo) y routes/homework/index.js (calcula
 *   is_late al entregar).
 * Espejo: frontend/src/utils/homework.js (isPastDue).
 */
export function isPastDue({ dueDate, dueTime }, now) {
  return `${now.iso}T${now.time}` > `${dueDate}T${dueTime}`;
}

/**
 * Valida la consigna; a quién va (alumno o grupal) se valida aparte en la ruta.
 *
 * @param {object} body - body de POST /api/homework: { title, description?, dueDate, dueTime }.
 * @param {{iso: string, time: string}} now - now() de lib/clock.js (el vencimiento no puede haber pasado).
 * @returns {{homework: {title, description, dueDate, dueTime}}|{error: {message, fields}}}
 * Lo usa: routes/homework/index.js.
 */
export function validateHomework(body, now) {
  const { title, description = '', dueDate, dueTime } = body ?? {};

  if (typeof title !== 'string' || title.trim() === '') {
    return invalid('Poné un título para la tarea.', 'title');
  }
  if (title.trim().length > MAX_TITLE_LENGTH) {
    return invalid(`El título puede tener hasta ${MAX_TITLE_LENGTH} caracteres.`, 'title');
  }
  if (typeof description !== 'string' || description.trim().length > MAX_TEXT_LENGTH) {
    return invalid(`La consigna puede tener hasta ${MAX_TEXT_LENGTH} caracteres.`, 'description');
  }
  if (!isRealDate(dueDate)) {
    return invalid('Fecha de entrega inválida.', 'dueDate');
  }
  if (!TIME_RE.test(dueTime ?? '')) return invalid('Hora de entrega inválida.', 'dueTime');
  if (isPastDue({ dueDate, dueTime }, now)) {
    return invalid('La fecha de entrega ya pasó.', 'dueDate');
  }

  return {
    homework: { title: title.trim(), description: description.trim(), dueDate, dueTime },
  };
}

/**
 * Solo http y https: el enlace se muestra como <a href> a la otra persona, y
 * un javascript: correría con su sesión al tocarlo.
 * @param {string} link
 * @returns {boolean}
 * Lo usa: validateSubmission (este archivo).
 * Espejo: frontend/src/utils/homework.js (isSafeLink, re-chequeado en SubmissionContent).
 */
export function isSafeLink(link) {
  try {
    return ['http:', 'https:'].includes(new URL(link).protocol);
  } catch {
    return false;
  }
}

/**
 * El texto y el enlace normalizados, o { error }. Hace falta al menos uno de los dos.
 * @param {object} body - body de PUT /api/homework/:id/submission: { text?, linkUrl? }.
 * @returns {{submission: {text: string, linkUrl: string}}|{error: {message, fields}}}
 * Lo usa: routes/homework/index.js.
 */
export function validateSubmission(body) {
  const { text = '', linkUrl = '' } = body ?? {};
  if (typeof text !== 'string' || typeof linkUrl !== 'string') {
    return invalid('La entrega no es válida.', 'text');
  }
  const cleanText = text.trim();
  const cleanLink = linkUrl.trim();

  if (cleanText === '' && cleanLink === '') {
    return invalid('Escribí un texto o pegá un enlace para entregar.', 'text');
  }
  if (cleanText.length > MAX_TEXT_LENGTH) {
    return invalid(`El texto puede tener hasta ${MAX_TEXT_LENGTH} caracteres.`, 'text');
  }
  if (cleanLink.length > MAX_LINK_LENGTH) {
    return invalid(`El enlace puede tener hasta ${MAX_LINK_LENGTH} caracteres.`, 'linkUrl');
  }
  if (cleanLink !== '' && !isSafeLink(cleanLink)) {
    return invalid('El enlace tiene que empezar con http:// o https://.', 'linkUrl');
  }
  return { submission: { text: cleanText, linkUrl: cleanLink } };
}

/**
 * La devolución del docente normalizada (no vacía, ≤5000), o { error }.
 * @param {*} feedback - request.body.feedback de POST /api/homework/submissions/:id/feedback.
 * @returns {{feedback: string}|{error: {message, fields}}}
 * Lo usa: routes/homework/index.js.
 */
export function validateFeedback(feedback) {
  if (typeof feedback !== 'string' || feedback.trim() === '') {
    return invalid('Escribí la devolución.', 'feedback');
  }
  if (feedback.trim().length > MAX_TEXT_LENGTH) {
    return invalid(`La devolución puede tener hasta ${MAX_TEXT_LENGTH} caracteres.`, 'feedback');
  }
  return { feedback: feedback.trim() };
}

/**
 * Un mensaje del chat de la entrega normalizado (no vacío, ≤2000), o { error }.
 * @param {*} body - request.body.body de POST /api/homework/submissions/:id/messages.
 * @returns {{body: string}|{error: {message, fields}}}
 * Lo usa: routes/homework/index.js.
 */
export function validateMessage(body) {
  if (typeof body !== 'string' || body.trim() === '') {
    return invalid('Escribí un mensaje.', 'body');
  }
  if (body.trim().length > MAX_MESSAGE_LENGTH) {
    return invalid(`El mensaje puede tener hasta ${MAX_MESSAGE_LENGTH} caracteres.`, 'body');
  }
  return { body: body.trim() };
}

/**
 * Null si el alumno puede entregar o cambiar su entrega; si no,
 * { status, message } como checkAction. Después del vencimiento se puede:
 * queda marcada como fuera de término. Lo que cierra la entrega es la
 * corrección, para que la devolución siempre hable de lo que quedó guardado.
 */
// `submission` en checkSubmit/checkCorrect/checkChat es la entrega en camelCase
// (submittedAt, correctedAt...) como la lee db/homework.js; las tres las usa
// routes/homework/index.js.
export function checkSubmit(submission) {
  if (submission.correctedAt) {
    return { status: 409, message: 'Esta entrega ya está corregida: no se puede cambiar.' };
  }
  return null;
}

/** null si el docente puede corregir: hace falta que el alumno haya entregado. */
export function checkCorrect(submission) {
  if (!submission.submittedAt) {
    return { status: 409, message: 'El alumno todavía no entregó esta tarea.' };
  }
  return null;
}

/** null si se puede usar el chat de la entrega: se habilita desde que el alumno entrega. */
export function checkChat(submission) {
  if (!submission.submittedAt) {
    return { status: 409, message: 'Los mensajes se habilitan cuando el alumno entrega la tarea.' };
  }
  return null;
}
