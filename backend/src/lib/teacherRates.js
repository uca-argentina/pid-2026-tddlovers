// Las tarifas del docente y el precio de una clase.
//
// El docente pone en su perfil cuánto cobra la hora de cada materia en cada
// modalidad. El alumno elige materia y duración al reservar, y la clase
// cuesta tarifa × duración. Todo en CENTAVOS enteros: $ 5.000/h por 50 min
// son $ 4.166,67, y con enteros la cuenta da siempre lo mismo acá, en el
// front y en la base.
//
// Tabla: teacher_rates (tarifa por materia × modalidad, en centavos). Lo usan
// routes/users/index.js (validateRates al guardar el perfil),
// routes/bookings/index.js (bookingPriceCents, isValidClassMinutes,
// MIN_CLASS_MINUTES) y lib/neuronas.js (classPriceCents).
// Espejo: frontend/src/utils/rates.js (classPriceCents) y
// frontend/src/utils/packs.js (quoteBooking), solo para mostrar el precio.

import { MODALITIES } from './availabilityWindow.js';
// neuronas.js también importa de acá (classPriceCents). El ciclo no molesta:
// ninguno de los dos usa al otro al cargarse, solo adentro de funciones.
import { rewardPriceCents } from './neuronas.js';
import { UUID_RE } from './validators.js';

// El mismo techo que el CHECK de teacher_rates: $ 10.000.000 la hora.
const MAX_HOURLY_RATE_CENTS = 1000000000;

// La duración que elige el alumno va de a 5 minutos, desde media hora.
export const MIN_CLASS_MINUTES = 30;
const CLASS_MINUTES_STEP = 5;

/**
 * Lo que sale una clase: la parte proporcional de la tarifa, redondeada al
 * centavo: round(hourlyRateCents × minutes / 60). El front hace la misma
 * cuenta para mostrarla antes de reservar (utils/rates.js); la que vale es esta.
 *
 * @param {number} hourlyRateCents - teacher_rates.hourly_rate_cents.
 * @param {number} minutes - minutos a cobrar.
 * @returns {number} centavos.
 * Lo usan: bookingPriceCents (este archivo) y lib/neuronas.js (rewardPriceCents).
 * Espejo: frontend/src/utils/rates.js (classPriceCents).
 */
export function classPriceCents(hourlyRateCents, minutes) {
  return Math.round((hourlyRateCents * minutes) / 60);
}

/**
 * Lo que se paga al reservar una clase de `minutes`. Paquete y canje son
 * excluyentes (la ruta no deja combinarlos):
 * - sin nada: la clase entera a la tarifa;
 * - con paquete: lo que se pasa de lo que cubren `packTokens` clases de
 *   `packClassMinutes` (lo cubierto ya se pagó al comprarlo);
 * - con canje de neuronas: lo que deja el canje (lib/neuronas.js).
 * No valida: quien llama ya chequeó que los tokens y el canje entren.
 *
 * El front la espeja para mostrar el precio (frontend/src/utils/packs.js
 * quoteBooking); la que vale es esta.
 *
 * @param {object} args
 * @param {number} args.hourlyRateCents - la tarifa de la materia en la modalidad
 *   de la ventana (findRate, db/rates.js).
 * @param {number} args.minutes - body.durationMinutes de la reserva.
 * @param {number} [args.packClassMinutes] - student_packs.class_minutes si usa paquete.
 * @param {number} [args.packTokens] - body.packTokens.
 * @param {string|null} [args.rewardType] - body.rewardType (clave de REWARDS).
 * @returns {number} centavos que se guardan en classes.price_cents (solo el extra).
 * Lo usa: routes/bookings/index.js (priceBooking, al reservar y al reprogramar).
 */
export function bookingPriceCents({
  hourlyRateCents,
  minutes,
  packClassMinutes = 0,
  packTokens = 0,
  rewardType = null,
}) {
  if (rewardType) return rewardPriceCents(rewardType, { hourlyRateCents, minutes });
  const covered = packTokens * packClassMinutes;
  return classPriceCents(hourlyRateCents, Math.max(minutes - covered, 0));
}

/**
 * ¿Es una duración que el alumno puede elegir? Entero, ≥30 y de a 5 minutos.
 * @param {*} minutes - body.durationMinutes de POST /api/classes.
 * Lo usa: routes/bookings/index.js (parseBookingBody).
 */
export function isValidClassMinutes(minutes) {
  return (
    Number.isInteger(minutes) &&
    minutes >= MIN_CLASS_MINUTES &&
    minutes % CLASS_MINUTES_STEP === 0
  );
}

function fail(message) {
  return { message, fields: { rates: 'invalid' } };
}

/**
 * Valida las tarifas tal como las manda el perfil: la lista ENTERA, que
 * reemplaza a la que había. `subjectIds` son las materias que el docente va a
 * tener después de guardar: no se puede tarifar una materia que no da.
 *
 * @param {Array<object>} rates - body.rates de PATCH /api/users/me:
 *   [{ subjectId, modality, hourlyRateCents }].
 * @param {Array<string>} subjectIds - las materias del body o, si no vienen, las
 *   actuales (findSubjectIdsByTeacher, db/users.js).
 * @returns {{value: Array<{subjectId, modality, hourlyRateCents}>}|{message, fields}}
 *   la lista limpia (reemplaza la de teacher_rates) o el primer problema.
 * Lo usa: routes/users/index.js.
 */
export function validateRates(rates, subjectIds) {
  if (!Array.isArray(rates)) return fail('Las tarifas tienen un formato inválido.');

  const materias = new Set(subjectIds.map(String));
  const vistas = new Set();
  const value = [];

  for (const rate of rates) {
    if (!rate || typeof rate !== 'object') return fail('Las tarifas tienen un formato inválido.');

    const subjectId = String(rate.subjectId ?? '');
    if (!UUID_RE.test(subjectId) || !materias.has(subjectId)) {
      return fail('Hay una tarifa de una materia que no tenés en tu perfil.');
    }
    if (!MODALITIES.includes(rate.modality)) {
      return fail('Hay una tarifa con una modalidad inválida.');
    }

    const cents = rate.hourlyRateCents;
    if (!Number.isInteger(cents) || cents < 0 || cents > MAX_HOURLY_RATE_CENTS) {
      return fail('La tarifa por hora tiene que ser un monto en pesos (con hasta dos decimales).');
    }

    // Dos tarifas para la misma combinación: ¿cuál vale? Mejor rechazarlo
    // que elegir una en silencio.
    const clave = `${subjectId}|${rate.modality}`;
    if (vistas.has(clave)) return fail('Hay dos tarifas para la misma materia y modalidad.');
    vistas.add(clave);

    value.push({ subjectId, modality: rate.modality, hourlyRateCents: cents });
  }

  return { value };
}
