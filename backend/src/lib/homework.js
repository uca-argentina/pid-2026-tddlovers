// Las reglas de las tareas: qué es una consigna válida, qué es una entrega,
// cuándo es fuera de término y quién puede hacer qué. Funciones puras como
// las de classStates.js: dependen de la hora, y así se prueban sin reloj ni
// base. Espejadas en frontend/src/utils/homework.js solo para decidir qué
// mostrar.

export const MAX_TITLE_LENGTH = 120;
export const MAX_TEXT_LENGTH = 5000;
export const MAX_LINK_LENGTH = 2000;
export const MAX_MESSAGE_LENGTH = 2000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isRealDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const invalid = (message, field) => ({ error: { message, fields: { [field]: 'invalid' } } });

/** `now` es el de lib/clock.js. Se compara texto: 'YYYY-MM-DDTHH:MM' ordena igual que la fecha. */
export function isPastDue({ dueDate, dueTime }, now) {
  return `${now.iso}T${now.time}` > `${dueDate}T${dueTime}`;
}

/** Los datos de la consigna normalizados, o { error }. A quién va se valida aparte. */
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
  if (!ISO_DATE_RE.test(dueDate ?? '') || !isRealDate(dueDate)) {
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
 */
export function isSafeLink(link) {
  try {
    return ['http:', 'https:'].includes(new URL(link).protocol);
  } catch {
    return false;
  }
}

/** El texto y el enlace normalizados, o { error }. Hace falta al menos uno de los dos. */
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

export function validateFeedback(feedback) {
  if (typeof feedback !== 'string' || feedback.trim() === '') {
    return invalid('Escribí la devolución.', 'feedback');
  }
  if (feedback.trim().length > MAX_TEXT_LENGTH) {
    return invalid(`La devolución puede tener hasta ${MAX_TEXT_LENGTH} caracteres.`, 'feedback');
  }
  return { feedback: feedback.trim() };
}

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
export function checkSubmit(submission) {
  if (submission.correctedAt) {
    return { status: 409, message: 'Esta entrega ya está corregida: no se puede cambiar.' };
  }
  return null;
}

export function checkCorrect(submission) {
  if (!submission.submittedAt) {
    return { status: 409, message: 'El alumno todavía no entregó esta tarea.' };
  }
  return null;
}

export function checkChat(submission) {
  if (!submission.submittedAt) {
    return { status: 409, message: 'Los mensajes se habilitan cuando el alumno entrega la tarea.' };
  }
  return null;
}
