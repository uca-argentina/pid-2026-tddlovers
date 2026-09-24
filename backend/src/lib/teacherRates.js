// Las tarifas del docente y el precio de una clase.
//
// El docente pone en su perfil cuánto cobra la hora de cada materia en cada
// modalidad. El alumno elige materia y duración al reservar, y la clase
// cuesta tarifa × duración. Todo en CENTAVOS enteros: $ 5.000/h por 50 min
// son $ 4.166,67, y con enteros la cuenta da siempre lo mismo acá, en el
// front y en la base.

import { MODALITIES } from './availabilityWindow.js';

// El mismo techo que el CHECK de teacher_rates: $ 10.000.000 la hora.
export const MAX_HOURLY_RATE_CENTS = 1000000000;

// La duración que elige el alumno va de a 5 minutos, desde media hora.
export const MIN_CLASS_MINUTES = 30;
export const CLASS_MINUTES_STEP = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lo que sale una clase: la parte proporcional de la tarifa, redondeada al
 * centavo. El front hace la misma cuenta para mostrarla antes de reservar
 * (utils/rates.js); la que vale es esta.
 */
export function classPriceCents(hourlyRateCents, minutes) {
  return Math.round((hourlyRateCents * minutes) / 60);
}

/** ¿Es una duración que el alumno puede elegir? */
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
 * Devuelve { value } con la lista limpia o { message, fields }.
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
