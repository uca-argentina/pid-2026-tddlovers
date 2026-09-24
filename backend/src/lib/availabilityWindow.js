// Valida una ventana de disponibilidad tal como la manda el modal del
// docente. La UI ya valida todo esto, pero la UI se puede saltear: acá se
// vuelve a chequear antes de tocar la base. Los CHECK de la tabla son la
// última red, pero un error de constraint no se le puede mostrar a nadie.
//
// Lo que necesita la base (que el docente tenga tarifa en esa modalidad, que
// no se pise con otra ventana) no va acá: lo resuelven la ruta y
// db/availability.js.
//
// La ventana ya no dice materia, duración ni precio: la materia y la
// duración las elige el alumno, y el precio sale de la tarifa del docente
// (ver lib/teacherRates.js).

import { toMinutes } from './availabilityExpansion.js';

export const MODALITIES = ['virtual', 'in_person', 'hybrid'];
export const MAX_STUDENTS_LIMIT = 50;
// La clase más corta que se puede reservar: la ventana tiene que tener lugar
// para al menos una.
export const MIN_DURATION = 30;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 'HH:MM' en :00 o :30. '24:00' vale solo como fin (ver CLAUDE.md).
const TIME_RE = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const MAX_URL_LENGTH = 500;
const MAX_ADDRESS_LENGTH = 200;
const MAX_LOCALITY_LENGTH = 100;

function isRealDate(iso) {
  if (!ISO_DATE_RE.test(iso ?? '')) return false;
  // '2026-02-31' pasa la regex pero no existe: Date la corre al 3 de marzo.
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

function isHttpUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function fail(field, message) {
  return { message, fields: { [field]: 'invalid' } };
}

/**
 * Devuelve { value } con la ventana normalizada, o { message, fields } con el
 * primer problema. Un solo mensaje y no una lista: el modal muestra uno.
 *
 * `allowPastDate`: al EDITAR una ventana semanal, su fecha es la de la primera
 * vez y puede haber quedado atrás; eso no la invalida. Una ventana suelta en
 * el pasado, o una nueva, sí.
 */
export function validateWindow(body, { today, allowPastDate = false }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { message: 'La clase tiene un formato inválido.', fields: {} };
  }

  const repeatsWeekly = body.repeatsWeekly === true;

  if (!isRealDate(body.date)) return fail('date', 'Elegí un día válido.');
  if (body.date < today && !(allowPastDate && repeatsWeekly)) {
    return fail('date', 'No se puede cargar una clase en un día que ya pasó.');
  }

  if (!TIME_RE.test(body.start ?? '')) {
    return fail('start', 'El horario tiene que empezar en punto o y media.');
  }
  if (body.end !== '24:00' && !TIME_RE.test(body.end ?? '')) {
    return fail('end', 'El horario tiene que terminar en punto o y media.');
  }
  const start = toMinutes(body.start);
  const end = toMinutes(body.end);
  if (start >= end) return fail('end', 'El horario termina antes de empezar.');
  // Con inicio y fin en :00/:30 esto ya se cumple; queda escrito por si
  // algún día el paso cambia.
  if (end - start < MIN_DURATION) {
    return fail('end', `El horario tiene que durar al menos ${MIN_DURATION} minutos.`);
  }

  if (!MODALITIES.includes(body.modality)) {
    return fail('modality', 'Elegí si la clase es virtual, presencial o híbrida.');
  }

  const maxStudents = body.maxStudents;
  if (!Number.isInteger(maxStudents) || maxStudents < 1 || maxStudents > MAX_STUDENTS_LIMIT) {
    return fail('maxStudents', `El cupo tiene que ser entre 1 y ${MAX_STUDENTS_LIMIT} alumnos.`);
  }

  // Solo se guarda lo que la modalidad usa: un link que quedó escrito antes
  // de pasar a presencial no tiene que aparecerle a nadie.
  const needsUrl = body.modality !== 'in_person';
  const needsAddress = body.modality !== 'virtual';

  const meetingUrl = needsUrl ? String(body.meetingUrl ?? '').trim() : null;
  if (needsUrl) {
    if (!meetingUrl) {
      return { message: 'Falta el link de la clase virtual.', fields: { meetingUrl: 'required' } };
    }
    if (meetingUrl.length > MAX_URL_LENGTH || !isHttpUrl(meetingUrl)) {
      return fail('meetingUrl', 'El link tiene que ser una dirección web (https://...).');
    }
  }

  // Presencial: la localidad es lo que ve cualquier alumno; la dirección
  // exacta, solo el que reservó. Las dos son obligatorias.
  const locality = needsAddress ? String(body.locality ?? '').trim() : null;
  const address = needsAddress ? String(body.address ?? '').trim() : null;
  if (needsAddress) {
    if (!locality) {
      return { message: 'Falta la localidad de la clase presencial.', fields: { locality: 'required' } };
    }
    if (locality.length > MAX_LOCALITY_LENGTH) {
      return fail('locality', `La localidad puede tener hasta ${MAX_LOCALITY_LENGTH} caracteres.`);
    }
    if (!address) {
      return { message: 'Falta la dirección exacta de la clase presencial.', fields: { address: 'required' } };
    }
    if (address.length > MAX_ADDRESS_LENGTH) {
      return fail('address', `La dirección puede tener hasta ${MAX_ADDRESS_LENGTH} caracteres.`);
    }
  }

  return {
    value: {
      date: body.date,
      repeatsWeekly,
      start: body.start,
      end: body.end,
      modality: body.modality,
      maxStudents,
      meetingUrl,
      locality,
      address,
    },
  };
}
