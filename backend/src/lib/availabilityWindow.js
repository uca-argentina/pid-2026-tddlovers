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
//
// Tabla destino: availability (+ teacher_addresses si trae dirección nueva).
// Lo usa: routes/teachers/index.js (POST y PUT /me/availability).
// Espejo: frontend/src/utils/windows.js (validateDraft), que valida lo mismo
// para avisar antes de mandar.

import { validateAddress } from './addresses.js';
import { toMinutes } from './availabilityExpansion.js';
import { isRealDate, isUuid } from './validators.js';

// Las modalidades del enum de la base, en inglés como viajan por la API
// ("Virtual/Presencial/Híbrida" es solo texto de pantalla). Las importa
// también lib/teacherRates.js para validar las tarifas.
export const MODALITIES = ['virtual', 'in_person', 'hybrid'];
// Cupo de la ventana: 1 = individual, 2–50 = grupal (CLAUDE.md, "capacity").
const MAX_STUDENTS_LIMIT = 50;
// La clase más corta que se puede reservar: la ventana tiene que tener lugar
// para al menos una.
const MIN_DURATION = 30;

// 'HH:MM' en :00 o :30. '24:00' vale solo como fin (ver CLAUDE.md).
const TIME_RE = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const MAX_URL_LENGTH = 500;

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
 * Valida una ventana y la normaliza: solo se queda con lo que la modalidad usa
 * (link para virtual/híbrida, dirección para presencial/híbrida). Un solo
 * mensaje y no una lista: el modal muestra uno.
 *
 * @param {object} body - el body de POST/PUT /api/teachers/me/availability:
 *   { date, repeatsWeekly, start, end, modality, maxStudents, meetingUrl?,
 *   addressId? | address? + saveAddress? }.
 * @param {{today: string, allowPastDate?: boolean}} opts - `today` sale de
 *   todayIso() (lib/clock.js) en la ruta. `allowPastDate`: al EDITAR una ventana
 *   semanal, su fecha es la de la primera vez y puede haber quedado atrás; eso
 *   no la invalida. Una ventana suelta en el pasado, o una nueva, sí.
 * @returns {{value: object}|{message: string, fields: object}} `value` =
 *   { date, repeatsWeekly, start, end, modality, maxStudents, meetingUrl,
 *   addressId, newAddress, saveAddress } (lo que no aplica, en null/false), o el
 *   primer problema. Que addressId sea del docente y que tenga tarifa en esa
 *   modalidad lo chequean después la ruta y db/availability.js.
 * Lo usa: routes/teachers/index.js.
 * Espejo: frontend/src/utils/windows.js (validateDraft).
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

  // Presencial o híbrida: la dirección es una de las guardadas del docente
  // (`addressId`) o una nueva que se carga acá (`address`), que se guarda en
  // el perfil si pidió `saveAddress`. Que el id sea suyo lo chequea
  // db/availability.js, adentro de la transacción.
  let addressId = null;
  let newAddress = null;
  let saveAddress = false;
  if (needsAddress) {
    if (body.address && typeof body.address === 'object') {
      saveAddress = body.saveAddress === true;
      const checked = validateAddress(body.address, { saving: saveAddress });
      if (!checked.value) return checked;
      newAddress = checked.value;
    } else if (isUuid(body.addressId)) {
      addressId = body.addressId;
    } else {
      return { message: 'Elegí o cargá la dirección de la clase.', fields: { addressId: 'required' } };
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
      addressId,
      newAddress,
      saveAddress,
    },
  };
}
